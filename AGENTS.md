# Working rules for anyone changing this repo (people and AI coding agents)

Read this before writing code. If a rule here conflicts with what an issue seems to ask, stop and ask on the issue.

## Read first
1. [README.md](README.md): stack, layout, ground rules
2. [docs/PRODUCT.md](docs/PRODUCT.md): who it's for and the 6 theft threats every feature must respect
3. The GitHub issue you're working on: it is the spec. Backend: [backend/README.md](backend/README.md),
   [db/README.md](db/README.md). Frontend: [frontend/README.md](frontend/README.md).

## Don't guess
- Build exactly what the issue says. Don't invent endpoints, fields, tables, enum values, libraries or user flows.
- If something is missing, unclear or contradicts the code: **comment on the issue and wait**. Open decisions are
  tracked in the "Decide: open MVP questions" issue; don't settle them yourself.
- Stay in scope: one issue = one PR (`Closes #N`). Put other ideas in new issues.

## Non-negotiables
- **Security lives in Postgres.** RLS on every table, no DELETE on business data, guard triggers for money and
  occupancy, `api.*` SECURITY DEFINER functions for public/login paths. Never weaken, bypass or "temporarily
  disable" them. A new rule = a new migration + a test in `backend/tests/test_db_rules.py`.
- Never edit a migration that has already been merged; add a new one.
- Backend queries only through `app.db.transaction()` / `OrgContext.tx()` (sets the RLS role and context).
- Never trust the JWT for roles; roles come from `organization_members` in the DB.
- Money is **integer paise** everywhere (DB `bigint`, JSON integers). No floats for money.
- Error shape is always `{"error": {"code": "...", "message": "..."}}`.
- Residents never log in. The only public routes are `/join/<qr_slug>` and `/receipt/<token>`, and they must never
  return phone numbers, KYC data or other residents' data.
- No resident app, no WhatsApp Business API (use `wa.me` links), no payment gateway, no per-bed electricity.
- Frontend uses only what's in `contract/openapi.json`. Backend regenerates and commits it with every API change.

## Commands
```bash
# backend (needs Postgres: docker compose up -d db minio)
cd backend && uv sync && uv run python scripts/migrate.py && uv run pytest && uv run ruff check .
uv run python scripts/export_openapi.py     # after any API change

# frontend (after FE-00)
cd frontend && npm run gen:api && npm run typecheck && npm run build
```
