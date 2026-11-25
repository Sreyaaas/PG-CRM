-- migrate:up

-- BE-30: same function as 20261126000002_joining_charge_floors.sql, plus: caretakers can't create kind='other'
-- (one-off) invoices.
CREATE OR REPLACE FUNCTION app.invoices_guard() RETURNS trigger
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
    -- BE-30: one-off charges are the owner's call (walk-in overcharging, threat #2). Caretakers create only the
    -- invoices that follow from a stay: rent, short-term, deposit and maintenance charge at check-in, and
    -- monthly rent (POST /invoices/generate-due).
    IF NEW.kind = 'other' AND NOT app.is_owner() THEN
      RAISE EXCEPTION 'Only the owner can add a one-off charge' USING ERRCODE = 'PC002';
    END IF;
    -- BE-22: caretakers can't charge a smaller maintenance charge than the owner set for the property.
    IF NEW.kind = 'maintenance_charge' AND NOT app.is_owner()
       AND NEW.amount_paise < (SELECT maintenance_charge_paise FROM properties WHERE id = NEW.property_id) THEN
      RAISE EXCEPTION 'Maintenance charge cannot be lower than the property''s amount; ask the owner'
        USING ERRCODE = 'PC002';
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

-- migrate:down
CREATE OR REPLACE FUNCTION app.invoices_guard() RETURNS trigger
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
    -- BE-22: caretakers can't charge a smaller maintenance charge than the owner set for the property.
    IF NEW.kind = 'maintenance_charge' AND NOT app.is_owner()
       AND NEW.amount_paise < (SELECT maintenance_charge_paise FROM properties WHERE id = NEW.property_id) THEN
      RAISE EXCEPTION 'Maintenance charge cannot be lower than the property''s amount; ask the owner'
        USING ERRCODE = 'PC002';
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
