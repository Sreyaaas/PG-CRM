# Deploy runbook

How the API goes to staging and production. **Hosting is not decided yet** ([BE-52](https://github.com/Sreyaaas/PG-CRM/issues/43));
everything here is provider-neutral. Requirements for whatever is chosen: India region (Mumbai), managed Postgres 17
with daily backups (+ point-in-time recovery if the owner wants it), a private S3-compatible bucket, secrets as
environment variables.

## The one rule that matters

**The API must never connect as a superuser, a `BYPASSRLS` role, or the tables' owner.** All three skip Row Level
Security, which is where the anti-theft rules live. In production the API checks this at startup and **refuses to
start** otherwise (`backend/app/startup.py`). Three roles:

| Role | Login | Used for |
|---|---|---|
| `pgcrm_migrator` | yes | Owns the schema. Runs migrations in the release step. Never used by the running API. |
| `pgcrm_api` | yes | What the API connects as. `NOSUPERUSER NOBYPASSRLS NOINHERIT`: no privileges until `SET LOCAL ROLE pgcrm_app`. |
| `pgcrm_app` | no | The RLS-bound role every request runs as (`app/db.py` switches to it per transaction). |

## One-time setup per environment

1. Create the database (e.g. `pgcrm`) in the India region.
2. Create the roles, as the provider's admin role (on Supabase: `postgres`):
   ```bash
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
        -v dbname=pgcrm -v migrator_password="$MIGRATOR_PW" -v api_password="$API_PW" \
        -f db/prod/roles.sql
   ```
3. Create the private bucket (no public access) and an access key limited to it.
4. Set up the environment variables below as secrets in the host.

Verified locally: every migration runs as `pgcrm_migrator` (no superuser needed), and the whole test suite passes
with the API connected as a `NOINHERIT`, non-`BYPASSRLS` login. The only exceptions are the tests that deliberately
use a superuser connection to prove the triggers hold even when RLS is bypassed.

## Environment variables

| Variable | Production value |
|---|---|
| `PGCRM_ENVIRONMENT` | `prod` (turns on the startup checks below) |
| `PGCRM_DATABASE_URL` | `postgresql://pgcrm_api:…@host:port/pgcrm` (via the provider's **transaction pooler** if it has one; the API needs no prepared statements) |
| `PGCRM_JWT_SECRET` | long random value. Prod refuses the dev default |
| `PGCRM_CORS_ORIGINS` | `["https://<frontend>"]`. Prod refuses `*`, `http://` and `localhost` |
| `PGCRM_S3_ENDPOINT` / `_BUCKET` / `_ACCESS_KEY` / `_SECRET_KEY` / `_REGION` | the private bucket. Prod refuses the dev secret |
| `PGCRM_SENTRY_DSN`, `PGCRM_SENTRY_TRACES_SAMPLE_RATE` | error + performance monitoring (BE-51; PII is scrubbed) |
| `PGCRM_TRUST_FORWARDED_FOR` | `true` only behind our own reverse proxy, so per-IP rate limits see the real client |

## Deploy (each release)

1. **Build** the image from the repo root (it includes `db/migrations`):
   `docker build -f backend/Dockerfile -t pgcrm-api:<git-sha> .`
2. **Release step: migrate**, as `pgcrm_migrator`, *before* the new API version starts:
   `docker run --rm -e PGCRM_DATABASE_URL=<migrator url> pgcrm-api:<git-sha> python scripts/migrate.py`
   Migrations are forward-only and must keep the previous API version working (add columns/tables; don't rename
   or drop in the same release).
3. **Start** the new version with the production environment. It refuses to start if the DB login is unsafe.
4. **Check**: `GET /health` returns `{"status":"ok"}` (the image's `HEALTHCHECK` calls it), then sign in on the app.

The container runs as a non-root user, 2 uvicorn workers, `--no-access-log` (uvicorn's own access log would print
raw paths that can contain receipt tokens; the app logs one redacted JSON line per request instead).

## Monitoring

- Uptime check on `GET /health` every minute, alerting the owner.
- Sentry for errors and performance (`PGCRM_SENTRY_DSN`); request bodies, cookies, auth headers and personal data
  are scrubbed before sending.
- Logs are JSON on stdout with a request id (`X-Request-ID`); phones are masked, tokens and passwords never logged.

## Roll back

- **Code:** redeploy the previous image tag. Because migrations keep the previous version working (step 2), this
  is safe after a migration has run.
- **A bad migration:** never edit a merged migration. Write a new one that fixes forward, and release it.
- **Data:** restore a backup (below).

## Backups and restore

- Daily automatic backups from the provider, kept at least 7 days; point-in-time recovery if enabled.
- Object storage (KYC photos, selfies, bills): enable versioning or a daily copy, if the provider supports it.
- Provider-independent dump, for a second copy or moving providers:
  ```bash
  pg_dump "$MIGRATOR_URL" -Fc --no-owner -f pgcrm-$(date +%F).dump
  pg_restore -d "$NEW_DB_MIGRATOR_URL" --no-owner --role=pgcrm_migrator pgcrm-$(date +%F).dump
  ```
  (Create the roles with `db/prod/roles.sql` on the new database first.)

### Restore drill (BE-52 AC4, to be done on the chosen host)
_Not done yet: needs the hosting decision._ Record here: the date, which backup was restored, into what (a scratch
database), how long it took, and the checks run afterwards (row counts of `properties`, `stays`, `payments`;
sign in; open a receipt link).

## If the host is Supabase

See the assessment on [BE-52](https://github.com/Sreyaaas/PG-CRM/issues/43). In short: use it as managed Postgres 17
+ Storage only, Mumbai region; **turn off the Data API** (or revoke Supabase's default grants to `anon` /
`authenticated`); don't use Supabase Auth; run `db/prod/roles.sql` as `postgres`; connect the API through the
transaction pooler (port 6543); keep CI on the Docker `postgres:17` service. Daily backups need the Pro plan;
point-in-time recovery is a paid add-on.
