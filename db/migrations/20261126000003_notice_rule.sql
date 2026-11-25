-- migrate:up

-- BE-24: notice rule (docs/PRODUCT.md). Notice on/before the property's notice_deadline_day of month M -> the last
-- day is the end of M; after it -> the end of M+1. Same calculation as app/billing.py::notice_last_day.
CREATE FUNCTION app.notice_last_day(p_notice date, p_deadline_day smallint) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT (date_trunc('month', p_notice)
          + CASE WHEN extract(day FROM p_notice) <= p_deadline_day THEN interval '1 month' ELSE interval '2 months' END
          - interval '1 day')::date
$$;
REVOKE ALL ON FUNCTION app.notice_last_day(date, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.notice_last_day(date, smallint) TO pgcrm_app;

-- Caretakers: a changed notice_given_on must be today (IST) and expected_vacate_date the computed last day.
-- Owners are exempt (overrides are in the audit log, like every stay change).
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
  -- BE-24: the notice date is set by the system (backdating it before the deadline day would let a resident
  -- skip a month). Withdrawing notice (both cleared) is allowed.
  IF (NEW.notice_given_on IS DISTINCT FROM OLD.notice_given_on
      OR NEW.expected_vacate_date IS DISTINCT FROM OLD.expected_vacate_date)
     AND NOT (NEW.notice_given_on IS NULL AND NEW.expected_vacate_date IS NULL) THEN
    IF NEW.stay_type <> 'monthly' THEN
      RAISE EXCEPTION 'Only the owner can change the dates of a short stay' USING ERRCODE = 'PC002';
    END IF;
    IF NEW.notice_given_on IS DISTINCT FROM OLD.notice_given_on AND NEW.notice_given_on IS DISTINCT FROM v_today THEN
      RAISE EXCEPTION 'Notice can only be given today (%); ask the owner for other dates', v_today
        USING ERRCODE = 'PC002';
    END IF;
    IF NEW.expected_vacate_date IS DISTINCT FROM app.notice_last_day(
         NEW.notice_given_on, (SELECT notice_deadline_day FROM properties WHERE id = NEW.property_id)) THEN
      RAISE EXCEPTION 'The last day follows the notice rule; ask the owner to change it' USING ERRCODE = 'PC002';
    END IF;
  END IF;
  IF NEW.actual_vacate_date IS DISTINCT FROM OLD.actual_vacate_date
     AND NEW.actual_vacate_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'Move-out can only be recorded for today (%); ask the owner for other dates', v_today
      USING ERRCODE = 'PC002';
  END IF;
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

DROP FUNCTION IF EXISTS app.notice_last_day(date, smallint);
