-- migrate:up

-- Decided billing rules (docs/PRODUCT.md -> "Billing rules"): rent is per calendar month, due by a day the
-- owner chooses per property (default the 5th). At joining the resident pays a refundable security deposit
-- plus a one-time, non-refundable maintenance charge, both set by the owner per property.
ALTER TABLE properties
  ADD COLUMN rent_due_day smallint NOT NULL DEFAULT 5 CHECK (rent_due_day BETWEEN 1 AND 28),
  ADD COLUMN security_deposit_paise bigint NOT NULL DEFAULT 0 CHECK (security_deposit_paise >= 0),
  ADD COLUMN maintenance_charge_paise bigint NOT NULL DEFAULT 0 CHECK (maintenance_charge_paise >= 0),
  -- notice given on/before this day of a month => that month is the last one (see BE-24)
  ADD COLUMN notice_deadline_day smallint NOT NULL DEFAULT 5 CHECK (notice_deadline_day BETWEEN 1 AND 28);

-- Not used by any statement below (a new enum value can't be used in the transaction that adds it).
ALTER TYPE invoice_kind ADD VALUE 'maintenance_charge';

-- Billing is calendar-month for everyone, so the per-stay anniversary day is no longer used.
ALTER TABLE stays DROP COLUMN billing_day;   -- also drops its CHECK constraints

-- Residents see the official charges and the notice rule before they join (threat #2).
CREATE OR REPLACE FUNCTION api.public_join_info(p_qr_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'property_name',          p.name,
    'locality',               p.locality,
    'organization_name',      o.name,
    'house_rules',            p.house_rules,
    'exit_deduction_paise',   p.exit_deduction_paise,
    'short_term_daily_rate_paise', p.short_term_daily_rate_paise,
    'upi_vpa',                p.upi_vpa,
    'upi_payee_name',         p.upi_payee_name,
    'rent_due_day',           p.rent_due_day,
    'security_deposit_paise', p.security_deposit_paise,
    'maintenance_charge_paise', p.maintenance_charge_paise,
    'notice_deadline_day',    p.notice_deadline_day
  )
  FROM properties p JOIN organizations o ON o.id = p.org_id
  WHERE p.qr_slug = p_qr_slug AND p.is_active
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION api.public_join_info(p_qr_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'property_name',          p.name,
    'locality',               p.locality,
    'organization_name',      o.name,
    'house_rules',            p.house_rules,
    'exit_deduction_paise',   p.exit_deduction_paise,
    'short_term_daily_rate_paise', p.short_term_daily_rate_paise,
    'upi_vpa',                p.upi_vpa,
    'upi_payee_name',         p.upi_payee_name
  )
  FROM properties p JOIN organizations o ON o.id = p.org_id
  WHERE p.qr_slug = p_qr_slug AND p.is_active
$$;

-- Re-added nullable: the old "monthly stays need a billing_day" CHECK can't hold for rows created meanwhile.
ALTER TABLE stays ADD COLUMN billing_day smallint CHECK (billing_day BETWEEN 1 AND 28);

-- Enum values can't be dropped: 'maintenance_charge' stays in invoice_kind.

ALTER TABLE properties
  DROP COLUMN notice_deadline_day,
  DROP COLUMN maintenance_charge_paise,
  DROP COLUMN security_deposit_paise,
  DROP COLUMN rent_due_day;
