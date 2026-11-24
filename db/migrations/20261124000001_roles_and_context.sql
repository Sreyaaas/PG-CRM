-- migrate:up

-- ---------------------------------------------------------------------------
-- How authorization works (read this first)
--
-- * The API never queries tables as a privileged user. Every request runs
--   inside a transaction that does:
--       SET LOCAL ROLE pgcrm_app;
--       SELECT set_config('app.user_id', '<uuid>', true);
--       SELECT set_config('app.org_id',  '<uuid>', true);
-- * Row Level Security policies read those two settings and look up the
--   caller's role in organization_members (never from the JWT).
-- * Public (unauthenticated) routes run as pgcrm_app with NO user id set:
--   every policy then denies, and they may only call the narrow
--   SECURITY DEFINER functions in public_api.sql.
-- This design is language-neutral: the Python API today and a Rust API
-- later get identical guarantees because the rules live here.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgcrm_app') THEN
    CREATE ROLE pgcrm_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO pgcrm_app;
GRANT USAGE ON SCHEMA public TO pgcrm_app;

-- Request context ----------------------------------------------------------

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app.current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;

-- "Today" for business rules is always Bengaluru time, never server UTC.
CREATE FUNCTION app.today_ist() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date
$$;

-- Custom SQLSTATEs the API maps to HTTP errors:
--   PC001 append_only      -> 409  (delete / edit of immutable financial data)
--   PC002 forbidden        -> 403  (caretaker attempted an owner-only action)
--   PC003 invalid          -> 422  (business validation failed)
--   23505 unique_violation -> 409  (e.g. duplicate UTR)

CREATE FUNCTION app.forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: rows cannot be deleted. Void or reverse instead.', TG_TABLE_NAME
    USING ERRCODE = 'PC001';
END
$$;

CREATE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- 64 hex chars (~244 random bits) for unguessable public links.
CREATE FUNCTION app.random_token() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

-- migrate:down
DROP FUNCTION IF EXISTS app.random_token();
DROP FUNCTION IF EXISTS app.touch_updated_at();
DROP FUNCTION IF EXISTS app.forbid_delete();
DROP FUNCTION IF EXISTS app.today_ist();
DROP FUNCTION IF EXISTS app.current_org_id();
DROP FUNCTION IF EXISTS app.current_user_id();
DROP SCHEMA IF EXISTS app;
