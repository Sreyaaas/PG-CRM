-- migrate:up

-- ===========================================================================
-- Narrow SECURITY DEFINER entry points for things RLS alone cannot express:
--   * unauthenticated routes (/join, /receipt) — no user context exists
--   * login (needs password_hash, which pgcrm_app cannot SELECT)
--   * signup / adding staff (creates users + memberships)
--   * owner reports that must see every row regardless of assignment
-- Everything lives in schema "api" so it is easy to audit.
-- ===========================================================================

CREATE SCHEMA api;
GRANT USAGE ON SCHEMA api TO pgcrm_app;

-- ---------------------------------------------------------------------------
-- Auth
-- ---------------------------------------------------------------------------

CREATE FUNCTION api.auth_get_credentials(p_phone text)
RETURNS TABLE (user_id uuid, password_hash text, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, password_hash, is_active FROM users WHERE phone = p_phone
$$;

-- Owner self-signup: creates user + organization + owner membership.
CREATE FUNCTION api.signup_owner(p_phone text, p_full_name text, p_password_hash text, p_org_name text)
RETURNS TABLE (user_id uuid, org_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid;
  v_org  uuid;
BEGIN
  INSERT INTO users (phone, full_name, password_hash)
  VALUES (p_phone, p_full_name, p_password_hash)
  RETURNING id INTO v_user;

  INSERT INTO organizations (name) VALUES (p_org_name) RETURNING id INTO v_org;

  INSERT INTO organization_members (org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  RETURN QUERY SELECT v_user, v_org;
END
$$;

-- Owner adds a caretaker (or co-owner) to the current org. If the phone
-- already has an account, only a membership is added (password untouched).
CREATE FUNCTION api.add_staff_member(
  p_phone text, p_full_name text, p_password_hash text,
  p_role member_role, p_property_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org  uuid := app.current_org_id();
  v_user uuid;
BEGIN
  PERFORM app.require_owner('add staff');
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(p_property_ids, '{}')) pid
    WHERE NOT EXISTS (SELECT 1 FROM properties p WHERE p.id = pid AND p.org_id = v_org)
  ) THEN
    RAISE EXCEPTION 'Property does not belong to this organization' USING ERRCODE = 'PC003';
  END IF;

  SELECT id INTO v_user FROM users WHERE phone = p_phone;
  IF v_user IS NULL THEN
    INSERT INTO users (phone, full_name, password_hash)
    VALUES (p_phone, p_full_name, p_password_hash)
    RETURNING id INTO v_user;
  END IF;

  INSERT INTO organization_members (org_id, user_id, role, assigned_property_ids)
  VALUES (v_org, v_user, p_role, coalesce(p_property_ids, '{}'));
  RETURN v_user;
END
$$;

-- ---------------------------------------------------------------------------
-- Public Reception QR: /join/<qr_slug>
-- ---------------------------------------------------------------------------

CREATE FUNCTION api.public_join_info(p_qr_slug text) RETURNS jsonb
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

-- Write-only intake. Returns the request id (a receipt for the submitter).
CREATE FUNCTION api.public_submit_onboarding(
  p_qr_slug text, p jsonb, p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prop properties%ROWTYPE;
  v_id   uuid;
BEGIN
  SELECT * INTO v_prop FROM properties WHERE qr_slug = p_qr_slug AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown QR code' USING ERRCODE = 'PC003';
  END IF;
  IF (p ->> 'accepted_exit_deduction_paise')::bigint IS DISTINCT FROM v_prop.exit_deduction_paise THEN
    RAISE EXCEPTION 'Exit deduction shown to the resident does not match the current amount' USING ERRCODE = 'PC003';
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

-- ---------------------------------------------------------------------------
-- Public tokenized documents: /receipt/<token>
-- Returns only what a resident should see. Never phone numbers or KYC.
-- ---------------------------------------------------------------------------

CREATE FUNCTION api.public_get_document(p_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 64 THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
      'type', 'payment_receipt',
      'receipt_no', left(pay.id::text, 8),
      'amount_paise', pay.amount_paise,
      'method', pay.method,
      'utr_number', pay.utr_number,
      'status', CASE WHEN pay.voided_at IS NOT NULL THEN 'void' ELSE pay.status::text END,
      'received_at', pay.received_at,
      'resident_name', r.full_name,
      'property_name', p.name,
      'invoice_no', i.invoice_no,
      'period_start', i.period_start,
      'period_end', i.period_end)
    INTO v
    FROM payments pay
    JOIN residents r  ON r.id = pay.resident_id
    JOIN properties p ON p.id = pay.property_id
    LEFT JOIN invoices i ON i.id = pay.invoice_id
   WHERE pay.public_token = p_token;
  IF v IS NOT NULL THEN RETURN v; END IF;

  SELECT jsonb_build_object(
      'type', 'invoice',
      'invoice_no', i.invoice_no,
      'kind', i.kind,
      'amount_paise', i.amount_paise,
      'paid_paise', coalesce((SELECT sum(x.amount_paise) FROM payments x
                               WHERE x.invoice_id = i.id AND x.voided_at IS NULL), 0),
      'due_date', i.due_date,
      'period_start', i.period_start,
      'period_end', i.period_end,
      'status', CASE WHEN i.voided_at IS NOT NULL THEN 'void' END,
      'resident_name', r.full_name,
      'property_name', p.name,
      -- For the dynamic UPI QR (upi://pay?pa=..&pn=..&am=..&tn=<invoice_no>)
      'upi_vpa', p.upi_vpa,
      'upi_payee_name', p.upi_payee_name,
      'upi_mcc', p.upi_mcc,
      'fallback_upi_id', p.fallback_upi_id,
      'bank_details', p.bank_details)
    INTO v
    FROM invoices i
    JOIN residents r  ON r.id = i.resident_id
    JOIN properties p ON p.id = i.property_id
   WHERE i.public_token = p_token;
  IF v IS NOT NULL THEN RETURN v; END IF;

  SELECT jsonb_build_object(
      'type', 'exit_settlement',
      'resident_name', r.full_name,
      'property_name', p.name,
      'check_in_date', s.check_in_date,
      'vacate_date', s.actual_vacate_date,
      'deposit_paise', es.deposit_paise,
      'exit_deduction_paise', es.exit_deduction_paise,
      'other_deductions_paise', es.other_deductions_paise,
      'other_deductions_note', es.other_deductions_note,
      'pending_dues_paise', es.pending_dues_paise,
      'net_refund_paise', es.net_refund_paise,
      'refund_method', es.refund_method,
      'refund_utr', es.refund_utr,
      'settled_at', es.settled_at)
    INTO v
    FROM exit_settlements es
    JOIN stays s      ON s.id = es.stay_id
    JOIN residents r  ON r.id = es.resident_id
    JOIN properties p ON p.id = es.property_id
   WHERE es.public_token = p_token;
  RETURN v;
END
$$;

-- ---------------------------------------------------------------------------
-- Cash-in-hand ledger (#1)
-- collected cash - cash expenses paid by that caretaker - owner-confirmed handovers
-- Owner: every caretaker in the org. Caretaker: only themself.
-- ---------------------------------------------------------------------------

CREATE FUNCTION api.cash_balances()
RETURNS TABLE (
  user_id uuid, full_name text,
  collected_paise bigint, spent_paise bigint, handed_over_paise bigint, in_hand_paise bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH staff AS (
    SELECT m.user_id, u.full_name
      FROM organization_members m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = app.current_org_id()
       AND m.role = 'caretaker'
       AND app.is_member()
       AND (app.is_owner() OR m.user_id = app.current_user_id())
  ), c AS (
    SELECT received_by AS user_id, sum(amount_paise)::bigint AS v FROM payments
     WHERE org_id = app.current_org_id() AND method = 'cash' AND voided_at IS NULL
     GROUP BY received_by
  ), e AS (
    SELECT created_by AS user_id, sum(amount_paise)::bigint AS v FROM expenses
     WHERE org_id = app.current_org_id() AND paid_from = 'caretaker_cash' AND voided_at IS NULL
     GROUP BY created_by
  ), h AS (
    SELECT caretaker_user_id AS user_id, sum(amount_paise)::bigint AS v FROM cash_handovers
     WHERE org_id = app.current_org_id()
     GROUP BY caretaker_user_id
  )
  SELECT s.user_id, s.full_name,
         coalesce(c.v, 0), coalesce(e.v, 0), coalesce(h.v, 0),
         coalesce(c.v, 0) - coalesce(e.v, 0) - coalesce(h.v, 0)
    FROM staff s
    LEFT JOIN c ON c.user_id = s.user_id
    LEFT JOIN e ON e.user_id = s.user_id
    LEFT JOIN h ON h.user_id = s.user_id
   ORDER BY s.full_name
$$;

-- ---------------------------------------------------------------------------
-- Owner P&L per property for a date range (owner only)
-- ---------------------------------------------------------------------------

CREATE FUNCTION api.owner_pnl(p_from date, p_to date)
RETURNS TABLE (
  property_id uuid, property_name text,
  collected_verified_paise bigint, collected_cash_paise bigint, provisional_paise bigint,
  flagged_paise bigint, expenses_paise bigint, net_paise bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.require_owner('view profit and loss');
  RETURN QUERY
  WITH pay AS (
    SELECT x.property_id,
           sum(x.amount_paise) FILTER (WHERE x.status = 'verified')::bigint    AS verified,
           sum(x.amount_paise) FILTER (WHERE x.status = 'recorded')::bigint    AS cash,
           sum(x.amount_paise) FILTER (WHERE x.status = 'provisional')::bigint AS provisional,
           sum(x.amount_paise) FILTER (WHERE x.status = 'flagged')::bigint     AS flagged
      FROM payments x
     WHERE x.org_id = app.current_org_id() AND x.voided_at IS NULL
       AND (x.received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
     GROUP BY x.property_id
  ), exp AS (
    SELECT x.property_id, sum(x.amount_paise)::bigint AS total
      FROM expenses x
     WHERE x.org_id = app.current_org_id() AND x.voided_at IS NULL
       AND x.expense_date BETWEEN p_from AND p_to
     GROUP BY x.property_id
  )
  SELECT p.id, p.name,
         coalesce(pay.verified, 0), coalesce(pay.cash, 0), coalesce(pay.provisional, 0),
         coalesce(pay.flagged, 0), coalesce(exp.total, 0),
         coalesce(pay.verified, 0) + coalesce(pay.cash, 0) - coalesce(exp.total, 0)
    FROM properties p
    LEFT JOIN pay ON pay.property_id = p.id
    LEFT JOIN exp ON exp.property_id = p.id
   WHERE p.org_id = app.current_org_id()
   ORDER BY p.name;
END
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA api TO pgcrm_app;

-- migrate:down
DROP SCHEMA IF EXISTS api CASCADE;
