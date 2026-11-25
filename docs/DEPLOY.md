# Deploy runbook

How the API goes to staging and production. Most of this file is provider-neutral; the stack chosen for the MVP is
below, and deploying staging on it plus the restore drill is [BE-53](https://github.com/Sreyaaas/PG-CRM/issues/80).

## MVP stack (decided 25 Nov 2026: everything free)

| Piece | Where | Notes |
|---|---|---|
| Frontend + API | **Vercel** Hobby | The API is one Vercel Function (`backend/`, entry `app.main:app`, region `bom1` in `backend/vercel.json`). **Hobby is non-commercial only**: move to Vercel Pro (or Cloudflare Pages for the frontend) before charging owners. |
| Database | **Supabase Free** | Postgres, 500 MB. Pauses after a week with no activity. **No backups of its own**: the nightly job below is the backup. |
| Files | **Supabase Free Storage** | 1 GB, private bucket over the S3 protocol, so the BE-20 code works unchanged. |
| Migrations | GitHub Actions `.github/workflows/migrate.yml` | On every push to `main` that touches `db/migrations/`, as `pgcrm_migrator`. |
| Backups | GitHub Actions `.github/workflows/backup.yml` | Nightly 03:00 IST: `pg_dump` of our schemas, encrypted with `age`, kept 30 days as a private artifact. |
| Errors / uptime | Sentry free plan, any free uptime checker on `/health` | |

### Owner setup checklist (one time)

Only the owner creates accounts and handles secrets; never paste them into the repo, an issue or a chat.

1. **Backup key.** On your own computer: `age-keygen -o pgcrm-backup.key`. Keep that file offline (password
   manager / USB): it is the only way to read backups. Copy the `age1...` public key it prints.
2. **Supabase** (supabase.com, Free plan):
   - New project, region **Mumbai (ap-south-1)** if offered.
   - Run `db/prod/roles.sql` as `postgres` (the `psql` command in "One-time setup" below), with two new long
     passwords.
   - Project Settings, Data API: **turn it off** (the FastAPI app is the only way in). Don't enable Supabase Auth.
   - Storage: create bucket **`pgcrm-private`, not public**. Enable the S3 protocol and create an S3 access key.
   - Connection strings (Connect, pooler). The direct host may be IPv6-only, so use the **pooler** host for all
     three; the pooler user name is `<role>.<project-ref>`:
     - API: **transaction** pooler (port 6543) as `pgcrm_api.<ref>`
     - Migrations and backups: **session** pooler (port 5432) as `pgcrm_migrator.<ref>`
3. **GitHub** (repo, Settings, Secrets and variables, Actions):
   - Secrets: `MIGRATOR_DATABASE_URL` and `BACKUP_DATABASE_URL` (both the session-pooler migrator URL).
   - Variable: `BACKUP_AGE_RECIPIENT` = the `age1...` public key from step 1.
   - Then Actions, "Migrate database", Run workflow (creates the schema); then "Nightly backup", Run workflow.
4. **Vercel** (vercel.com, Hobby): import the GitHub repo as a project with **Root Directory `backend`**, and set the
   environment variables from the table below (`PGCRM_ENVIRONMENT=prod`, the transaction-pooler `pgcrm_api` URL,
   `PGCRM_S3_ENDPOINT=https://<ref>.supabase.co/storage/v1/s3`, the bucket, the S3 key pair, the project region,
   a long random `PGCRM_JWT_SECRET`, and `PGCRM_CORS_ORIGINS=["https://<frontend>.vercel.app"]`). The frontend is a
   second Vercel project with Root Directory `frontend`.
5. Tell the backend dev it's done: they check `/health`, sign up, upload a photo through a presigned URL, and run
   the restore drill (below).

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
| `PGCRM_PUBLIC_APP_URL` | `https://<frontend>`: receipt links in WhatsApp messages are `<this>/receipt/<token>` |
| `PGCRM_S3_ENDPOINT` / `_BUCKET` / `_ACCESS_KEY` / `_SECRET_KEY` / `_REGION` | the private bucket. Prod refuses the dev secret |
| `PGCRM_SENTRY_DSN`, `PGCRM_SENTRY_TRACES_SAMPLE_RATE` | error + performance monitoring (BE-51; PII is scrubbed) |
| `PGCRM_TRUST_FORWARDED_FOR` | `true` only behind our own reverse proxy, so per-IP rate limits see the real client |

## Deploy (each release)

**On the MVP stack:** merging to `main` is the release. GitHub Actions applies new migrations as `pgcrm_migrator`
(`migrate.yml`) while Vercel builds and deploys the API from `main`. Because both start together, a migration must
never break the previous API version (add columns/tables; don't rename or drop in the same release). Check
`/health` afterwards. To roll back code, promote the previous deployment in Vercel.

**On a container host:**

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

- **MVP:** the nightly GitHub Actions job is the only backup (Supabase Free has none). It dumps the `public`,
  `app` and `api` schemas with `pg_dump`, encrypts the file to the owner's `age` public key, and keeps it 30 days
  as a private artifact. The same scripts work by hand:
  ```bash
  BACKUP_DATABASE_URL=<migrator url> BACKUP_AGE_RECIPIENT=age1... tools/backup/backup.sh
  AGE_IDENTITY_FILE=pgcrm-backup.key RESTORE_DATABASE_URL=<empty db> tools/backup/restore.sh <file>.dump.age
  ```
  Restore into an **empty** database that already has the roles (`db/prod/roles.sql`), never over the live one.
- On a paid plan, also keep the provider's daily backups (and point-in-time recovery if enabled).
- Files (KYC photos, selfies, bills) are not in the database dump. On the free plan they live only in Supabase
  Storage; copy the bucket now and then until a paid plan adds versioning.

### Restore drill
Run `tools/backup/check.sql` against the live and the restored database and compare the output.

- **Local rehearsal (25 Nov 2026, local Docker Postgres 17):** `backup.sh` made a 4.3 MB encrypted file (unreadable
  by `pg_restore` without the key); `restore.sh` restored it into a new empty database; all 15 checks were equal
  (row counts of every main table, 22 RLS tables, 48 policies, 75 triggers). In the restored copy, `pgcrm_app`
  with no user context saw 0 rows and `DELETE FROM payments` was refused.
- **Staging (BE-53 AC2):** _to do once the owner has set up the stack._ Record: date, which nightly backup,
  restored into what, how long it took, the `check.sql` comparison, and that sign-in and a receipt link work.

## Supabase notes

See the assessment on [BE-52](https://github.com/Sreyaaas/PG-CRM/issues/43). In short: use it as managed Postgres 17
+ Storage only; **turn off the Data API** (or revoke Supabase's default grants to `anon` / `authenticated`); don't
use Supabase Auth; run `db/prod/roles.sql` as `postgres`; API through the transaction pooler (6543), migrations and
backups through the session pooler (5432); keep CI on the Docker `postgres:17` service. Still to confirm on the
real project: presigned PUT/GET through Supabase's S3 endpoint with our boto3 settings (SigV4, path style).
