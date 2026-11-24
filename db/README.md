# Database

Plain SQL migrations in [dbmate](https://github.com/amacneil/dbmate) format (`-- migrate:up` /
`-- migrate:down`). Language-neutral on purpose: the Python API today and a Rust API later use the same files.

Apply them with either:

```bash
docker compose run --rm migrate                        # dbmate in Docker
cd backend && uv run python scripts/migrate.py         # no dbmate needed
```

## What lives here (and why)

All the anti-theft rules are enforced **inside Postgres**, so no API bug can bypass them:

| File | Contents |
|---|---|
| `*_roles_and_context.sql` | `pgcrm_app` role, request context (`app.user_id`, `app.org_id`), error codes |
| `*_orgs_properties_beds.sql` | organizations, staff users, memberships, properties, rooms, beds |
| `*_residents_and_stays.sql` | role helpers, onboarding requests, residents, discount requests, stays |
| `*_ledger.sql` | invoices, payments (unique UTR), cash handovers, expenses, CSV imports, exit settlements |
| `*_guards_and_audit.sql` | audit log, no-delete triggers, floor-price lock, backdating rules, payment/expense rules |
| `*_rls_policies.sql` | Row Level Security on every table + grants (no DELETE grant anywhere) |
| `*_api_functions.sql` | `api.*` functions: login lookup, signup, add staff, public join/receipt, cash balances, P&L |

The tests in `backend/tests/test_db_rules.py` are the executable spec for these rules.

## Error codes raised by the DB

| SQLSTATE | Meaning | HTTP |
|---|---|---|
| `PC001` | append-only / immutable data | 409 |
| `PC002` | caretaker tried an owner-only action | 403 |
| `PC003` | business validation failed | 422 |
| `23505` | duplicate (e.g. UTR already used) | 409 |
| `42501` | RLS / privilege denied | 403 |

## Rules for new migrations

1. Every new table: `org_id` (+ `property_id` if it belongs to a building, with the composite FK to
   `properties (id, org_id)`), `ENABLE ROW LEVEL SECURITY`, explicit policies, explicit `GRANT`s to `pgcrm_app`
   (never `DELETE`), indexes on `org_id` / `property_id` / FK columns.
2. Financial or occupancy data: add it to the no-delete and audit trigger lists.
3. Money is `bigint` paise, columns end in `_paise`.
4. New `SECURITY DEFINER` functions go in schema `api` (or `app` for internals), set `search_path`, and
   `REVOKE ... FROM PUBLIC` then `GRANT EXECUTE ... TO pgcrm_app`.
5. Never edit a migration that has run on a shared database: add a new one.
