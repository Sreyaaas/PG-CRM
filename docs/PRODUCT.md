# Product context

A multi-tenant operating system for PG (paying guest) owners in Bengaluru.

## Who it is for

- **Buyer:** owners running 2–10 PG buildings (50–500+ beds) in BTM, HSR, Marathahalli, Whitefield, Electronic City,
  Bellandur, Koramangala. Often absentee.
- **Daily user:** live-in caretakers / wardens. Often non-technical, on mid-range Android phones at a reception desk.
- **Resident:** IT professionals, interns and students paying ~₹5,500–₹12,000/month. **Never logs in.**

## Why existing tools lose

1. **Gateway fees:** cheap SaaS that earns ~2.36% on rent through a payment gateway (₹11,800/month on a 50-bed PG).
2. **Tenant apps:** residents will not install an app or keep a password just to pay rent.
3. **No anti-theft design:** they assume caretakers are honest. Owners lose ₹15,000–₹50,000/month per building.

## Our position

- Flat SaaS price (₹499–₹1,999/month), **0% transaction fees**.
- Rent goes **directly to the owner's own UPI Soundbox QR**, verified later by uploading the bank/Paytm CSV.
- **No resident app or login:** one public Reception QR for onboarding + `wa.me` links for receipts and reminders.
- **Caretaker guardrails** built into the database.

## Threats the system must block

| # | Scam | Countermeasure |
|---|---|---|
| 1 | Caretaker pockets cash rent | Every cash payment adds to that caretaker's cash in hand; only the owner can record a handover that reduces it |
| 2 | Walk-in overcharging | Public QR shows official rates + owner UPI; short-term stays default to UPI |
| 3 | Fake discounts | Rent can't go below the bed's floor price without an owner-approved discount request |
| 4 | Backdated move-outs, deleted invoices | Nothing is ever deleted; caretakers can't backdate check-in/move-out; immutable audit log |
| 5 | Reused / fake UPI screenshots | A UTR can be used once (DB unique index); logged as provisional, verified by owner CSV upload |
| 6 | Padded "no-bill" expenses | Live camera photo + GPS + note required; auto-flagged yellow for owner review |

## Bengaluru ground reality

- Rent is **all-inclusive** (electricity, water, Wi-Fi, food). No per-bed electricity splitting in MVP; BESCOM is a
  building-level expense.
- **Water tankers** are a major, often bill-less expense (Whitefield, Bellandur, HSR, E-City): a first-class category.
- **Exit deduction** of ₹1,500–₹3,000 from the deposit is standard; the resident accepts the exact amount on the Day-1
  onboarding form to prevent disputes.

## Billing rules (decided)

| Rule | Decision |
|---|---|
| Rent period | Calendar month (1st to last day) for everyone |
| Due date | By the property's `rent_due_day`, default the **5th**, editable by the owner per property (1–28) |
| Overdue | Any day after the due date. No separate grace period |
| First month | **Pro-rata** for the days stayed (check-in day to month end), due on the check-in date. Check-in on the 1st = full month |
| At joining | **Security deposit** (refundable) + **maintenance charge** (one-time, not refundable), both set by the owner per property. Caretakers can't enter lower amounts |
| Notice period | Notice given on or before the property's **notice deadline day** (default the **5th**, a separate owner setting) → that month is the last: pay it, leave by its last day, nothing billed after. Notice after the deadline → the next month is the last, paid in full. Example: notice 5 Nov → leave by 30 Nov; notice 6 Nov → leave by 31 Dec |
| Notice date | Set by the system: caretakers can't choose or backdate it (that would let a resident skip a month). Owners can override |
| Leaving early / late | Leaving before the last day: no refund for unused days. Still there after it: billing continues and the owner dashboard flags them |
| Exit deduction | Separate painting/maintenance deduction from the deposit at move-out, accepted by the resident on Day 1 |
| Short stays | Daily rate × nights, charged at check-in |

Pro-rata formula: `round_to_rupee(monthly_rent × days_stayed ÷ days_in_month)`, integer math.
Example: ₹10,500, check-in 18 Nov → 13 of 30 days → ₹4,550.

## Other MVP decisions

- Staff log in with **phone + password** (no OTP).
- Statement reconciliation is built against **mock CSV files** for the MVP; check against real exports before launch.
- Receipts are **HTML links only** (no PDF).
- Reception poster is **English only**.
- Hosting is **not decided**; decide before launch (BE-52).

## Compliance to keep in mind (2026)

- GBA trade licence + Karnataka HC safety push: 70 sq ft/resident, CCTV with 90-day retention, 24×7 guard, fire NOC,
  135 L water/person/day, FSSAI if running a mess.
- Police verification: resident register + ID copies. Foreign nationals: passport/visa for Form C within 24 hours.
  The onboarding form captures this so a police export is easy later.

## UPI constraints

- Owner scans their Soundbox QR once; we keep `pa` (VPA), `pn` (name), `mc` (MCC) and **drop `sign=`**, otherwise UPI
  apps reject the per-invoice QR as tampered.
- Scanning a QR from the phone gallery is capped (~₹2,000) and unsigned web deep links get declined for rent-sized
  amounts, so always show (1) a dynamic QR for **live camera** scanning and (2) the fallback UPI ID / bank details
  with copy buttons.
- No public API to check a UTR. Verification is two-stage: desk (Soundbox audio + UTR → `provisional`) then owner
  CSV upload (→ `verified` / `flagged`).
- From Oct 2026, up to 0.4% MDR (capped ₹300) can apply to large P2M payments; still far cheaper than 2.36%.

## Not building in the MVP

- Resident login, app or portal (only `/join/<slug>` and `/receipt/<token>` are public)
- WhatsApp Business API / Twilio / bots (use free `wa.me` links)
- SMS-reading payment gateways or sideloaded APKs
- Per-bed electricity metering
- Hard deletes of any financial or occupancy data
