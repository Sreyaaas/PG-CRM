-- migrate:up

-- ===========================================================================
-- Anti-theft guards. These run inside Postgres so that no API bug (Python
-- today, Rust tomorrow) can bypass them. Each maps to a threat in
-- docs/PRODUCT.md:
--   #1 cash pocketing         -> payments.received_by forced, cash_handovers owner-only
--   #3 fake discounts         -> stays floor-price lock + discount_requests
--   #4 backdating / deleting  -> no DELETE anywhere, vacate-date rules, audit_logs
--   #5 duplicate UTRs         -> unique index (ledger migration) + status forced
--   #6 padded no-bill expense -> proof + GPS + note required, auto-flagged
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Immutable audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       uuid,
  actor_id     uuid,
  entity_type  text NOT NULL,
  entity_id    uuid,
  action       text NOT NULL,          -- insert | update
  old_value    jsonb,
  new_value    jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_org    ON audit_logs (org_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_actor  ON audit_logs (actor_id);

CREATE FUNCTION app.audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
BEGIN
  IF TG_OP = 'UPDATE' AND v_new = v_old THEN
    RETURN NEW;
  END IF;
  INSERT INTO audit_logs (org_id, actor_id, entity_type, entity_id, action, old_value, new_value)
  VALUES (
    coalesce((v_new ->> 'org_id')::uuid, (v_old ->> 'org_id')::uuid),
    app.current_user_id(),
    TG_TABLE_NAME,
    coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid),
    lower(TG_OP),
    v_old,
    v_new
  );
  RETURN NEW;
END
$$;

CREATE FUNCTION app.forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = 'PC001';
END
$$;

CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER trg_audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_change();

-- ---------------------------------------------------------------------------
-- No hard deletes (and no TRUNCATE) on business tables
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations', 'organization_members', 'properties', 'rooms', 'beds',
    'onboarding_requests', 'residents', 'discount_requests', 'stays',
    'invoices', 'payments', 'cash_handovers', 'expenses',
    'csv_imports', 'csv_import_rows', 'exit_settlements'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_no_delete BEFORE DELETE ON %1$I FOR EACH ROW EXECUTE FUNCTION app.forbid_delete()', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_no_truncate BEFORE TRUNCATE ON %1$I FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_delete()', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'organization_members', 'properties', 'beds',
    'onboarding_requests', 'residents', 'discount_requests', 'stays',
    'invoices', 'payments', 'cash_handovers', 'expenses',
    'csv_imports', 'exit_settlements'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t);
  END LOOP;
END
$$;

-- Helper: true if anything other than the allowed columns changed.
CREATE FUNCTION app.changed_outside(p_old jsonb, p_new jsonb, p_allowed text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_old - p_allowed) IS DISTINCT FROM (p_new - p_allowed)
$$;

CREATE FUNCTION app.require_user() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v uuid := app.current_user_id();
BEGIN
  IF v IS NULL OR NOT app.is_member() THEN
    RAISE EXCEPTION 'No authenticated member in request context' USING ERRCODE = 'PC002';
  END IF;
  RETURN v;
END
$$;

-- ---------------------------------------------------------------------------
-- Beds: status is derived from stays, never edited by hand
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.refresh_bed_status(p_bed uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('app.bed_sync', 'on', true);
  UPDATE beds b
     SET status = coalesce((
           SELECT CASE s.status
                    WHEN 'active'    THEN 'occupied'::bed_status
                    WHEN 'on_notice' THEN 'on_notice'::bed_status
                    WHEN 'reserved'  THEN 'reserved'::bed_status
                  END
             FROM stays s
            WHERE s.bed_id = p_bed AND s.status <> 'vacated'
            LIMIT 1), 'vacant')
   WHERE b.id = p_bed;
  PERFORM set_config('app.bed_sync', 'off', true);
END
$$;

CREATE FUNCTION app.beds_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(current_setting('app.bed_sync', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'Bed status is derived from stays and cannot be set directly' USING ERRCODE = 'PC003';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_beds_guard BEFORE UPDATE ON beds FOR EACH ROW EXECUTE FUNCTION app.beds_guard();

-- ---------------------------------------------------------------------------
-- Stays: floor-price lock (#3), no backdating (#4)
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.stays_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_owner  boolean := app.is_owner();
  v_today  date := app.today_ist();
  v_floor  bigint;
  v_dr     discount_requests%ROWTYPE;
BEGIN
  PERFORM app.require_user();

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := app.current_user_id();
  END IF;

  -- Floor price: monthly -> bed.base_rent, short-term -> property daily rate
  IF TG_OP = 'INSERT'
     OR NEW.rent_paise IS DISTINCT FROM OLD.rent_paise
     OR NEW.bed_id     IS DISTINCT FROM OLD.bed_id
     OR NEW.stay_type  IS DISTINCT FROM OLD.stay_type
     OR NEW.discount_request_id IS DISTINCT FROM OLD.discount_request_id THEN
    IF NEW.stay_type = 'monthly' THEN
      SELECT base_rent_paise INTO v_floor FROM beds WHERE id = NEW.bed_id;
    ELSE
      SELECT short_term_daily_rate_paise INTO v_floor FROM properties WHERE id = NEW.property_id;
      IF v_floor IS NULL AND NOT v_owner THEN
        RAISE EXCEPTION 'Owner has not set a short-term daily rate for this property' USING ERRCODE = 'PC003';
      END IF;
    END IF;

    IF NEW.rent_paise < coalesce(v_floor, 0) AND NOT v_owner THEN
      IF NEW.discount_request_id IS NULL THEN
        RAISE EXCEPTION 'Rent below the floor price needs an owner-approved discount request'
          USING ERRCODE = 'PC002';
      END IF;
      SELECT * INTO v_dr FROM discount_requests WHERE id = NEW.discount_request_id;
      IF v_dr.status IS DISTINCT FROM 'approved'
         OR v_dr.bed_id <> NEW.bed_id
         OR v_dr.requested_rent_paise <> NEW.rent_paise
         OR (v_dr.resident_id IS NOT NULL AND v_dr.resident_id <> NEW.resident_id) THEN
        RAISE EXCEPTION 'Discount request is not approved for this bed, resident and amount'
          USING ERRCODE = 'PC002';
      END IF;
    END IF;
  END IF;

  IF v_owner THEN
    RETURN NEW;
  END IF;

  -- Caretaker rules ---------------------------------------------------------
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('reserved', 'active') THEN
      RAISE EXCEPTION 'New stays must start as reserved or active' USING ERRCODE = 'PC003';
    END IF;
    IF NEW.check_in_date < v_today - 1 THEN
      RAISE EXCEPTION 'Check-in date cannot be backdated; ask the owner' USING ERRCODE = 'PC002';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'vacated' THEN
    RAISE EXCEPTION 'Only the owner can change a vacated stay' USING ERRCODE = 'PC002';
  END IF;
  IF NEW.check_in_date IS DISTINCT FROM OLD.check_in_date
     OR NEW.deposit_paise IS DISTINCT FROM OLD.deposit_paise
     OR NEW.resident_id IS DISTINCT FROM OLD.resident_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Only the owner can change check-in date, deposit or resident of a stay'
      USING ERRCODE = 'PC002';
  END IF;
  IF NEW.actual_vacate_date IS DISTINCT FROM OLD.actual_vacate_date
     AND NEW.actual_vacate_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'Move-out can only be recorded for today (%); ask the owner for other dates', v_today
      USING ERRCODE = 'PC002';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_stays_guard BEFORE INSERT OR UPDATE ON stays
  FOR EACH ROW EXECUTE FUNCTION app.stays_guard();

-- An approved discount can be used for one stay only.
CREATE UNIQUE INDEX uq_stays_discount_request ON stays (discount_request_id) WHERE discount_request_id IS NOT NULL;

CREATE FUNCTION app.stays_sync_bed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.refresh_bed_status(NEW.bed_id);
  IF TG_OP = 'UPDATE' AND OLD.bed_id <> NEW.bed_id THEN
    PERFORM app.refresh_bed_status(OLD.bed_id);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER trg_stays_sync_bed AFTER INSERT OR UPDATE ON stays
  FOR EACH ROW EXECUTE FUNCTION app.stays_sync_bed();

-- ---------------------------------------------------------------------------
-- Discount requests: caretakers request, owners decide (once)
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.discount_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.requested_by := app.require_user();
    NEW.status := 'pending';
    NEW.decided_by := NULL;
    NEW.decided_at := NULL;
    NEW.decision_note := NULL;
    RETURN NEW;
  END IF;

  PERFORM app.require_owner('approve or reject a discount');
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Discount request already decided' USING ERRCODE = 'PC001';
  END IF;
  IF app.changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'decided_by', 'decided_at', 'decision_note']) THEN
    RAISE EXCEPTION 'Only the decision can be changed on a discount request' USING ERRCODE = 'PC001';
  END IF;
  IF NEW.status = 'pending' THEN
    RAISE EXCEPTION 'Decision must be approved or rejected' USING ERRCODE = 'PC003';
  END IF;
  NEW.decided_by := app.current_user_id();
  NEW.decided_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_discount_requests_guard BEFORE INSERT OR UPDATE ON discount_requests
  FOR EACH ROW EXECUTE FUNCTION app.discount_requests_guard();

-- ---------------------------------------------------------------------------
-- Onboarding review: one decision, recorded with reviewer
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.onboarding_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Onboarding request already reviewed' USING ERRCODE = 'PC001';
  END IF;
  IF app.changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'reviewed_by', 'reviewed_at', 'review_note']) THEN
    RAISE EXCEPTION 'Submitted onboarding data cannot be edited' USING ERRCODE = 'PC001';
  END IF;
  NEW.reviewed_by := app.require_user();
  NEW.reviewed_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_onboarding_guard BEFORE UPDATE ON onboarding_requests
  FOR EACH ROW EXECUTE FUNCTION app.onboarding_guard();

-- ---------------------------------------------------------------------------
-- Invoices: immutable; owner may void (never un-void)
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.invoices_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_stay_resident uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := app.require_user();
    NEW.invoice_no := 'INV-' || lpad(app.next_number(NEW.org_id, 'invoice')::text, 6, '0');
    NEW.created_at := now();
    NEW.voided_at := NULL; NEW.voided_by := NULL; NEW.void_reason := NULL;
    IF NEW.stay_id IS NOT NULL THEN
      SELECT resident_id INTO v_stay_resident FROM stays WHERE id = NEW.stay_id;
      IF v_stay_resident <> NEW.resident_id THEN
        RAISE EXCEPTION 'Invoice stay belongs to a different resident' USING ERRCODE = 'PC003';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  PERFORM app.require_owner('void an invoice');
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice is already void' USING ERRCODE = 'PC001';
  END IF;
  IF app.changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['voided_at', 'voided_by', 'void_reason'])
     OR NEW.voided_at IS NULL OR coalesce(length(trim(NEW.void_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'Invoices are immutable; they can only be voided with a reason' USING ERRCODE = 'PC001';
  END IF;
  NEW.voided_by := app.current_user_id();
  NEW.voided_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_invoices_guard BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION app.invoices_guard();

-- ---------------------------------------------------------------------------
-- Payments: receiver and status forced (#1, #5); owner verifies or voids
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.payments_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_inv invoices%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.received_by := app.require_user();
    NEW.status := CASE WHEN NEW.method = 'cash' THEN 'recorded' ELSE 'provisional' END::payment_status;
    NEW.verified_at := NULL; NEW.verified_by := NULL; NEW.csv_import_row_id := NULL;
    NEW.voided_at := NULL; NEW.voided_by := NULL; NEW.void_reason := NULL;
    NEW.created_at := now();
    IF NOT app.is_owner() THEN
      NEW.received_at := now();     -- caretakers cannot backdate collections
    END IF;
    IF NEW.invoice_id IS NOT NULL THEN
      SELECT * INTO v_inv FROM invoices WHERE id = NEW.invoice_id;
      IF v_inv.resident_id <> NEW.resident_id THEN
        RAISE EXCEPTION 'Invoice belongs to a different resident' USING ERRCODE = 'PC003';
      END IF;
      IF v_inv.voided_at IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot pay a void invoice' USING ERRCODE = 'PC003';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  PERFORM app.require_owner('change a payment');
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payment is void and cannot be changed' USING ERRCODE = 'PC001';
  END IF;
  IF app.changed_outside(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['status', 'verified_at', 'verified_by', 'csv_import_row_id', 'voided_at', 'voided_by', 'void_reason']) THEN
    RAISE EXCEPTION 'Amount, method, UTR, resident and receiver of a payment are immutable' USING ERRCODE = 'PC001';
  END IF;
  IF OLD.method = 'cash' AND NEW.status <> 'recorded' THEN
    RAISE EXCEPTION 'Cash payments are reconciled through cash handovers, not verification' USING ERRCODE = 'PC003';
  END IF;
  IF OLD.method <> 'cash' AND NEW.status = 'recorded' THEN
    RAISE EXCEPTION 'Invalid status for a UPI/bank payment' USING ERRCODE = 'PC003';
  END IF;
  IF NEW.status = 'verified' AND OLD.status <> 'verified' THEN
    NEW.verified_by := app.current_user_id();
    NEW.verified_at := now();
  END IF;
  IF NEW.voided_at IS NOT NULL THEN
    IF coalesce(length(trim(NEW.void_reason)), 0) < 3 THEN
      RAISE EXCEPTION 'A reason is required to void a payment' USING ERRCODE = 'PC003';
    END IF;
    NEW.voided_by := app.current_user_id();
    NEW.voided_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_payments_guard BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION app.payments_guard();

-- ---------------------------------------------------------------------------
-- Cash handovers: owner-only, immutable (#1)
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.cash_handovers_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Cash handovers are immutable' USING ERRCODE = 'PC001';
  END IF;
  PERFORM app.require_owner('record a cash handover');
  NEW.recorded_by := app.current_user_id();
  NEW.created_at := now();
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
     WHERE org_id = NEW.org_id AND user_id = NEW.caretaker_user_id AND role = 'caretaker'
  ) THEN
    RAISE EXCEPTION 'Handover must be from a caretaker of this organization' USING ERRCODE = 'PC003';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_cash_handovers_guard BEFORE INSERT OR UPDATE ON cash_handovers
  FOR EACH ROW EXECUTE FUNCTION app.cash_handovers_guard();

-- ---------------------------------------------------------------------------
-- Expenses: proof rules (#6), owner-only categories hidden from caretakers
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.expenses_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_owner boolean := app.is_owner();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := app.require_user();
    NEW.created_at := now();
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_note := NULL;
    NEW.voided_at := NULL; NEW.voided_by := NULL; NEW.void_reason := NULL;

    IF NEW.category = 'lease_rent' THEN
      NEW.owner_only := true;
    END IF;
    IF NOT v_owner THEN
      IF NEW.owner_only THEN
        RAISE EXCEPTION 'Caretakers cannot log owner-only expenses' USING ERRCODE = 'PC002';
      END IF;
      IF NEW.paid_from <> 'caretaker_cash' THEN
        RAISE EXCEPTION 'Caretaker expenses are always paid from caretaker cash' USING ERRCODE = 'PC002';
      END IF;
      IF NEW.expense_date < app.today_ist() - 3 OR NEW.expense_date > app.today_ist() THEN
        RAISE EXCEPTION 'Expense date must be within the last 3 days' USING ERRCODE = 'PC002';
      END IF;
    END IF;

    IF NEW.bill_mode = 'no_bill' THEN
      IF coalesce(length(trim(NEW.notes)), 0) < 5 THEN
        RAISE EXCEPTION 'No-bill expenses need a note explaining the purchase' USING ERRCODE = 'PC003';
      END IF;
      IF NEW.proof_captured_at IS NULL OR NEW.proof_lat IS NULL OR NEW.proof_lng IS NULL THEN
        RAISE EXCEPTION 'No-bill expenses need a live photo with time and GPS' USING ERRCODE = 'PC003';
      END IF;
      IF NEW.proof_captured_at < now() - interval '15 minutes' OR NEW.proof_captured_at > now() + interval '2 minutes' THEN
        RAISE EXCEPTION 'No-bill photo must be captured within the last 15 minutes' USING ERRCODE = 'PC003';
      END IF;
      NEW.flagged_for_review := NOT v_owner;
    ELSE
      NEW.flagged_for_review := false;
    END IF;
    RETURN NEW;
  END IF;

  PERFORM app.require_owner('review or void an expense');
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Expense is void and cannot be changed' USING ERRCODE = 'PC001';
  END IF;
  IF app.changed_outside(to_jsonb(OLD), to_jsonb(NEW),
       ARRAY['flagged_for_review', 'reviewed_by', 'reviewed_at', 'review_note', 'voided_at', 'voided_by', 'void_reason']) THEN
    RAISE EXCEPTION 'Expense details are immutable; void and re-enter instead' USING ERRCODE = 'PC001';
  END IF;
  IF NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
    NEW.reviewed_by := app.current_user_id();
    NEW.reviewed_at := now();
  END IF;
  IF NEW.voided_at IS NOT NULL THEN
    IF coalesce(length(trim(NEW.void_reason)), 0) < 3 THEN
      RAISE EXCEPTION 'A reason is required to void an expense' USING ERRCODE = 'PC003';
    END IF;
    NEW.voided_by := app.current_user_id();
    NEW.voided_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_expenses_guard BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION app.expenses_guard();

-- ---------------------------------------------------------------------------
-- CSV reconciliation + exit settlements: owner-only
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.csv_imports_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.require_owner('upload statements');
  IF TG_OP = 'INSERT' THEN
    NEW.uploaded_by := app.current_user_id();
    NEW.created_at := now();
  ELSIF app.changed_outside(to_jsonb(OLD), to_jsonb(NEW),
          ARRAY['row_count', 'matched_count', 'mismatch_count', 'unmatched_count']) THEN
    RAISE EXCEPTION 'Only import totals can be updated' USING ERRCODE = 'PC001';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_csv_imports_guard BEFORE INSERT OR UPDATE ON csv_imports
  FOR EACH ROW EXECUTE FUNCTION app.csv_imports_guard();

CREATE TRIGGER trg_csv_import_rows_immutable BEFORE UPDATE ON csv_import_rows
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();

CREATE FUNCTION app.exit_settlements_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_stay stays%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Exit settlements are immutable' USING ERRCODE = 'PC001';
  END IF;
  PERFORM app.require_owner('settle a deposit');
  NEW.settled_by := app.current_user_id();
  NEW.created_at := now();
  SELECT * INTO v_stay FROM stays WHERE id = NEW.stay_id;
  IF v_stay.status <> 'vacated' THEN
    RAISE EXCEPTION 'Stay must be vacated before settlement' USING ERRCODE = 'PC003';
  END IF;
  IF v_stay.resident_id <> NEW.resident_id THEN
    RAISE EXCEPTION 'Settlement resident does not match the stay' USING ERRCODE = 'PC003';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_exit_settlements_guard BEFORE INSERT OR UPDATE ON exit_settlements
  FOR EACH ROW EXECUTE FUNCTION app.exit_settlements_guard();

-- migrate:down
DROP TRIGGER IF EXISTS trg_exit_settlements_guard ON exit_settlements;
DROP FUNCTION IF EXISTS app.exit_settlements_guard();
DROP TRIGGER IF EXISTS trg_csv_import_rows_immutable ON csv_import_rows;
DROP TRIGGER IF EXISTS trg_csv_imports_guard ON csv_imports;
DROP FUNCTION IF EXISTS app.csv_imports_guard();
DROP TRIGGER IF EXISTS trg_expenses_guard ON expenses;
DROP FUNCTION IF EXISTS app.expenses_guard();
DROP TRIGGER IF EXISTS trg_cash_handovers_guard ON cash_handovers;
DROP FUNCTION IF EXISTS app.cash_handovers_guard();
DROP TRIGGER IF EXISTS trg_payments_guard ON payments;
DROP FUNCTION IF EXISTS app.payments_guard();
DROP TRIGGER IF EXISTS trg_invoices_guard ON invoices;
DROP FUNCTION IF EXISTS app.invoices_guard();
DROP TRIGGER IF EXISTS trg_onboarding_guard ON onboarding_requests;
DROP FUNCTION IF EXISTS app.onboarding_guard();
DROP TRIGGER IF EXISTS trg_discount_requests_guard ON discount_requests;
DROP FUNCTION IF EXISTS app.discount_requests_guard();
DROP TRIGGER IF EXISTS trg_stays_sync_bed ON stays;
DROP FUNCTION IF EXISTS app.stays_sync_bed();
DROP INDEX IF EXISTS uq_stays_discount_request;
DROP TRIGGER IF EXISTS trg_stays_guard ON stays;
DROP FUNCTION IF EXISTS app.stays_guard();
DROP TRIGGER IF EXISTS trg_beds_guard ON beds;
DROP FUNCTION IF EXISTS app.beds_guard();
DROP FUNCTION IF EXISTS app.refresh_bed_status(uuid);
DROP FUNCTION IF EXISTS app.require_user();
DROP FUNCTION IF EXISTS app.changed_outside(jsonb, jsonb, text[]);
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations', 'organization_members', 'properties', 'rooms', 'beds',
    'onboarding_requests', 'residents', 'discount_requests', 'stays',
    'invoices', 'payments', 'cash_handovers', 'expenses',
    'csv_imports', 'csv_import_rows', 'exit_settlements'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_no_delete ON %1$I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_no_truncate ON %1$I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON %1$I', t);
  END LOOP;
END
$$;
DROP TABLE IF EXISTS audit_logs;
DROP FUNCTION IF EXISTS app.forbid_change();
DROP FUNCTION IF EXISTS app.audit_row();
