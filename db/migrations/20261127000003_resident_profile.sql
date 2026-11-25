-- migrate:up

-- BE-25: resident profile fields for the police register and day-to-day running. Date of birth, occupation,
-- company/college, permanent address and emergency contact name/phone exist already (BE-21 form).
CREATE TYPE food_preference AS ENUM ('veg', 'non_veg', 'egg');
CREATE TYPE police_verification_status AS ENUM ('pending', 'submitted', 'verified');

-- Captured on the Reception QR form, copied to the resident when the request is approved (BE-22).
ALTER TABLE onboarding_requests
  ADD COLUMN food_preference food_preference,
  ADD COLUMN vehicle_number text CHECK (length(vehicle_number) <= 20),
  ADD COLUMN emergency_contact_relation text CHECK (length(emergency_contact_relation) <= 40);

ALTER TABLE residents
  ADD COLUMN food_preference food_preference,
  ADD COLUMN vehicle_number text CHECK (length(vehicle_number) <= 20),
  ADD COLUMN emergency_contact_relation text CHECK (length(emergency_contact_relation) <= 40),
  ADD COLUMN police_verification_status police_verification_status NOT NULL DEFAULT 'pending',
  ADD COLUMN police_verification_date date,
  -- "submitted" / "verified" must say when.
  ADD CONSTRAINT residents_police_date_check
    CHECK (police_verification_status = 'pending' OR police_verification_date IS NOT NULL);

-- Same function as 20261126000001_onboarding_submit_paths.sql, plus the three new form fields.
CREATE OR REPLACE FUNCTION api.public_submit_onboarding(
  p_qr_slug text, p jsonb, p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prop    properties%ROWTYPE;
  v_id      uuid;
  v_pattern text;
BEGIN
  SELECT * INTO v_prop FROM properties WHERE qr_slug = p_qr_slug AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This QR code is not active' USING ERRCODE = 'PC003';
  END IF;
  IF (p ->> 'accepted_exit_deduction_paise')::bigint IS DISTINCT FROM v_prop.exit_deduction_paise THEN
    RAISE EXCEPTION 'Exit deduction shown to the resident does not match the current amount' USING ERRCODE = 'PC003';
  END IF;
  v_pattern := '^onboarding/' || v_prop.id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$';
  IF coalesce(p ->> 'id_doc_path', '') !~ v_pattern OR coalesce(p ->> 'selfie_path', '') !~ v_pattern THEN
    RAISE EXCEPTION 'Photos must be uploaded through this QR code''s form' USING ERRCODE = 'PC003';
  END IF;
  IF EXISTS (
    SELECT 1 FROM onboarding_requests
     WHERE property_id = v_prop.id AND phone = p ->> 'phone' AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A request from this phone is already waiting for approval' USING ERRCODE = 'PC003';
  END IF;

  INSERT INTO onboarding_requests (
    org_id, property_id, full_name, phone, email, date_of_birth, permanent_address,
    occupation, employer_or_college, emergency_contact_name, emergency_contact_phone,
    id_doc_type, id_doc_number, id_doc_path, selfie_path,
    is_foreign_national, passport_number, visa_number, visa_expiry,
    accepted_rules, accepted_exit_deduction_paise, submitted_ip, submitted_user_agent,
    food_preference, vehicle_number, emergency_contact_relation
  ) VALUES (
    v_prop.org_id, v_prop.id, p ->> 'full_name', p ->> 'phone', p ->> 'email',
    (p ->> 'date_of_birth')::date, p ->> 'permanent_address',
    (p ->> 'occupation')::occupation_type, p ->> 'employer_or_college',
    p ->> 'emergency_contact_name', p ->> 'emergency_contact_phone',
    (p ->> 'id_doc_type')::id_doc_type, p ->> 'id_doc_number', p ->> 'id_doc_path', p ->> 'selfie_path',
    coalesce((p ->> 'is_foreign_national')::boolean, false),
    p ->> 'passport_number', p ->> 'visa_number', (p ->> 'visa_expiry')::date,
    coalesce((p ->> 'accepted_rules')::boolean, false),
    (p ->> 'accepted_exit_deduction_paise')::bigint, p_ip, p_user_agent,
    (p ->> 'food_preference')::food_preference, p ->> 'vehicle_number', p ->> 'emergency_contact_relation'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION api.public_submit_onboarding(text, jsonb, inet, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.public_submit_onboarding(text, jsonb, inet, text) TO pgcrm_app;

-- migrate:down
CREATE OR REPLACE FUNCTION api.public_submit_onboarding(
  p_qr_slug text, p jsonb, p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prop    properties%ROWTYPE;
  v_id      uuid;
  v_pattern text;
BEGIN
  SELECT * INTO v_prop FROM properties WHERE qr_slug = p_qr_slug AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This QR code is not active' USING ERRCODE = 'PC003';
  END IF;
  IF (p ->> 'accepted_exit_deduction_paise')::bigint IS DISTINCT FROM v_prop.exit_deduction_paise THEN
    RAISE EXCEPTION 'Exit deduction shown to the resident does not match the current amount' USING ERRCODE = 'PC003';
  END IF;
  v_pattern := '^onboarding/' || v_prop.id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$';
  IF coalesce(p ->> 'id_doc_path', '') !~ v_pattern OR coalesce(p ->> 'selfie_path', '') !~ v_pattern THEN
    RAISE EXCEPTION 'Photos must be uploaded through this QR code''s form' USING ERRCODE = 'PC003';
  END IF;
  IF EXISTS (
    SELECT 1 FROM onboarding_requests
     WHERE property_id = v_prop.id AND phone = p ->> 'phone' AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A request from this phone is already waiting for approval' USING ERRCODE = 'PC003';
  END IF;

  INSERT INTO onboarding_requests (
    org_id, property_id, full_name, phone, email, date_of_birth, permanent_address,
    occupation, employer_or_college, emergency_contact_name, emergency_contact_phone,
    id_doc_type, id_doc_number, id_doc_path, selfie_path,
    is_foreign_national, passport_number, visa_number, visa_expiry,
    accepted_rules, accepted_exit_deduction_paise, submitted_ip, submitted_user_agent
  ) VALUES (
    v_prop.org_id, v_prop.id, p ->> 'full_name', p ->> 'phone', p ->> 'email',
    (p ->> 'date_of_birth')::date, p ->> 'permanent_address',
    (p ->> 'occupation')::occupation_type, p ->> 'employer_or_college',
    p ->> 'emergency_contact_name', p ->> 'emergency_contact_phone',
    (p ->> 'id_doc_type')::id_doc_type, p ->> 'id_doc_number', p ->> 'id_doc_path', p ->> 'selfie_path',
    coalesce((p ->> 'is_foreign_national')::boolean, false),
    p ->> 'passport_number', p ->> 'visa_number', (p ->> 'visa_expiry')::date,
    coalesce((p ->> 'accepted_rules')::boolean, false),
    (p ->> 'accepted_exit_deduction_paise')::bigint, p_ip, p_user_agent
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION api.public_submit_onboarding(text, jsonb, inet, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.public_submit_onboarding(text, jsonb, inet, text) TO pgcrm_app;

ALTER TABLE residents
  DROP CONSTRAINT residents_police_date_check,
  DROP COLUMN police_verification_date,
  DROP COLUMN police_verification_status,
  DROP COLUMN emergency_contact_relation,
  DROP COLUMN vehicle_number,
  DROP COLUMN food_preference;
ALTER TABLE onboarding_requests
  DROP COLUMN emergency_contact_relation,
  DROP COLUMN vehicle_number,
  DROP COLUMN food_preference;
DROP TYPE police_verification_status;
DROP TYPE food_preference;
