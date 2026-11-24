# MVP tickets

**Each ticket is a GitHub issue with the full spec** (click the ID). This page is the overview and
the order of work. Read [AGENTS.md](../AGENTS.md) before picking one up.

Two tracks that run in parallel:

- **BE** (backend + API): Python / FastAPI / Postgres
- **FE** (frontend PWA): React + TypeScript + Vite

## How the two tracks stay in sync

1. **Contract first.** For each feature, BE adds the request/response models and the route first (it can return
   `501` until the logic is done), runs `uv run python scripts/export_openapi.py`, and commits
   `contract/openapi.json`.
2. FE regenerates types from that file (`npm run gen:api`) and builds against it. If BE renames a field, FE's
   type-check fails and points straight at it.
3. Money is **integer paise** everywhere in the API (`amount_paise: 1050000` = ₹10,500). FE formats it for
   display.
4. Errors always look like `{"error": {"code": "...", "message": "..."}}`. FE can show `message` directly:
   it is written for humans (e.g. "This UTR has already been used for another payment.").
5. Every authenticated call sends `Authorization: Bearer <token>` and `X-Org-Id: <org uuid>`.

**Done** means: the code is merged, BE has tests (pytest) and FE has been checked on a real ~6-inch Android phone
in Chrome.

---

## M0: Foundation

| ID | Track | Ticket | Status |
|---|---|---|---|
| BE-00 | BE | Postgres schema, RLS on every table, anti-theft triggers, audit log, test suite | ✅ done |
| BE-01 | BE | API skeleton: signup, login, `/me`, `/properties`, `/public/join/{slug}`, error format, OpenAPI export | ✅ done |
| [BE-02](https://github.com/Sreyaaas/PG-CRM/issues/1) | BE | CI (GitHub Actions): Postgres service → migrate → pytest + ruff; fail if `contract/openapi.json` is stale | todo |
| [FE-00](https://github.com/Sreyaaas/PG-CRM/issues/2) | FE | Scaffold `frontend/` (see [frontend/README.md](../frontend/README.md)): Vite + React + TS, vite-plugin-pwa, React Router, TanStack Query, Tailwind + shadcn/ui, `openapi-typescript` + `openapi-fetch` client | todo |
| [FE-01](https://github.com/Sreyaaas/PG-CRM/issues/3) | FE | Design base: `tabular-nums` money/UTR/date components, `₹` formatter from paise, status badges (bed / payment / expense), caretaker bottom-nav shell, owner shell | todo |
| [FE-02](https://github.com/Sreyaaas/PG-CRM/issues/4) | FE | Login screen, token storage, org picker (from `/me` memberships), global 401 → login, error toast from `error.message` | todo |

## M1: Owner sets up buildings

| ID | Track | Ticket | Depends on |
|---|---|---|---|
| [BE-10](https://github.com/Sreyaaas/PG-CRM/issues/5) | BE | Properties create / update (rates, exit deduction, house rules, fallback UPI, bank details). Owner only. | BE-01 |
| [BE-11](https://github.com/Sreyaaas/PG-CRM/issues/6) | BE | `POST /properties/{id}/upi-from-qr`: parse a scanned Soundbox QR string, store `pa`, `pn`, `mc`, **drop `sign=`** and any other params | BE-10 |
| [BE-12](https://github.com/Sreyaaas/PG-CRM/issues/7) | BE | Rooms + beds: create a room with N beds in one call, edit base rent, deactivate. Bed board endpoint (beds + status + current resident + rent) | BE-10 |
| [BE-13](https://github.com/Sreyaaas/PG-CRM/issues/8) | BE | Staff: list members, add caretaker (wraps `api.add_staff_member`), change assigned properties, deactivate | BE-10 |
| [FE-10](https://github.com/Sreyaaas/PG-CRM/issues/9) | FE | Property setup form + Soundbox QR scan with the camera → shows parsed payee name/VPA to confirm | FE-02, BE-10, BE-11 |
| [FE-11](https://github.com/Sreyaaas/PG-CRM/issues/10) | FE | Rooms & beds editor (add room "204, 3-sharing, AC, ₹6,000" → creates beds) | BE-12 |
| [FE-12](https://github.com/Sreyaaas/PG-CRM/issues/11) | FE | Staff screen: add caretaker, tick properties | BE-13 |
| [FE-13](https://github.com/Sreyaaas/PG-CRM/issues/12) | FE | Printable Reception QR poster: QR → `/join/<qr_slug>`, property name, house rules, UPI ID | BE-10 |

## M2: Onboarding and check-in

| ID | Track | Ticket | Depends on |
|---|---|---|---|
| [BE-20](https://github.com/Sreyaaas/PG-CRM/issues/13) | BE | File uploads: presigned PUT/GET URLs for a **private** bucket (MinIO locally). Kinds: `kyc_id`, `selfie`, `expense_proof`. Size/type limits, short TTLs. Public onboarding uploads scoped to a QR slug | BE-01 |
| [BE-21](https://github.com/Sreyaaas/PG-CRM/issues/14) | BE | `POST /public/join/{slug}`: submit onboarding (wraps `api.public_submit_onboarding`), rate limit per IP + phone | BE-20 |
| [BE-22](https://github.com/Sreyaaas/PG-CRM/issues/15) | BE | Onboarding queue: list pending; **approve** creates resident + stay (+ deposit invoice) in one transaction; reject with note | BE-21 |
| [BE-23](https://github.com/Sreyaaas/PG-CRM/issues/16) | BE | Discount requests: caretaker creates, owner lists pending and approves/rejects (1 tap) | BE-12 |
| [BE-24](https://github.com/Sreyaaas/PG-CRM/issues/17) | BE | Stays: give notice, move out (today only for caretakers; the DB enforces this), owner date corrections, short-term booking at the daily rate | BE-22 |
| [FE-20](https://github.com/Sreyaaas/PG-CRM/issues/18) | FE | Public `/join/:slug` form: personal details, ID photo, **live selfie** (`capture="user"`), foreign-national section (passport/visa), house rules + exit deduction checkbox, success screen | BE-20, BE-21 |
| [FE-21](https://github.com/Sreyaaas/PG-CRM/issues/19) | FE | Caretaker: pending check-ins → approve (pick vacant bed, rent pre-filled at floor price, deposit) in under 30 seconds. Rent below the floor price → "Request discount" | BE-12, BE-22, BE-23 |
| [FE-22](https://github.com/Sreyaaas/PG-CRM/issues/20) | FE | Owner approvals inbox: discount requests with Approve / Reject | BE-23 |
| [FE-23](https://github.com/Sreyaaas/PG-CRM/issues/21) | FE | Bed board grid by room with status badges; resident detail; give notice / move out | BE-12, BE-24 |

## M3: Billing and payments

| ID | Track | Ticket | Depends on |
|---|---|---|---|
| [BE-30](https://github.com/Sreyaaas/PG-CRM/issues/22) | BE | Invoices: monthly rent by `billing_day` ("generate due invoices", safe to re-run, unique per period), short-term, deposit. Dues per resident = invoices − payments | BE-24 |
| [BE-31](https://github.com/Sreyaaas/PG-CRM/issues/23) | BE | Log payment: cash or UPI/bank + 12-digit UTR. Status is set by the DB (`recorded` / `provisional`). Returns the receipt token | BE-30 |
| [BE-32](https://github.com/Sreyaaas/PG-CRM/issues/24) | BE | `Idempotency-Key` support on POST payments / expenses so a retry on bad Wi-Fi never double-records cash | BE-31 |
| [BE-33](https://github.com/Sreyaaas/PG-CRM/issues/25) | BE | Dynamic UPI payload for an invoice: `upi://pay?pa=&pn=&mc=&am=&tn=<invoice_no>&cu=INR`, never `sign=` | BE-30 |
| [BE-34](https://github.com/Sreyaaas/PG-CRM/issues/26) | BE | `GET /public/documents/{token}`: receipt / invoice / settlement (wraps `api.public_get_document`) | BE-31 |
| [BE-35](https://github.com/Sreyaaas/PG-CRM/issues/27) | BE | wa.me message templates (receipt, rent reminder) returned with the link, so the wording is the same everywhere | BE-31 |
| [FE-30](https://github.com/Sreyaaas/PG-CRM/issues/28) | FE | Dues list (overdue first) and resident ledger | BE-30 |
| [FE-31](https://github.com/Sreyaaas/PG-CRM/issues/29) | FE | Log payment sheet: amount pre-filled, Cash / UPI toggle, numeric 12-digit UTR field, "Share receipt on WhatsApp" | BE-31, BE-32, BE-35 |
| [FE-32](https://github.com/Sreyaaas/PG-CRM/issues/30) | FE | Public `/receipt/:token` page: receipt, or invoice with a **live-scan** dynamic QR + copy buttons for fallback UPI ID / bank details | BE-33, BE-34 |
| [FE-33](https://github.com/Sreyaaas/PG-CRM/issues/31) | FE | Send reminder via wa.me from the dues list | BE-35 |

## M4: Owner money control

| ID | Track | Ticket | Depends on |
|---|---|---|---|
| [BE-40](https://github.com/Sreyaaas/PG-CRM/issues/32) | BE | CSV reconciliation: upload Paytm Business / PhonePe Business / bank statement → match on UTR + amount → `verified`, or `flagged` on mismatch; per-row report. Owner only. **Needs real sample CSVs** | BE-31 |
| [BE-41](https://github.com/Sreyaaas/PG-CRM/issues/33) | BE | Cash: balances (`api.cash_balances`), owner records handover | BE-31 |
| [BE-42](https://github.com/Sreyaaas/PG-CRM/issues/34) | BE | Expenses: create (has bill / no bill with photo + GPS + note), list, owner review / void. Lease rent is hidden from caretakers (the DB enforces this) | BE-20 |
| [BE-43](https://github.com/Sreyaaas/PG-CRM/issues/35) | BE | Owner dashboard: P&L per property (`api.owner_pnl`), occupancy, counts of flagged payments / expenses / pending approvals | BE-40, BE-42 |
| [BE-44](https://github.com/Sreyaaas/PG-CRM/issues/36) | BE | Void invoice / payment / expense with reason (owner) + audit log viewer endpoint | BE-31 |
| [FE-40](https://github.com/Sreyaaas/PG-CRM/issues/37) | FE | CSV upload + results table (green verified / red mismatch / grey unmatched) | BE-40, BE-44 |
| [FE-41](https://github.com/Sreyaaas/PG-CRM/issues/38) | FE | Cash in hand: caretaker sees own balance; owner sees all and records handover | BE-41, BE-32 |
| [FE-42](https://github.com/Sreyaaas/PG-CRM/issues/39) | FE | Log expense: "Has bill" (gallery allowed) vs "No bill" (camera only `capture="environment"`, GPS, note). Owner review list with yellow flags | BE-20, BE-42, BE-44 |
| [FE-43](https://github.com/Sreyaaas/PG-CRM/issues/40) | FE | Owner dashboard | BE-43 |

## M5: Move-out, hardening, launch

| ID | Track | Ticket | Depends on |
|---|---|---|---|
| [BE-50](https://github.com/Sreyaaas/PG-CRM/issues/41) | BE | Exit settlement: deposit − agreed exit deduction − other deductions − pending dues; public link | BE-24, BE-30 |
| [BE-51](https://github.com/Sreyaaas/PG-CRM/issues/42) | BE | Security: rate-limit login + public routes, refresh tokens / logout, password change, structured logs, Sentry | BE-01 |
| [BE-52](https://github.com/Sreyaaas/PG-CRM/issues/43) | BE | Deploy: API Dockerfile, production DB login role (non-superuser, member of `pgcrm_app`), backups, hosting choice | all |
| [FE-50](https://github.com/Sreyaaas/PG-CRM/issues/44) | FE | Move-out + settlement screen + share link | BE-50 |
| [FE-51](https://github.com/Sreyaaas/PG-CRM/issues/45) | FE | PWA polish: install prompt, offline app shell, retry queue for failed POSTs (uses `Idempotency-Key`) | BE-32 |

## After MVP (not now)

Police verification export / Form C, PDF receipts, per-bed electricity, reminders on a schedule, Rust rewrite of
the API (same DB + same `contract/openapi.json`).

## Open decisions

Tracked in [issue #46](https://github.com/Sreyaaas/PG-CRM/issues/46). Don't guess these; answer them there.

| Question | Options | Needed by |
|---|---|---|
| Staff login | phone + password (built) / phone + OTP (costs per SMS) | M0 |
| Rent cycle | check-in anniversary (`billing_day`, built) / everyone on the 1st | BE-30 |
| CSV formats | need 2–3 real exported statements from owners (Paytm, PhonePe, a bank) | BE-40 |
| Hosting | managed Postgres + API in Mumbai / a VPS | BE-52 |
| PDF receipts in MVP? | HTML receipt link only (planned) / also PDF | BE-34 |
