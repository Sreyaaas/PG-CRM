-- migrate:up

-- Conventions
--   * Money is stored as BIGINT paise (₹1 = 100). JSON carries integer paise.
--   * Every org-owned table has org_id; every building-owned table also has
--     property_id, with a composite FK so a row can never point at another
--     org's property.

CREATE TYPE member_role AS ENUM ('owner', 'caretaker');
CREATE TYPE bed_status  AS ENUM ('vacant', 'reserved', 'occupied', 'on_notice');

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Staff accounts only (owners and caretakers). Residents never log in.
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone          text NOT NULL UNIQUE CHECK (phone ~ '^[6-9][0-9]{9}$'),
  full_name      text NOT NULL CHECK (length(trim(full_name)) > 0),
  password_hash  text NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES organizations(id),
  user_id                uuid NOT NULL REFERENCES users(id),
  role                   member_role NOT NULL,
  assigned_property_ids  uuid[] NOT NULL DEFAULT '{}',
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX idx_org_members_user ON organization_members (user_id);
CREATE INDEX idx_org_members_org  ON organization_members (org_id);

CREATE TABLE properties (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                        uuid NOT NULL REFERENCES organizations(id),
  name                          text NOT NULL CHECK (length(trim(name)) > 0),
  address                       text,
  locality                      text,            -- BTM, HSR, Whitefield ...
  -- Public Reception QR -> /join/<qr_slug>
  qr_slug                       text NOT NULL UNIQUE DEFAULT substr(app.random_token(), 1, 12),
  -- Parsed once from the owner's Soundbox QR (pa / pn / mc). Never store sign=.
  upi_vpa                       text,
  upi_payee_name                text,
  upi_mcc                       text,
  fallback_upi_id               text,
  bank_details                  text,            -- shown with copy buttons on receipts
  short_term_daily_rate_paise   bigint CHECK (short_term_daily_rate_paise > 0),
  exit_deduction_paise          bigint NOT NULL DEFAULT 0 CHECK (exit_deduction_paise >= 0),
  house_rules                   text,
  is_active                     boolean NOT NULL DEFAULT true,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);
CREATE INDEX idx_properties_org ON properties (org_id);

CREATE TABLE rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  property_id   uuid NOT NULL,
  label         text NOT NULL,                   -- "204"
  floor         smallint,
  sharing       smallint NOT NULL CHECK (sharing BETWEEN 1 AND 8),
  is_ac         boolean NOT NULL DEFAULT false,
  area_sqft     integer CHECK (area_sqft > 0),   -- for the 70 sq ft/resident rule
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, org_id) REFERENCES properties (id, org_id),
  UNIQUE (property_id, label),
  UNIQUE (id, property_id)
);
CREATE INDEX idx_rooms_org      ON rooms (org_id);
CREATE INDEX idx_rooms_property ON rooms (property_id);

CREATE TABLE beds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  property_id      uuid NOT NULL,
  room_id          uuid NOT NULL,
  label            text NOT NULL,                -- "204-A"
  base_rent_paise  bigint NOT NULL CHECK (base_rent_paise > 0),  -- floor price
  status           bed_status NOT NULL DEFAULT 'vacant',          -- maintained by trigger on stays
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, org_id) REFERENCES properties (id, org_id),
  FOREIGN KEY (room_id, property_id) REFERENCES rooms (id, property_id),
  UNIQUE (room_id, label),
  UNIQUE (id, property_id)
);
CREATE INDEX idx_beds_org      ON beds (org_id);
CREATE INDEX idx_beds_property ON beds (property_id);
CREATE INDEX idx_beds_room     ON beds (room_id);

CREATE TRIGGER trg_organizations_touch BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER trg_users_touch         BEFORE UPDATE ON users         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER trg_members_touch       BEFORE UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER trg_properties_touch    BEFORE UPDATE ON properties    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER trg_rooms_touch         BEFORE UPDATE ON rooms         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER trg_beds_touch          BEFORE UPDATE ON beds          FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- migrate:down
DROP TABLE IF EXISTS beds;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS properties;
DROP TABLE IF EXISTS organization_members;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS organizations;
DROP TYPE IF EXISTS bed_status;
DROP TYPE IF EXISTS member_role;
