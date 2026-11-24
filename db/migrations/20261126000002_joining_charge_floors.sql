-- migrate:up

-- BE-22: at joining, caretakers may raise but never lower the owner's security deposit and maintenance charge
-- (same idea as the rent floor, threat #3). Owners can enter any amount.
CREATE OR REPLACE FUNCTION app.stays_guard() RETURNS trigger
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
    -- BE-22: caretakers can't take a smaller security deposit than the owner set for the property.
    IF NEW.deposit_paise < (SELECT security_deposit_paise FROM properties WHERE id = NEW.property_id) THEN
      RAISE EXCEPTION 'Security deposit cannot be lower than the property''s amount; ask the owner'
        USING ERRCODE = 'PC002';
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

-- migrate:down
CREATE OR REPLACE FUNCTION app.stays_guard() RETURNS trigger
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
