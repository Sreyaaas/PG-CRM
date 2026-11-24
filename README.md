# PG-CRM

Operating system for multi-building PG owners in Bengaluru: onboarding by QR, rent straight to the owner's own
UPI (0% fees), CSV reconciliation, and caretaker anti-theft controls enforced by the database.

- Product context and threat model: [docs/PRODUCT.md](docs/PRODUCT.md)
- Work split and MVP tickets: [docs/MVP-TICKETS.md](docs/MVP-TICKETS.md)

## Stack

| Layer | Choice | Owner |
|---|---|---|
| Frontend | React + TypeScript + Vite, installable PWA | frontend dev → [frontend/](frontend/README.md) |
| API | Python, FastAPI, psycopg 3 (plain SQL); may move to Rust later | backend dev → [backend/](backend/README.md) |
| Database | PostgreSQL 17: RLS, triggers, plain-SQL migrations | backend dev → [db/](db/README.md) |
| Files | S3-compatible private bucket (RustFS locally) | backend dev |
| Contract | [contract/openapi.json](contract/openapi.json), generated from the API, consumed by the frontend | both |

```
Phone (PWA)  ──HTTPS/JSON──►  FastAPI  ──►  PostgreSQL (rules + RLS live here)
                                  └──────►  Object storage (KYC, selfies, bill photos)
```

## Repository layout

```
backend/     FastAPI app, tests, scripts (migrate, seed, export OpenAPI)
db/          migrations (dbmate format)
contract/    openapi.json: the frontend/backend agreement
frontend/    PWA (to be scaffolded, ticket FE-00)
docs/        product context, MVP tickets
```

## Quick start (backend)

```bash
docker compose up -d db s3
cd backend && cp .env.example .env && uv sync
uv run python scripts/migrate.py
uv run python scripts/seed_dev.py
uv run uvicorn app.main:app --reload      # http://localhost:8000/docs
uv run pytest
```

## Ground rules

1. **Security rules live in Postgres**: RLS on every table, no DELETE anywhere on business data, guard triggers for
   money and occupancy. The API passes in *who* is asking; the database decides what they may do.
2. **Contract first**: backend updates `contract/openapi.json` before the frontend builds a screen on it.
3. **Money is integer paise** end to end.
4. **Residents never log in**: the only public routes are `/join/<qr_slug>` and `/receipt/<token>`.
