-- migrate:up

-- BE-44: POST /payments/{id}/flag takes the owner's reason. Same function as 20261124000005_guards_and_audit.sql,
-- plus: `flag_reason` is cleared on insert and may only change together with status = 'flagged' (>= 3 chars). It
-- stays after a later verify, as history (the audit log has every change anyway). Reconciliation (BE-40) still
-- flags amount mismatches without a reason.
ALTER TABLE payments ADD COLUMN flag_reason text;

CREATE OR REPLACE FUNCTION app.payments_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_inv invoices%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.received_by := app.require_user();
    NEW.status := CASE WHEN NEW.method = 'cash' THEN 'recorded' ELSE 'provisional' END::payment_status;
    NEW.verified_at := NULL; NEW.verified_by := NULL; NEW.csv_import_row_id := NULL;
    NEW.voided_at := NULL; NEW.voided_by := NULL; NEW.void_reason := NULL; NEW.flag_reason := NULL;
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
       ARRAY['status', 'verified_at', 'verified_by', 'csv_import_row_id', 'voided_at', 'voided_by', 'void_reason', 'flag_reason']) THEN
    RAISE EXCEPTION 'Amount, method, UTR, resident and receiver of a payment are immutable' USING ERRCODE = 'PC001';
  END IF;
  IF OLD.method = 'cash' AND NEW.status <> 'recorded' THEN
    RAISE EXCEPTION 'Cash payments are reconciled through cash handovers, not verification' USING ERRCODE = 'PC003';
  END IF;
  IF OLD.method <> 'cash' AND NEW.status = 'recorded' THEN
    RAISE EXCEPTION 'Invalid status for a UPI/bank payment' USING ERRCODE = 'PC003';
  END IF;
  -- BE-44: the owner's reason travels with the flag; it can only be set (>= 3 chars) while flagging.
  IF NEW.flag_reason IS DISTINCT FROM OLD.flag_reason
     AND (NEW.status <> 'flagged' OR coalesce(length(trim(NEW.flag_reason)), 0) < 3) THEN
    RAISE EXCEPTION 'A reason is required to flag a payment' USING ERRCODE = 'PC003';
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

-- migrate:down
CREATE OR REPLACE FUNCTION app.payments_guard() RETURNS trigger
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

ALTER TABLE payments DROP COLUMN IF EXISTS flag_reason;
