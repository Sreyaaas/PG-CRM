-- migrate:up

-- ---------------------------------------------------------------------------
-- Access helpers (database-backed RBAC; JWT claims are never trusted)
-- SECURITY DEFINER so they can read organization_members without recursing
-- into its own RLS policies. Wrap calls in (SELECT ...) inside policies so
-- Postgres evaluates them once per statement, not once per row.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.member_role() RETURNS member_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.role
  FROM organization_members m
  JOIN users u ON u.id = m.user_id AND u.is_active
  WHERE m.org_id = app.current_org_id()
    AND m.user_id = app.current_user_id()
    AND m.is_active
$$;

CREATE FUNCTION app.is_owner() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(app.member_role() = 'owner', false)
$$;

CREATE FUNCTION app.is_member() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.member_role() IS NOT NULL
$$;

-- Owners: every property in the org. Caretakers: only assigned ones.
CREATE FUNCTION app.accessible_property_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(p.id), '{}')
  FROM properties p
  JOIN organization_members m
    ON m.org_id = p.org_id
   AND m.user_id = app.current_user_id()
   AND m.is_active
  JOIN users u ON u.id = m.user_id AND u.is_active
  WHERE p.org_id = app.current_org_id()
    AND (m.role = 'owner' OR p.id = ANY (m.assigned_property_ids))
$$;

CREATE FUNCTION app.require_owner(action text) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT app.is_owner() THEN
    RAISE EXCEPTION 'Only the owner can %', action USING ERRCODE = 'PC002';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Residents ("tenants" in the product spec; renamed to avoid clashing with
-- multi-tenancy). Residents have no login.
-- ---------------------------------------------------------------------------

CREATE TYPE onboarding_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE occupation_type   AS ENUM ('working', 'student', 'other');
CREATE TYPE id_doc_type       AS ENUM ('aadhaar', 'pan', 'driving_licence', 'voter_id', 'passport');

-- Raw submissions from the public Reception QR form (/join/<qr_slug>).
-- Inserted only through public_submit_onboarding(); reviewed by staff.
CREATE TABLE onboarding_requests (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                     uuid NOT NULL,
  property_id                uuid NOT NULL,
  status                     onboarding_status NOT NULL DEFAULT 'pending',
  full_name                  text NOT NULL,
  phone                      text NOT NULL CHECK (phone ~ '^[6-9][0-9]{9}$'),
  email                      text,
  date_of_birth              date,
  permanent_address          text NOT NULL,
  occupation                 occupation_type NOT NULL,
  employer_or_college        text,
  emergency_contact_name     text NOT NULL,
  emergency_contact_phone    text NOT NULL CHECK (emergency_contact_phone ~ '^[0-9+ ]{10,15}$'),
  id_doc_type                id_doc_type NOT NULL,
  id_doc_number              text NOT NULL,
  id_doc_path                text NOT NULL,      -- private object storage key
  selfie_path                text NOT NULL,      -- private object storage key (live capture)
  is_foreign_national        boolean NOT NULL DEFAULT false,
  passport_number            text,
  visa_number                text,
  visa_expiry                date,
  -- Day-1 digital acceptance of house rules + exit deduction (dispute proof)
  accepted_rules             boolean NOT NULL CHECK (accepted_rules),
  accepted_exit_deduction_paise bigint NOT NULL CHECK (accepted_exit_deduction_paise >= 0),
  accepted_at                timestamptz NOT NULL DEFAULT now(),
  submitted_ip               inet,
  submitted_user_agent       text,
  reviewed_by                uuid REFERENCES users(id),
  reviewed_at                timestamptz,
  review_note                text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, org_id) REFERENCES properties (id, org_id),
  CHECK (NOT is_foreign_national OR (passport_number IS NOT NULL AND visa_number IS NOT NULL))
);
CREATE INDEX idx_onboarding_org      ON onboarding_requests (org_id);
CREATE INDEX idx_onboarding_property ON onboarding_requests (property_id, status);

CREATE TABLE residents (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL,
  property_id              uuid NOT NULL,
  onboarding_request_id    uuid UNIQUE REFERENCES onboarding_requests(id),
  full_name                text NOT NULL,
  phone                    text NOT NULL CHECK (phone ~ '^[6-9][0-9]{9}$'),
  email                    text,
  date_of_birth            date,
  permanent_address        text,
  occupation               occupation_type,
  employer_or_college      text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  id_doc_type              id_doc_type,
  id_doc_number            text,
  id_doc_path              text,
  selfie_path              text,
  is_foreign_national      boolean NOT NULL DEFAULT false,
  passport_number          text,
  visa_number              text,
  visa_expiry              date,
  created_by               uuid REFERENCES users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, org_id) REFERENCES properties (id, org_id),
  UNIQUE (id, property_id)
);
CREATE INDEX idx_residents_org      ON residents (org_id);
CREATE INDEX idx_residents_property ON residents (property_id);
CREATE INDEX idx_residents_phone    ON residents (org_id, phone);

-- ---------------------------------------------------------------------------
-- Discount approval gate: caretakers can never set rent below the bed's
-- floor price; they request, the owner approves in one tap.
-- ---------------------------------------------------------------------------

CREATE TYPE request_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE discount_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL,
  property_id           uuid NOT NULL,
  bed_id                uuid NOT NULL,
  resident_id           uuid,
  requested_rent_paise  bigint NOT NULL CHECK (requested_rent_paise > 0),
  reason                text NOT NULL CHECK (length(trim(reason)) >= 3),
  status                request_status NOT NULL DEFAULT 'pending',
  requested_by          uuid NOT NULL REFERENCES users(id),
  decided_by            uuid REFERENCES users(id),
  decided_at            timestamptz,
  decision_note         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, org_id) REFERENCES properties (id, org_id),
  FOREIGN KEY (bed_id, property_id) REFERENCES beds (id, property_id),
  FOREIGN KEY (resident_id, property_id) REFERENCES residents (id, property_id)
);
CREATE INDEX idx_discount_org      ON discount_requests (org_id);
CREATE INDEX idx_discount_property ON discount_requests (property_id, status);
CREATE INDEX idx_discount_bed      ON discount_requests (bed_id);

-- ---------------------------------------------------------------------------
-- Stays: a resident occupying a bed for a period (monthly or short-term).
-- ---------------------------------------------------------------------------

CREATE TYPE stay_type   AS ENUM ('monthly', 'short_term');
CREATE TYPE stay_status AS ENUM ('reserved', 'active', 'on_notice', 'vacated');

CREATE TABLE stays (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL,
  property_id           uuid NOT NULL,
  resident_id           uuid NOT NULL,
  bed_id                uuid NOT NULL,
  stay_type             stay_type NOT NULL,
  status                stay_status NOT NULL DEFAULT 'active',
  -- monthly: agreed monthly rent; short_term: agreed daily rate
  rent_paise            bigint NOT NULL CHECK (rent_paise > 0),
  deposit_paise         bigint NOT NULL DEFAULT 0 CHECK (deposit_paise >= 0),
  billing_day           smallint CHECK (billing_day BETWEEN 1 AND 28),
  check_in_date         date NOT NULL,
  expected_vacate_date  date,
  notice_given_on       date,
  actual_vacate_date    date,
  discount_request_id   uuid REFERENCES discount_requests(id),
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, org_id) REFERENCES properties (id, org_id),
  FOREIGN KEY (bed_id, property_id) REFERENCES beds (id, property_id),
  FOREIGN KEY (resident_id, property_id) REFERENCES residents (id, property_id),
  UNIQUE (id, property_id),
  CHECK (stay_type <> 'monthly' OR billing_day IS NOT NULL),
  CHECK (actual_vacate_date IS NULL OR actual_vacate_date >= check_in_date),
  CHECK ((status = 'vacated') = (actual_vacate_date IS NOT NULL))
);
CREATE INDEX idx_stays_org      ON stays (org_id);
CREATE INDEX idx_stays_property ON stays (property_id, status);
CREATE INDEX idx_stays_resident ON stays (resident_id);
CREATE INDEX idx_stays_bed      ON stays (bed_id);
-- One open stay per bed and per resident.
CREATE UNIQUE INDEX uq_stays_open_bed      ON stays (bed_id)      WHERE status <> 'vacated';
CREATE UNIQUE INDEX uq_stays_open_resident ON stays (resident_id) WHERE status <> 'vacated';

CREATE TRIGGER trg_residents_touch BEFORE UPDATE ON residents FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER trg_stays_touch     BEFORE UPDATE ON stays     FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- migrate:down
DROP TABLE IF EXISTS stays;
DROP TYPE IF EXISTS stay_status;
DROP TYPE IF EXISTS stay_type;
DROP TABLE IF EXISTS discount_requests;
DROP TYPE IF EXISTS request_status;
DROP TABLE IF EXISTS residents;
DROP TABLE IF EXISTS onboarding_requests;
DROP TYPE IF EXISTS id_doc_type;
DROP TYPE IF EXISTS occupation_type;
DROP TYPE IF EXISTS onboarding_status;
DROP FUNCTION IF EXISTS app.require_owner(text);
DROP FUNCTION IF EXISTS app.accessible_property_ids();
DROP FUNCTION IF EXISTS app.is_member();
DROP FUNCTION IF EXISTS app.is_owner();
DROP FUNCTION IF EXISTS app.member_role();
