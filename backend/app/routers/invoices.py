"""Invoices, dues and the resident ledger (BE-30).

Billing rules are decided (docs/PRODUCT.md, "Billing rules"): calendar months, due on the property's
rent_due_day, overdue the day after; the first month is pro-rata (created at check-in by BE-22). Invoices are
immutable (void-only), and invoice_no / created_by are set by the database. Dues are per resident:
non-void invoices minus non-void payments.
"""

import calendar
from uuid import UUID

from fastapi import APIRouter, HTTPException
from psycopg import Cursor
from psycopg.rows import DictRow

from app import billing, whatsapp
from app.deps import Org, require_owner
from app.schemas import (
    DueRow,
    GenerateDueRequest,
    GenerateDueResult,
    Invoice,
    LedgerEntry,
    OneOffInvoiceCreate,
    ResidentLedger,
)

router = APIRouter(tags=["invoices"])

_NOT_FOUND = {404: {"description": "Not found"}}
INVOICE_SELECT = """
  SELECT i.id, i.invoice_no, i.kind::text AS kind, i.property_id, i.resident_id, i.stay_id, i.period_start,
         i.period_end, i.amount_paise, i.due_date, i.notes, i.created_by, i.created_at, i.voided_at, i.void_reason,
         i.public_token, r.full_name AS resident_name, r.phone AS resident_phone
    FROM invoices i
    JOIN residents r ON r.id = i.resident_id
"""


def invoice_out(row: dict) -> Invoice:
    """The invoice plus its public page and a ready wa.me message (BE-35 `invoice` template)."""
    phone, name, token = row.pop("resident_phone"), row.pop("resident_name"), row.pop("public_token")
    return Invoice(
        **row,
        invoice_url=whatsapp.document_url(token),
        whatsapp_url=whatsapp.invoice_link(
            phone=phone,
            full_name=name,
            invoice_no=row["invoice_no"],
            amount_paise=row["amount_paise"],
            due_date=row["due_date"],
            token=token,
        ),
    )


# Monthly rent for one calendar month. Eligible: monthly stays that are active or on notice, that checked in
# before the month (the check-in month is the pro-rata invoice from BE-22), and either
#   * the month starts on or before the last day (expected_vacate_date), or there is none, or
#   * the month has already started and the stay is still open: an overstay is billed as normal.
# So a December invoice generated in advance skips someone leaving on 30 Nov, but on 1 Dec, if they haven't been
# moved out, December is billed. The unique index uq_invoices_rent_period makes re-running a no-op.
_GENERATE = """
  INSERT INTO invoices (org_id, property_id, resident_id, stay_id, kind, period_start, period_end, amount_paise,
                        due_date)
  SELECT s.org_id, s.property_id, s.resident_id, s.id, 'rent', %(start)s, %(end)s, s.rent_paise,
         make_date(%(year)s, %(month)s, p.rent_due_day::int)
    FROM stays s
    JOIN properties p ON p.id = s.property_id
   WHERE s.stay_type = 'monthly'
     AND s.status IN ('active', 'on_notice')
     AND s.check_in_date < %(start)s
     AND (s.expected_vacate_date IS NULL OR %(start)s <= s.expected_vacate_date OR %(start)s <= app.today_ist())
     AND (%(property_id)s::uuid IS NULL OR s.property_id = %(property_id)s::uuid)
  ON CONFLICT (stay_id, period_start) WHERE kind = 'rent' AND voided_at IS NULL DO NOTHING
  RETURNING id
"""


@router.post("/invoices/generate-due", response_model=GenerateDueResult)
def generate_due(body: GenerateDueRequest, ctx: Org) -> GenerateDueResult:
    """Create this month's (or `month`'s) rent invoices for every open monthly stay in the buildings the caller can
    access. Safe to run any number of times: a month already invoiced creates 0."""
    with ctx.tx() as cur:
        if body.month is None:
            cur.execute("SELECT app.today_ist() AS today")
            start = billing.month_start(cur.fetchone()["today"])
        else:
            start = billing.parse_month(body.month)
        cur.execute(
            _GENERATE,
            {
                "start": start,
                "end": billing.month_end(start),
                "year": start.year,
                "month": start.month,
                "property_id": body.property_id,
            },
        )
        created = len(cur.fetchall())
    return GenerateDueResult(month=f"{start:%Y-%m}", created=created)


@router.post("/invoices", response_model=Invoice, status_code=201, responses=_NOT_FOUND)
def create_one_off(body: OneOffInvoiceCreate, ctx: Org) -> Invoice:
    """Owner only (the database also refuses caretakers' `other` invoices)."""
    with ctx.tx() as cur:
        require_owner(cur, "Only the owner can add a one-off charge.")
        cur.execute(
            """INSERT INTO invoices (org_id, property_id, resident_id, kind, amount_paise, due_date, notes)
               SELECT org_id, property_id, id, 'other', %s, %s, %s FROM residents WHERE id = %s
               RETURNING id""",
            (body.amount_paise, body.due_date, body.notes, body.resident_id),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "Resident not found")
        cur.execute(INVOICE_SELECT + " WHERE i.id = %s", (row["id"],))
        return invoice_out(cur.fetchone())


_DUES = """
  WITH billed AS (
    SELECT resident_id, amount_paise, due_date, created_at, id, public_token,
           sum(amount_paise) OVER (PARTITION BY resident_id ORDER BY due_date, created_at, id) AS running
      FROM invoices WHERE voided_at IS NULL
  ),
  invoiced AS (SELECT resident_id, sum(amount_paise) AS total FROM billed GROUP BY resident_id),
  paid AS (SELECT resident_id, sum(amount_paise) AS total FROM payments WHERE voided_at IS NULL GROUP BY resident_id),
  owing AS (
    SELECT i.resident_id, i.total - coalesce(p.total, 0) AS outstanding, oldest.due_date AS oldest_due_date,
           oldest.public_token AS oldest_token
      FROM invoiced i
      LEFT JOIN paid p ON p.resident_id = i.resident_id
      -- payments cover the oldest invoices first: the oldest one not fully covered
      LEFT JOIN LATERAL (SELECT b.due_date, b.public_token FROM billed b
                          WHERE b.resident_id = i.resident_id AND b.running > coalesce(p.total, 0)
                          ORDER BY b.due_date, b.created_at, b.id LIMIT 1) oldest ON true
  )
  SELECT r.id AS resident_id, r.full_name, r.phone, b.label AS bed_label, o.outstanding AS outstanding_paise,
         o.oldest_due_date, greatest(0, app.today_ist() - o.oldest_due_date) AS days_overdue,
         pr.name AS property_name, o.oldest_token
    FROM owing o
    JOIN residents r ON r.id = o.resident_id
    JOIN properties pr ON pr.id = r.property_id
    LEFT JOIN stays s ON s.resident_id = r.id AND s.status <> 'vacated'
    LEFT JOIN beds b ON b.id = s.bed_id
   WHERE o.outstanding > 0
     AND (%(property_id)s::uuid IS NULL OR r.property_id = %(property_id)s::uuid)
     AND (%(resident_id)s::uuid IS NULL OR r.id = %(resident_id)s::uuid)
   ORDER BY days_overdue DESC, o.outstanding DESC, r.full_name
"""


def _reminder_link(row: dict) -> str:
    """BE-35 `reminder`: what they owe in total, the oldest unpaid due date, and that invoice's page."""
    return whatsapp.reminder_link(
        phone=row["phone"],
        full_name=row["full_name"],
        outstanding_paise=row["outstanding_paise"],
        property_name=row["property_name"],
        due_date=row["oldest_due_date"],
        token=row["oldest_token"],
    )


def _due_row(row: dict) -> DueRow:
    return DueRow(**row, whatsapp_url=_reminder_link(row))


@router.get("/dues", response_model=list[DueRow])
def dues(ctx: Org, property_id: UUID | None = None) -> list[DueRow]:
    """Residents who owe money, most overdue first (RLS: caretakers see their buildings only)."""
    with ctx.tx() as cur:
        cur.execute(_DUES, {"property_id": property_id, "resident_id": None})
        return [_due_row(r) for r in cur.fetchall()]


_LEDGER = """
  SELECT due_date AS date, 0 AS ord, created_at, id, invoice_no AS reference, kind::text AS what,
         period_start, period_end, notes, amount_paise AS amount, voided_at IS NOT NULL AS voided
    FROM invoices WHERE resident_id = %(r)s
  UNION ALL
  SELECT (received_at AT TIME ZONE 'Asia/Kolkata')::date, 1, created_at, id,
         method::text || coalesce(' ' || utr_number, ''), method::text, NULL, NULL, notes, -amount_paise,
         voided_at IS NOT NULL
    FROM payments WHERE resident_id = %(r)s
  ORDER BY date, ord, created_at, id
"""
_METHOD = {"cash": "Cash", "upi": "UPI", "bank_transfer": "Bank transfer"}


def _describe(row: dict) -> str:
    if row["ord"] == 1:
        return f"Payment ({_METHOD.get(row['what'], row['what'])})"
    if row["what"] == "rent" and row["period_start"]:
        start, end = row["period_start"], row["period_end"]
        whole = start.day == 1 and end and end.day == calendar.monthrange(end.year, end.month)[1]
        return f"Rent, {start:%B %Y}" if whole else f"Rent, {start:%d %b} to {end:%d %b %Y}"
    label = {
        "short_term": "Short stay",
        "deposit": "Security deposit",
        "maintenance_charge": "Maintenance charge",
        "exit_deduction": "Exit deduction",
        "other": row["notes"] or "Other charge",
    }.get(row["what"], row["what"])
    return label


def _ledger(cur: Cursor[DictRow], resident_id: UUID) -> ResidentLedger | None:
    cur.execute("SELECT id, full_name FROM residents WHERE id = %s", (resident_id,))
    resident = cur.fetchone()
    if resident is None:
        return None
    cur.execute(_LEDGER, {"r": resident_id})
    balance, entries = 0, []
    for row in cur.fetchall():
        if not row["voided"]:
            balance += row["amount"]
        entries.append(
            LedgerEntry(
                entry_date=row["date"],
                type="invoice" if row["ord"] == 0 else "payment",
                id=row["id"],
                reference=row["reference"],
                description=_describe(row),
                amount_paise=row["amount"],
                voided=row["voided"],
                balance_paise=balance,
            )
        )
    cur.execute(_DUES, {"property_id": None, "resident_id": resident_id})
    due = cur.fetchone()
    return ResidentLedger(
        resident_id=resident["id"],
        full_name=resident["full_name"],
        outstanding_paise=balance,
        entries=entries,
        whatsapp_url=_reminder_link(due) if due else None,
    )


@router.get("/residents/{resident_id}/ledger", response_model=ResidentLedger, responses=_NOT_FOUND)
def resident_ledger(resident_id: UUID, ctx: Org) -> ResidentLedger:
    """Invoices and payments, oldest first, with the running balance (void entries listed but not counted)."""
    with ctx.tx() as cur:
        ledger = _ledger(cur, resident_id)
    if ledger is None:
        raise HTTPException(404, "Resident not found")
    return ledger
