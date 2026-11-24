# PG-CRM: Multi-Tenant PG Management SaaS (Bangalore Edition)

> A mobile-first, multi-tenant B2B SaaS platform engineered specifically for Indian Paying Guest (PG) owners and multi-building operators (starting with Bengaluru).

---

## 📖 Executive Summary & Core Thesis

Most traditional rental management platforms force tenants to download an app and charge a 2–3% transaction fee on payment gateways. **PG-CRM** fundamentally alters this paradigm around the ground realities of Indian PG operations:

1. **Zero Gateway Fees:** Replaces 2.36% payment gateway cuts by leveraging the owner's existing UPI Soundbox QR, enforced 12-digit UTR duplicate prevention, and 1-click Bank/Paytm Business CSV statement reconciliation.
2. **Zero Tenant App / Portal:** Tenants never create an account or download an app. They complete a quick, friction-free onboarding via a physical Reception QR code on Day 1 (`/join/[qr_slug]`) and receive automated digital invoices, receipts, and payment reminders via direct WhatsApp (`wa.me`) share links.
3. **Caretaker Anti-Theft Controls:** Prevents cash pocketing, illicit cash discounts, ghost tenants, backdated move-outs, and fraudulent expense claims via append-only financial ledgers, real-time cash-in-hand handover tracking, and live-camera-only expense capture.
4. **Bangalore Ground Reality:** Standard PG rent is all-inclusive (no per-bed electricity sub-metering in MVP); building electricity is tracked strictly at the property level as a BESCOM utility expense.

---

## 🛠️ Tech Stack & Architecture

* **Frontend & Framework:** Next.js (App Router), TypeScript, Tailwind CSS, [shadcn/ui](https://ui.shadcn.com/), Lucide Icons.
* **Layout & Experience:** PWA-ready, mobile-first responsive layout (optimized for caretaker mobile usage).
* **Backend & Database:** Supabase (PostgreSQL 15+, Auth, Storage) with strict Row Level Security (RLS) on every table.
* **Storage:** Supabase Storage (private S3-compatible buckets for KYC IDs, selfies, expense bill proofs, and generated PDFs).
* **PDF Engine:** `@react-pdf/renderer` or `pdf-lib` (Server-Side) for tamper-proof rent receipts and exit settlement statements.
* **Data Processing:** `papaparse` for client- & server-side streaming parsing of Bank and Paytm Business CSV statements.
* **Design Philosophy:** Linear/Stripe-inspired, high-craft, minimalist aesthetic. High-contrast tabular numbers (`tabular-nums`) for financial figures, zero decorative AI gradients, zero visual clutter.

---

## 👥 Role-Based Access Control (RBAC)

The application enforces **two authenticated roles** (`owner` and `caretaker`) plus **one unauthenticated public intake route** (`/join/[qr_slug]`).

| Capability / Action | Owner (`role = 'owner'`) | Caretaker (`role = 'caretaker'`) |
| :--- | :---: | :---: |
| **Multi-Property Access** | Full access to all properties in organization | Restricted strictly to `assigned_property_ids` |
| **Financial Visibility (P&L, Total Revenue, Lease Rent)** | Full access | **Blocked** (Enforced at RLS & API level) |
| **Approve Pending Check-Ins & Assign Beds** | Yes | Yes |
| **Book Short-Term Guest at Standard Rate** | Yes | Yes |
| **Approve Discounted Rent (`< base_rent`)** | Yes | **Blocked** (Can only submit a discount request) |
| **Record Cash / UPI Rent Payments** | Yes | Yes |
| **Confirm Caretaker Physical Cash Handover** | Yes | **Blocked** |
| **Upload Bank/Paytm CSV & Auto-Verify UTRs** | Yes | **Blocked** |
| **Delete Invoices / Payments / Tenants** | **Blocked** (Append-only; voided via credit note) | **Blocked** (Append-only) |
| **Edit Historical Move-Out Dates** | Yes (Logged in immutable `audit_logs`) | **Blocked** |
| **Log Building Expenses (`Has Bill` / `No Bill`)** | Yes | Yes (Cannot view owner-only categories like lease rent) |

---

## 🗄️ Database Architecture & Supabase Schema

### Security & Integrity Directives
1. **Row Level Security (RLS):** Enabled on **100%** of public tables inside migrations.
2. **Indexing:** B-tree indexes applied on all `org_id`, `property_id`, and `invoice_id` foreign keys to prevent sequential scans during RLS checks.
3. **Role Verification:** User roles and memberships reside in `organization_members` (never rely on client-supplied JWT `user_metadata` for authorization).

### Entity-Relationship Overview

```text
organizations ──┬── organization_members (Auth & RBAC)
                ├── properties ──┬── rooms ── beds
                │                ├── onboarding_submissions (Public Intake)
                │                ├── tenants ──┬── invoices ── payments
                │                │             └── discount_requests
                │                ├── expenses
                │                └── cash_handovers
                └── audit_logs (Immutable audit trail)
```

### Table Definitions

1. **`organizations`**
   * `id` (uuid, PK)
   * `name` (text)
   * `soundbox_vpa` (text) — Owner's UPI VPA (e.g., `merchant@paytm`)
   * `soundbox_merchant_name` (text) — Merchant display name
   * `soundbox_mc` (text) — Merchant Category Code
   * `fallback_upi_id` (text) — Secondary UPI ID for manual transfer
   * `plan_tier` (text, default `'starter'`)
   * `created_at` (timestamptz)

2. **`organization_members`**
   * `id` (uuid, PK)
   * `org_id` (uuid, FK -> `organizations`)
   * `user_id` (uuid, FK -> `auth.users`)
   * `role` (text: `'owner' | 'caretaker'`)
   * `assigned_property_ids` (uuid[]) — Array of assigned properties for caretakers
   * `full_name` (text)
   * `phone` (text)

3. **`properties`**
   * `id` (uuid, PK)
   * `org_id` (uuid, FK -> `organizations`)
   * `name` (text) — e.g., "Greenfield Luxury PG"
   * `address` (text)
   * `city` (text, default `'Bengaluru'`)
   * `qr_slug` (text, UNIQUE) — Public slug for QR check-in
   * `default_notice_days` (int, default `30`)
   * `default_exit_deduction` (numeric, default `2000`) — Standard maintenance/painting deduction

4. **`rooms`**
   * `id` (uuid, PK)
   * `property_id` (uuid, FK -> `properties`)
   * `org_id` (uuid, FK -> `organizations`)
   * `floor` (text) — e.g., "1st Floor"
   * `room_number` (text) — e.g., "101"
   * `sharing_type` (int) — 1, 2, 3, or 4-sharing

5. **`beds`**
   * `id` (uuid, PK)
   * `room_id` (uuid, FK -> `rooms`)
   * `property_id` (uuid, FK -> `properties`)
   * `org_id` (uuid, FK -> `organizations`)
   * `bed_label` (text) — e.g., "101-A", "101-B"
   * `base_monthly_rent` (numeric)
   * `base_daily_rate` (numeric)
   * `status` (text: `'vacant' | 'occupied' | 'notice' | 'reserved'`)

6. **`onboarding_submissions`** *(Public intake queue)*
   * `id` (uuid, PK)
   * `property_id` (uuid, FK -> `properties`)
   * `org_id` (uuid, FK -> `organizations`)
   * `full_name` (text)
   * `phone` (text)
   * `id_type` (text: `'aadhaar' | 'pan' | 'passport' | 'voter_id'`)
   * `id_number` (text)
   * `kyc_doc_path` (text) — Supabase private storage path
   * `selfie_path` (text) — Live camera selfie photo path
   * `permanent_address` (text)
   * `work_or_college` (text)
   * `emergency_contact_name` (text)
   * `emergency_contact_phone` (text)
   * `is_foreign_national` (boolean, default `false`) — Flags Form C requirement
   * `rules_accepted_at` (timestamptz)
   * `status` (text: `'pending' | 'approved' | 'rejected'`)
   * `created_at` (timestamptz)

7. **`tenants`**
   * `id` (uuid, PK)
   * `org_id` (uuid, FK -> `organizations`)
   * `property_id` (uuid, FK -> `properties`)
   * `bed_id` (uuid, FK -> `beds`, nullable on vacate)
   * `submission_id` (uuid, FK -> `onboarding_submissions`)
   * `full_name` (text)
   * `phone` (text)
   * `stay_type` (text: `'monthly' | 'short_term'`)
   * `agreed_rent` (numeric)
   * `security_deposit` (numeric)
   * `billing_cycle` (text: `'first_of_month' | 'join_date'`)
   * `join_date` (date)
   * `notice_date` (date, nullable)
   * `expected_vacate_date` (date, nullable)
   * `actual_vacate_date` (date, nullable)
   * `status` (text: `'active' | 'notice' | 'vacated'`)

8. **`invoices`**
   * `id` (uuid, PK)
   * `org_id` (uuid, FK -> `organizations`)
   * `property_id` (uuid, FK -> `properties`)
   * `tenant_id` (uuid, FK -> `tenants`)
   * `invoice_number` (text, UNIQUE) — e.g., `INV-2026-0001`
   * `billing_period_start` (date)
   * `billing_period_end` (date)
   * `rent_amount` (numeric)
   * `extra_charges` (numeric, default `0`)
   * `discount_amount` (numeric, default `0`)
   * `discount_approved_by` (uuid, nullable)
   * `total_amount` (numeric)
   * `paid_amount` (numeric, default `0`)
   * `status` (text: `'unpaid' | 'partial' | 'paid' | 'void'`)
   * `due_date` (date)
   * `created_at` (timestamptz)

9. **`payments`**
   * `id` (uuid, PK)
   * `org_id` (uuid, FK -> `organizations`)
   * `property_id` (uuid, FK -> `properties`)
   * `invoice_id` (uuid, FK -> `invoices`)
   * `tenant_id` (uuid, FK -> `tenants`)
   * `amount` (numeric)
   * `payment_mode` (text: `'upi_soundbox' | 'cash' | 'bank_transfer'`)
   * `utr_number` (text, nullable) — Partial unique index enforced: `WHERE utr_number IS NOT NULL`
   * `proof_path` (text, nullable)
   * `collected_by` (uuid, FK -> `auth.users`)
   * `verification_status` (text: `'provisional' | 'verified' | 'flagged'`)
   * `verified_at` (timestamptz, nullable)
   * `created_at` (timestamptz)

10. **`cash_handovers`**
    * `id` (uuid, PK)
    * `org_id` (uuid, FK -> `organizations`)
    * `property_id` (uuid, FK -> `properties`)
    * `caretaker_id` (uuid, FK -> `auth.users`)
    * `amount` (numeric)
    * `notes` (text)
    * `confirmed_by_owner_id` (uuid, FK -> `auth.users`)
    * `confirmed_at` (timestamptz)

11. **`expenses`**
    * `id` (uuid, PK)
    * `org_id` (uuid, FK -> `organizations`)
    * `property_id` (uuid, FK -> `properties`)
    * `category` (text: `'water_tanker' | 'bescom' | 'groceries' | 'staff_salary' | 'lease_rent' | 'maintenance' | 'other'`)
    * `amount` (numeric)
    * `has_bill` (boolean)
    * `proof_photo_path` (text)
    * `capture_metadata` (jsonb) — UTC timestamp, browser GPS coords (if permission granted), device userAgent
    * `notes` (text)
    * `owner_only` (boolean, default `false`)
    * `flagged_for_review` (boolean)
    * `logged_by` (uuid, FK -> `auth.users`)
    * `expense_date` (date)
    * `created_at` (timestamptz)

12. **`discount_requests`**
    * `id` (uuid, PK)
    * `org_id` (uuid, FK -> `organizations`)
    * `property_id` (uuid, FK -> `properties`)
    * `bed_id` (uuid, FK -> `beds`)
    * `tenant_name` (text)
    * `standard_rate` (numeric)
    * `requested_rate` (numeric)
    * `reason` (text)
    * `requested_by` (uuid, FK -> `auth.users`)
    * `status` (text: `'pending' | 'approved' | 'rejected'`)
    * `reviewed_by` (uuid, nullable)
    * `created_at` (timestamptz)

13. **`audit_logs`** *(Immutable — INSERT-only, no UPDATE or DELETE policies)*
    * `id` (uuid, PK)
    * `org_id` (uuid, FK -> `organizations`)
    * `actor_id` (uuid)
    * `entity_type` (text: `'invoices' | 'payments' | 'tenants' | 'beds'`)
    * `entity_id` (uuid)
    * `action` (text: `'INSERT' | 'UPDATE' | 'VOID'`)
    * `old_value` (jsonb)
    * `new_value` (jsonb)
    * `created_at` (timestamptz)

---

## 🚀 Functional Modules (MVP)

### Module A: Onboarding & Bed Inventory
* **Property & Soundbox Configuration:** Owner sets up buildings, floors, rooms, and beds with base rates. Uploads Soundbox QR once; system parses and stores VPA (`pa`), Merchant Name (`pn`), and MCC (`mc`).
* **Live Interactive Bed Map:** Matrix grouped by Floor → Room → Bed with quick-filter chips (`All`, `Vacant`, `Occupied`, `On Notice`).
* **Frictionless Reception QR Form (`/join/[qr_slug]`):** Public, mobile-optimized page requiring zero login. Collects KYC documents, forces a live front-camera selfie (`capture="user"`), checks Form C compliance for foreign nationals, and records mandatory acceptance of PG house rules.
* **Caretaker Check-In Approval & Discount Guardrail:** Caretaker reviews submissions, assigns a vacant bed, and confirms rent/deposit. If `agreed_rent < bed.base_monthly_rent`, the activation is locked until an owner approves the auto-generated `discount_request`.

### Module B: All-Inclusive Billing & Zero-Fee UPI Engine
* **Automated Cycle & Pro-Rata Invoicing:** Supports `first_of_month` and `join_date` billing cycles. Automatic pro-rata calculation for mid-month check-ins:
  $$\text{Pro-Rata Rent} = \left(\frac{\text{Monthly Base Rent}}{\text{Days in Month}}\right) \times \text{Remaining Days}$$
* **Dynamic Soundbox QR Code:** Renders dynamic UPI intent URI:
  ```text
  upi://pay?pa=<soundbox_vpa>&pn=<merchant_name>&mc=<mc>&am=<amount_due>&tn=<invoice_number>
  ```
* **Strict 12-Digit UTR Duplicate Prevention:** When recording UPI payments, caretakers enter the 12-digit UTR (`/^\d{12}$/`). The database rejects duplicate UTRs across the organization via a unique partial index, eliminating fake payment screenshots.
* **1-Click Bank & Paytm CSV Reconciliation:** Owners upload monthly bank or Paytm merchant statements. The system parses all 12-digit UTR credits, automatically matches them against `provisional` payments, flips matched records to `verified`, and flags mismatches or orphan transactions.
* **1-Click WhatsApp Sharing:** Generates direct, pre-formatted WhatsApp share links:
  ```text
  https://wa.me/91<phone>?text=<encoded_invoice_summary_and_receipt_link>
  ```

### Module C: Move-Out & Deposit Settlement
* **Notice Period Tracking:** Records notice date and expected vacate date.
* **Exit Settlement Calculator:**
  $$\text{Refundable Amount} = \text{Deposit} - \text{Unpaid Invoices} - \text{Exit Maintenance Deduction} - \text{Damage Costs}$$
* **Settlement Documentation:** Generates a server-rendered settlement PDF breakdown, releases the bed back to `'vacant'`, and transitions the tenant record to `'vacated'`.

### Module D: Caretaker Anti-Theft & Building Expenses
* **Real-Time Cash-in-Hand Balance:**
  $$\text{Caretaker Cash Balance} = \sum \text{Cash Collected} - \sum \text{Confirmed Handovers}$$
  Owner verifies physical cash and logs a handover to deduct from the caretaker's liability balance.
* **Expense Logger (`Has Bill` vs. `No Bill`):**
  * `Has Bill = true`: Upload receipt/invoice image.
  * `Has Bill = false`: Forces live environment camera capture (`capture="environment"`), stamps UTC timestamp and geolocation metadata, requires a justification note, and flags the expense in yellow for owner review.
* **Immutable Audit Trail:** Automated trigger logs every modification to invoices, payments, tenant terms, and bed allocations into `audit_logs`.

---

## 📁 App Router Directory Structure

```text
src/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx                   # Role-aware login for Owners & Caretakers
│   ├── join/
│   │   └── [qr_slug]/page.tsx               # Public zero-login tenant onboarding intake
│   ├── receipt/
│   │   └── [invoice_id]/page.tsx             # Public read-only tokenized invoice/receipt view
│   ├── (dashboard)/
│   │   ├── layout.tsx                       # Role-aware navigation shell + Property switcher
│   │   ├── page.tsx                         # Owner P&L & KPIs / Caretaker daily operations
│   │   ├── beds/page.tsx                    # Live Bed Map & Room/Bed inventory manager
│   │   ├── onboarding/page.tsx              # Pending QR check-ins & walk-in entry
│   │   ├── tenants/page.tsx                 # Active, Notice & Vacated directory + Exit calculator
│   │   ├── billing/page.tsx                 # Invoices, UTR entry & CSV statement auto-reconciliation
│   │   ├── handovers/page.tsx               # Caretaker Cash-in-Hand & Handover ledger
│   │   ├── expenses/page.tsx                # Building expenses (Has Bill / No Bill)
│   │   ├── approvals/page.tsx               # Pending discount approvals & flagged expenses
│   │   ├── audit/page.tsx                   # Owner-only immutable audit trail
│   │   └── settings/page.tsx                # Properties, Soundbox QR parser & Staff management
├── lib/
│   ├── supabase/                            # Server, Client, and Middleware Supabase helpers
│   ├── upi/                                 # Soundbox QR decoder & dynamic UPI URI builder
│   ├── csv/                                 # Bank/Paytm CSV statement UTR matcher
│   └── pdf/                                 # Server-side Rent Receipt & Exit Settlement PDF renderer
└── supabase/
    └── migrations/                          # SQL schema, RLS policies, B-tree indexes & triggers
```

---

## 🗺️ Roadmap & Milestones

- [x] Product Requirements Document & Architecture Specification
- [ ] Supabase schema migrations, foreign keys, B-tree indexes & RLS policies
- [ ] Core authentication & Organization/Property switcher layout
- [ ] Public `/join/[qr_slug]` mobile onboarding flow with live camera capture
- [ ] Live Bed Map & Caretaker check-in workflow with discount request guardrails
- [ ] Invoicing engine, Dynamic Soundbox UPI QR & UTR duplicate detection
- [ ] 1-Click Bank/Paytm CSV reconciliation parser
- [ ] Move-out settlement calculator & automated receipt PDF generation
- [ ] Caretaker Cash Handover ledger & anti-theft expense tracker

---

## 📄 License
Private & Proprietary — All Rights Reserved.
