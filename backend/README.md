# Backend (API)

FastAPI + psycopg 3 (hand-written SQL, no ORM) + Postgres. Built so a later Rust rewrite (Axum + sqlx) can reuse
the same database, migrations and `contract/openapi.json` unchanged.

## Run locally

Needs Python 3.11+, [uv](https://docs.astral.sh/uv/), Docker.

```bash
docker compose up -d db s3                  # from repo root
cd backend
cp .env.example .env
uv sync
uv run python scripts/migrate.py            # apply db/migrations
uv run python scripts/seed_dev.py           # demo org (logins in the script's docstring)
uv run uvicorn app.main:app --reload        # http://localhost:8000/docs
```

## Test

```bash
uv run pytest        # needs the migrated database from above (PGCRM_DATABASE_URL)
uv run ruff check .
```

## Ticket verification

Tag each test with the acceptance criteria it proves, then verify the ticket from the repo root:

```python
@pytest.mark.ac("BE-31", "AC3")
def test_duplicate_utr_is_409(): ...
```

```bash
python tools/verify_ticket.py BE-31
```

## After changing the API

```bash
uv run python scripts/export_openapi.py     # writes ../contract/openapi.json; commit it
```

## How a request is authorized

1. `Authorization: Bearer <jwt>`: the token holds the user id only.
2. `X-Org-Id`: which organization the request acts on.
3. `OrgContext.tx()` opens a transaction, runs `SET LOCAL ROLE pgcrm_app` and sets `app.user_id` /
   `app.org_id`, then checks membership **in the database**.
4. From there, Row Level Security and the guard triggers decide what the user may read or change. Python code
   should not re-implement those rules. If a rule is missing, add it in SQL with a test.

## Layout

```
app/
  main.py        app factory, routers, CORS
  config.py      settings (PGCRM_* env vars)
  db.py          pool + transaction(user, org)   <- the only way to query
  deps.py        auth + org context dependencies
  security.py    argon2 passwords, JWT
  errors.py      DB/HTTP errors -> {"error": {code, message}}
  schemas.py     request/response models (become the OpenAPI contract)
  routers/       one file per area
scripts/         migrate, seed_dev, export_openapi
tests/           test_db_rules.py (the anti-theft spec), test_api.py
```
