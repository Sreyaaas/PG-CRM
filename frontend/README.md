# Frontend (PWA)

Owned by the frontend developer. Not scaffolded yet: that is ticket **FE-00** in
[docs/MVP-TICKETS.md](../docs/MVP-TICKETS.md).

## Agreed stack

| Piece | Choice |
|---|---|
| Build | Vite + React + TypeScript (strict) |
| PWA | `vite-plugin-pwa` (manifest, installable on Android, cached app shell) |
| Routing | React Router |
| Server data | TanStack Query |
| Forms | react-hook-form + zod |
| UI | Tailwind + shadcn/ui |
| API types | `openapi-typescript` + `openapi-fetch`, generated from `../contract/openapi.json` |
| QR | `qrcode` (render dynamic UPI QR), a camera QR scanner for the Soundbox setup |

Suggested scaffold:

```bash
npm create vite@latest frontend -- --template react-ts
npm i react-router-dom @tanstack/react-query openapi-fetch react-hook-form zod qrcode
npm i -D vite-plugin-pwa openapi-typescript tailwindcss @tailwindcss/vite
```

Add a script so types are one command away:

```json
"gen:api": "openapi-typescript ../contract/openapi.json -o src/api/schema.d.ts"
```

## Tests and ticket verification

- Vitest for units, Playwright (`Mobile Chrome` / Pixel 5) for end-to-end against the real API with seed data.
- Tag tests with the ticket's acceptance criterion in the title: `test('[FE-31/AC2] duplicate UTR shows the API message', ...)`.
- JSON reports go to `../.verify/vitest.json` and `../.verify/playwright.json`; `python tools/verify_ticket.py FE-31`
  (repo root) reads them. Exact npm scripts and config: issue FE-00.

## Talking to the API

- Base URL: `http://localhost:8000/api/v1` in dev (`VITE_API_URL`).
- Every signed-in call sends `Authorization: Bearer <token>` and `X-Org-Id: <org id>`. The org id comes from the
  user's `memberships` in `/me` (most owners have one org, so auto-select it).
- Money is **integer paise**. Format with `Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR'})` on
  `paise / 100`. Never do money math with floats.
- Errors: `{"error": {"code", "message"}}`. `message` is safe to show to users.
- The UI may hide buttons by role, but **the database enforces every rule**. Showing a button the user cannot use
  is a UX bug, not a security hole.

## Routes

| Route | Who | Auth |
|---|---|---|
| `/join/:slug` | resident scanning the Reception QR | none |
| `/receipt/:token` | resident opening a wa.me link | none |
| everything else | owner / caretaker | login |

## UI rules

- Caretakers use this standing at a desk on a ~6" Android phone: primary actions (*Approve check-in*,
  *Log payment*, *Log expense*) reachable with one thumb and done in under 30 seconds.
- `tabular-nums` on every ₹ amount, bed count, date and 12-digit UTR.
- Clear status badges: beds (`Vacant`, `Reserved`, `Occupied`, `On notice`), payments (`Cash`, `Provisional`,
  `Verified`, `Flagged`), expenses (`No bill: review`).
- Minimal, Linear/Stripe-like. No decorative gradients.
- No-bill expense photo: `<input type="file" accept="image/*" capture="environment">` plus
  `navigator.geolocation`. The live selfie on `/join` uses `capture="user"`.
