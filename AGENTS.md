# Working rules for anyone changing this repo (people and AI coding agents)

Read this before writing code. If a rule here conflicts with what an issue seems to ask, stop and ask on the issue.

## Read first
1. [README.md](README.md): stack, layout, ground rules
2. [docs/PRODUCT.md](docs/PRODUCT.md): who it's for and the 6 theft threats every feature must respect
3. The GitHub issue you're working on: it is the spec. Backend: [backend/README.md](backend/README.md),
   [db/README.md](db/README.md). Frontend: [frontend/README.md](frontend/README.md).

## Don't guess
- Build exactly what the issue says. Don't invent endpoints, fields, tables, enum values, libraries or user flows.
- If something is missing, unclear or contradicts the code: **comment on the issue and wait**. Product decisions
  (billing rules etc.) are in [docs/PRODUCT.md](docs/PRODUCT.md); don't change or settle new ones yourself.
- Stay in scope: one issue = one PR. PR title starts with the ticket ID (`BE-31: Log payment`), the description
  says `Closes #N`.

## Proving the work is done (required)
Each issue has numbered acceptance criteria (`**AC1**`, `**AC2**`, …).
- **Automated criteria** need at least one passing test tagged with them:
  - backend: `@pytest.mark.ac("BE-31", "AC1", "AC2")` on the test
  - frontend: put `[FE-21/AC1]` (or `[FE-21/AC1,AC3]`) in the Vitest/Playwright test title
- **`[manual]` criteria**: check them yourself (usually on a real phone), then tick them in the PR description:
  `- [x] AC6 Redmi Note 12, Chrome: 24 s`.
- Run `python tools/verify_ticket.py <ID>` before opening the PR. It runs lint, the whole test suite, the contract
  check and maps tests to criteria. Only open the PR when it says **VERIFIED** (manual ones may still be ⏳).
- CI runs the same verifier on the PR and posts the report as a comment. A PR isn't done until that report is green.
- Never tag a test with a criterion it doesn't really check, and never weaken a criterion to make it pass. If a
  criterion is wrong or impossible, say so on the issue.

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

# verify a ticket (repo root; needs gh CLI logged in)
python tools/verify_ticket.py BE-31

# frontend (after FE-00)
cd frontend && npm run gen:api && npm run typecheck && npm run build
```
