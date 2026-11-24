-- migrate:up

-- ===========================================================================
-- Row Level Security on every table + privileges for the API role.
-- No DELETE privilege is granted to pgcrm_app anywhere.
-- Policies call helpers via (SELECT ...) so they are evaluated once per query.
-- ===========================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pgcrm_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

-- organizations --------------------------------------------------------------
GRANT SELECT, UPDATE (name) ON organizations TO pgcrm_app;
CREATE POLICY org_select ON organizations FOR SELECT TO pgcrm_app
  USING (id IN (SELECT m.org_id FROM organization_members m WHERE m.user_id = (SELECT app.current_user_id()) AND m.is_active));
CREATE POLICY org_update ON organizations FOR UPDATE TO pgcrm_app
  USING (id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()))
  WITH CHECK (id = (SELECT app.current_org_id()));

-- users (password_hash is never readable by the API role) ---------------------
GRANT SELECT (id, phone, full_name, is_active, created_at, updated_at) ON users TO pgcrm_app;
GRANT UPDATE (full_name, password_hash) ON users TO pgcrm_app;
CREATE POLICY users_select ON users FOR SELECT TO pgcrm_app
  USING (
    id = (SELECT app.current_user_id())
    OR id IN (SELECT m.user_id FROM organization_members m WHERE m.org_id = (SELECT app.current_org_id()))
  );
CREATE POLICY users_update_self ON users FOR UPDATE TO pgcrm_app
  USING (id = (SELECT app.current_user_id()))
  WITH CHECK (id = (SELECT app.current_user_id()));

-- organization_members ---------------------------------------------------------
GRANT SELECT ON organization_members TO pgcrm_app;
GRANT UPDATE (role, assigned_property_ids, is_active) ON organization_members TO pgcrm_app;
CREATE POLICY members_select ON organization_members FOR SELECT TO pgcrm_app
  USING (
    user_id = (SELECT app.current_user_id())                       -- my memberships (for org picker)
    OR (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_member()))
  );
CREATE POLICY members_update ON organization_members FOR UPDATE TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()) AND user_id <> (SELECT app.current_user_id()))
  WITH CHECK (org_id = (SELECT app.current_org_id()));

-- Property-scoped tables: same read rule everywhere --------------------------
-- properties, rooms, beds: read by anyone with access, written by owner only.
GRANT SELECT, INSERT, UPDATE ON properties, rooms, beds TO pgcrm_app;

-- (is_owner() is checked explicitly so INSERT ... RETURNING works for a
-- property created in the same statement.)
CREATE POLICY properties_select ON properties FOR SELECT TO pgcrm_app
  USING (
    org_id = (SELECT app.current_org_id())
    AND ((SELECT app.is_owner()) OR id = ANY ((SELECT app.accessible_property_ids())::uuid[]))
  );
CREATE POLICY properties_insert ON properties FOR INSERT TO pgcrm_app
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()));
CREATE POLICY properties_update ON properties FOR UPDATE TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()))
  WITH CHECK (org_id = (SELECT app.current_org_id()));

CREATE POLICY rooms_select ON rooms FOR SELECT TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[]));
CREATE POLICY rooms_insert ON rooms FOR INSERT TO pgcrm_app
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()));
CREATE POLICY rooms_update ON rooms FOR UPDATE TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()))
  WITH CHECK (org_id = (SELECT app.current_org_id()));

CREATE POLICY beds_select ON beds FOR SELECT TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[]));
CREATE POLICY beds_insert ON beds FOR INSERT TO pgcrm_app
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()));
CREATE POLICY beds_update ON beds FOR UPDATE TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()))
  WITH CHECK (org_id = (SELECT app.current_org_id()));

-- Day-to-day desk tables: owner + caretakers of that property can read/write.
-- (Column-level rules for each are enforced by the guard triggers.)
GRANT SELECT, UPDATE ON onboarding_requests TO pgcrm_app;     -- INSERT only via public_submit_onboarding()
GRANT SELECT, INSERT, UPDATE ON residents, stays, discount_requests, invoices, payments, expenses TO pgcrm_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['onboarding_requests', 'residents', 'stays', 'discount_requests', 'invoices', 'payments'] LOOP
    EXECUTE format($p$
      CREATE POLICY %1$s_select ON %1$I FOR SELECT TO pgcrm_app
        USING (org_id = (SELECT app.current_org_id()) AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[]))
    $p$, t);
    EXECUTE format($p$
      CREATE POLICY %1$s_update ON %1$I FOR UPDATE TO pgcrm_app
        USING (org_id = (SELECT app.current_org_id()) AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[]))
        WITH CHECK (org_id = (SELECT app.current_org_id()) AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[]))
    $p$, t);
    IF t <> 'onboarding_requests' THEN
      EXECUTE format($p$
        CREATE POLICY %1$s_insert ON %1$I FOR INSERT TO pgcrm_app
          WITH CHECK (org_id = (SELECT app.current_org_id()) AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[]))
      $p$, t);
    END IF;
  END LOOP;
END
$$;

-- expenses: caretakers never see owner_only rows (e.g. building lease rent).
CREATE POLICY expenses_select ON expenses FOR SELECT TO pgcrm_app
  USING (
    org_id = (SELECT app.current_org_id())
    AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[])
    AND (NOT owner_only OR (SELECT app.is_owner()))
  );
CREATE POLICY expenses_insert ON expenses FOR INSERT TO pgcrm_app
  WITH CHECK (
    org_id = (SELECT app.current_org_id())
    AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[])
    AND (NOT owner_only OR (SELECT app.is_owner()))
  );
CREATE POLICY expenses_update ON expenses FOR UPDATE TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()))
  WITH CHECK (org_id = (SELECT app.current_org_id()));

-- cash_handovers: owner sees all and records; caretaker sees only their own.
GRANT SELECT, INSERT ON cash_handovers TO pgcrm_app;
CREATE POLICY handovers_select ON cash_handovers FOR SELECT TO pgcrm_app
  USING (
    org_id = (SELECT app.current_org_id())
    AND ((SELECT app.is_owner()) OR caretaker_user_id = (SELECT app.current_user_id()))
  );
CREATE POLICY handovers_insert ON cash_handovers FOR INSERT TO pgcrm_app
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()));

-- Owner-only tables --------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON csv_imports TO pgcrm_app;
GRANT SELECT, INSERT ON csv_import_rows, exit_settlements TO pgcrm_app;
GRANT SELECT ON audit_logs TO pgcrm_app;

CREATE POLICY csv_imports_all ON csv_imports FOR ALL TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()))
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()));
CREATE POLICY csv_import_rows_all ON csv_import_rows FOR ALL TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()))
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()));
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()));

-- Settlements: caretakers can view (to explain to the resident), owner settles.
CREATE POLICY settlements_select ON exit_settlements FOR SELECT TO pgcrm_app
  USING (org_id = (SELECT app.current_org_id()) AND property_id = ANY ((SELECT app.accessible_property_ids())::uuid[]));
CREATE POLICY settlements_insert ON exit_settlements FOR INSERT TO pgcrm_app
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_owner()));

-- org_counters: only touched through app.next_number() (SECURITY DEFINER).

-- Functions: lock down, then grant what the API needs.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO pgcrm_app;

-- migrate:down
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pgcrm_app;
