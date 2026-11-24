-- migrate:up

-- ---------------------------------------------------------------------------
-- Financial ledger. Nothing here is ever deleted (see guards migration).
-- Mistakes are corrected by voiding (owner only), which is audit-logged.
-- ---------------------------------------------------------------------------

CREATE TYPE invoice_kind    AS ENUM ('rent', 'short_term', 'deposit', 'exit_deduction', 'other');
CREATE TYPE payment_method  AS ENUM ('cash', 'upi', 'bank_transfer');
-- recorded    = cash, accounted for through the caretaker cash ledger
-- provisional = UPI/bank logged at the desk with a UTR, not yet matched
-- verified    = matched against the owner's bank/Paytm CSV (or owner-confirmed)
-- flagged     = CSV says amount mismatch / not found; needs owner attention
CREATE TYPE payment_status  AS ENUM ('recorded', 'provisional', 'verified', 'flagged');
CREATE TYPE expense_category AS ENUM (
  'water_tanker', 'electricity_bescom', 'groceries', 'gas_lpg', 'maintenance_repairs',
  'cleaning', 'internet', 'staff_salary', 'security', 'lease_rent', 'other'
);
CREATE TYPE bill_mode       AS ENUM ('has_bill', 'no_bill');
CREATE TYPE expense_payer   AS ENUM ('caretaker_cash', 'owner_direct');
CREATE TYPE csv_source      AS ENUM ('paytm_business', 'phonepe_business', 'bank_statement', 'other');
CREATE TYPE csv_match       AS ENUM ('matched', 'amount_mismatch', 'unmatched', 'already_verified');

-- Per-org running numbers (INV-000123). Row-locked, so no gaps from races.
CREATE TABLE org_counters (
  org_id  uuid NOT NULL REFERENCES organizations(id),
  name    text NOT NULL,
  value   bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, name)
);

CREATE FUNCTION app.next_number(p_org uuid, p_name text) RETURNS bigint
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO org_counters AS c (org_id, name, value) VALUES (p_org, p_name, 1)
  ON CONFLICT (org_id, name) DO UPDATE SET value = c.value + 1
  RETURNING value
$$;

CREATE TABLE invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  property_id    uuid NOT NULL,
  resident_id    uuid NOT NULL,
  stay_id        uuid,
  invoice_no     text NOT NULL,                     -- set by trigger
  kind           invoice_kind NOT NULL,
  period_start   date,
  period_end     date,
  amount_paise   bigint NOT NULL CHECK (amount_paise > 0),
  due_date       date NOT NULL,
  notes          text,
  public_token   text NOT NULL UNIQUE DEFAULT app.random_token(),  -- /receipt/<token>
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  voided_at      timestamptz,
  voided_by      uuid REFERENCES users(id),
  void_reason    text,
  FOREIGN KEY (property_id, org_id) REFERENCES properties (id, org_id),
  FOREIGN KEY (resident_id, property_id) REFERENCES residents (id, property_id),
  FOREIGN KEY (stay_id, property_id) REFERENCES stays (id, property_id),
  UNIQUE (org_id, invoice_no),
  UNIQUE (id, property_id),
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  CHECK ((voided_at IS NULL) = (voided_by IS NULL))
);
CREATE INDEX idx_invoices_org      ON invoices (org_id);
CREATE INDEX idx_invoices_property ON invoices (property_id, due_date);
CREATE INDEX idx_invoices_resident ON invoices (resident_id);
CREATE INDEX idx_invoices_stay     ON invoices (stay_id);
-- Never bill the same stay twice for the same rent period.
CREATE UNIQUE INDEX uq_invoices_rent_period ON invoices (stay_id, period_start)
  WHERE kind = 'rent' AND voided_at IS NULL;

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  property_id         uuid NOT NULL,
  resident_id         uuid NOT NULL,
  invoice_id          uuid,
  amount_paise        bigint NOT NULL CHECK (amount_paise > 0),
  method              payment_method NOT NULL,
  utr_number          text CHECK (utr_number ~ '^[0-9]{12}$'),
  status              payment_status NOT NULL,       -- forced by trigger on insert
  received_by         uuid NOT NULL REFERENCES users(id),  -- forced to the caller
  received_at         timestamptz NOT NULL DEFAULT now(),
  notes               text,
  verified_at         timestamptz,
  verified_by         uuid REFERENCES users(id),
  csv_import_row_id   uuid,
  public_token        text NOT NULL UNIQUE DEFAULT app.random_token(),  -- /receipt/<token>
  created_at          timestamptz NOT NULL DEFAULT now(),
  voided_at           timestamptz,
  voided_by           uuid REFERENCES users(id),
  void_reason         text,
  FOREIGN KEY (property_id, org_id) REFERENCES properties (id, org_id),
  FOREIGN KEY (resident_id, property_id) REFERENCES residents (id, property_id),
  FOREIGN KEY (invoice_id, property_id) REFERENCES invoices (id, property_id),
  CHECK ((method = 'cash') = (utr_number IS NULL)),
  CHECK ((voided_at IS NULL) = (voided_by IS NULL))
);
CREATE INDEX idx_payments_org         ON payments (org_id);
CREATE INDEX idx_payments_property    ON payments (property_id, received_at);
CREATE INDEX idx_payments_resident    ON payments (resident_id);
CREATE INDEX idx_payments_invoice     ON payments (invoice_id);
CREATE INDEX idx_payments_received_by ON payments (received_by) WHERE method = 'cash';
-- Threat #5: a UTR can be used once, ever. Enforced by the database.
CREATE UNIQUE INDEX idx_payments_utr_unique ON payments (utr_number) WHERE utr_number IS NOT NULL;

-- Threat #1: only the owner can reduce a caretaker's cash-in-hand.
CREATE TABLE cash_handovers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id),
  caretaker_user_id   uuid NOT NULL REFERENCES users(id),
  amount_paise        bigint NOT NULL CHECK (amount_paise > 0),
  handed_over_at      timestamptz NOT NULL DEFAULT now(),
  recorded_by         uuid NOT NULL REFERENCES users(id),  -- forced to the caller (owner)
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_handovers_org       ON cash_handovers (org_id);
CREATE INDEX idx_handovers_caretaker ON cash_handovers (caretaker_user_id);

-- Threat #6: no-bill expenses need a live photo + GPS + note, and are flagged.
CREATE TABLE expenses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  property_id          uuid NOT NULL,
  category             expense_category NOT NULL,
  amount_paise         bigint NOT NULL CHECK (amount_paise > 0),
  quantity             numeric(10, 2) CHECK (quantity > 0),  -- e.g. 3 tankers
  unit                 text,                                -- e.g. 'tanker'
  expense_date         date NOT NULL,
  vendor_name          text,
  notes                text,
  bill_mode            bill_mode NOT NULL,
  proof_path           text NOT NULL,      -- private object storage key
  proof_captured_at    timestamptz,
  proof_lat            numeric(9, 6),
  proof_lng            numeric(9, 6),
  paid_from            expense_payer NOT NULL,
  owner_only           boolean NOT NULL DEFAULT false,  -- hidden from caretakers (e.g. lease rent)
  flagged_for_review   boolean NOT NULL DEFAULT false,
  reviewed_by          uuid REFERENCES users(id),
  reviewed_at          timestamptz,
  review_note          text,
  created_by           uuid NOT NULL REFERENCES users(id),  -- forced to the caller
  created_at           timestamptz NOT NULL DEFAULT now(),
  voided_at            timestamptz,
  voided_by            uuid REFERENCES users(id),
  void_reason          text,
  FOREIGN KEY (property_id, org_id) REFERENCES properties (id, org_id),
  CHECK ((voided_at IS NULL) = (voided_by IS NULL))
);
CREATE INDEX idx_expenses_org      ON expenses (org_id);
CREATE INDEX idx_expenses_property ON expenses (property_id, expense_date);
CREATE INDEX idx_expenses_flagged  ON expenses (org_id) WHERE flagged_for_review AND reviewed_at IS NULL;
CREATE INDEX idx_expenses_creator  ON expenses (created_by) WHERE paid_from = 'caretaker_cash';

-- Owner's bank / Paytm Business statement uploads for UTR reconciliation.
CREATE TABLE csv_imports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id),
  source            csv_source NOT NULL,
  file_name         text NOT NULL,
  file_path         text,
  row_count         integer NOT NULL DEFAULT 0,
  matched_count     integer NOT NULL DEFAULT 0,
  mismatch_count    integer NOT NULL DEFAULT 0,
  unmatched_count   integer NOT NULL DEFAULT 0,
  uploaded_by       uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_csv_imports_org ON csv_imports (org_id);

CREATE TABLE csv_import_rows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id),
  import_id       uuid NOT NULL REFERENCES csv_imports(id),
  utr_number      text,
  amount_paise    bigint,
  txn_at          timestamptz,
  payer_name      text,
  raw             jsonb NOT NULL,
  match           csv_match NOT NULL,
  payment_id      uuid REFERENCES payments(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_csv_rows_org     ON csv_import_rows (org_id);
CREATE INDEX idx_csv_rows_import  ON csv_import_rows (import_id);
CREATE INDEX idx_csv_rows_utr     ON csv_import_rows (utr_number);
CREATE INDEX idx_csv_rows_payment ON csv_import_rows (payment_id);

ALTER TABLE payments
  ADD CONSTRAINT payments_csv_import_row_fk FOREIGN KEY (csv_import_row_id) REFERENCES csv_import_rows(id);

-- Move-out: deposit - exit deduction - other deductions - pending dues.
CREATE TABLE exit_settlements (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL,
  property_id             uuid NOT NULL,
  stay_id                 uuid NOT NULL UNIQUE,
  resident_id             uuid NOT NULL,
  deposit_paise           bigint NOT NULL CHECK (deposit_paise >= 0),
  exit_deduction_paise    bigint NOT NULL DEFAULT 0 CHECK (exit_deduction_paise >= 0),
  other_deductions_paise  bigint NOT NULL DEFAULT 0 CHECK (other_deductions_paise >= 0),
  other_deductions_note   text,
  pending_dues_paise      bigint NOT NULL DEFAULT 0 CHECK (pending_dues_paise >= 0),
  -- positive: refund to resident; negative: resident still owes
  net_refund_paise        bigint GENERATED ALWAYS AS
                            (deposit_paise - exit_deduction_paise - other_deductions_paise - pending_dues_paise) STORED,
  refund_method           payment_method,
  refund_utr              text CHECK (refund_utr ~ '^[0-9]{12}$'),
  settled_by              uuid NOT NULL REFERENCES users(id),
  settled_at              timestamptz NOT NULL DEFAULT now(),
  public_token            text NOT NULL UNIQUE DEFAULT app.random_token(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, org_id) REFERENCES properties (id, org_id),
  FOREIGN KEY (stay_id, property_id) REFERENCES stays (id, property_id),
  FOREIGN KEY (resident_id, property_id) REFERENCES residents (id, property_id),
  CHECK (other_deductions_paise = 0 OR other_deductions_note IS NOT NULL)
);
CREATE INDEX idx_settlements_org      ON exit_settlements (org_id);
CREATE INDEX idx_settlements_property ON exit_settlements (property_id);
CREATE INDEX idx_settlements_resident ON exit_settlements (resident_id);

-- migrate:down
DROP TABLE IF EXISTS exit_settlements;
ALTER TABLE IF EXISTS payments DROP CONSTRAINT IF EXISTS payments_csv_import_row_fk;
DROP TABLE IF EXISTS csv_import_rows;
DROP TABLE IF EXISTS csv_imports;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS cash_handovers;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS invoices;
DROP FUNCTION IF EXISTS app.next_number(uuid, text);
DROP TABLE IF EXISTS org_counters;
DROP TYPE IF EXISTS csv_match;
DROP TYPE IF EXISTS csv_source;
DROP TYPE IF EXISTS expense_payer;
DROP TYPE IF EXISTS bill_mode;
DROP TYPE IF EXISTS expense_category;
DROP TYPE IF EXISTS payment_status;
DROP TYPE IF EXISTS payment_method;
DROP TYPE IF EXISTS invoice_kind;
