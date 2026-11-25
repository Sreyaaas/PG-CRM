-- Production / staging database roles (BE-52). Run ONCE per environment, as an admin role
-- (the superuser locally; on Supabase the `postgres` role), BEFORE the first migration:
--
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v dbname=pgcrm -v migrator_password='...' -v api_password='...' -f db/prod/roles.sql
--
-- Why: the API must never connect as a superuser or as the tables' owner; both bypass Row Level Security.
--   pgcrm_migrator  owns the schema and runs migrations (release step only). Owning the tables means the
--                   `api.*` SECURITY DEFINER functions it owns can do their narrow job, exactly as in dev.
--   pgcrm_api       what the API logs in as. No superuser, no BYPASSRLS, NOINHERIT: it holds no privileges
--                   of its own and can only act after `SET LOCAL ROLE pgcrm_app`, which app/db.py does in
--                   every transaction. The API refuses to start in prod if this isn't true (app/startup.py).
--   pgcrm_app       the RLS-bound role every request runs as (NOLOGIN). Created here so the migrator needs
--                   no CREATEROLE; the first migration skips creating it when it exists.

CREATE ROLE pgcrm_migrator LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'migrator_password';
CREATE ROLE pgcrm_api      LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD :'api_password';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgcrm_app') THEN
    CREATE ROLE pgcrm_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

-- The API may switch into pgcrm_app (and only that). With NOINHERIT it gets nothing until it does.
GRANT pgcrm_app TO pgcrm_api;

-- The migrator creates schemas (app, api) and the tables in public.
GRANT CONNECT, CREATE ON DATABASE :"dbname" TO pgcrm_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO pgcrm_migrator;
GRANT CONNECT ON DATABASE :"dbname" TO pgcrm_api;
-- Nobody else gets to create objects in public (Postgres 15+ default, made explicit).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
