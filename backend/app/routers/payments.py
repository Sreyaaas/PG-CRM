"""Log a payment (BE-31): the core desk action.

Threats #1 (cash pocketing) and #5 (reused / fake UPI screenshots) are handled by the database
(`app.payments_guard`, `idx_payments_utr_unique`): `received_by` is always the caller, so cash is attributed to
whoever logged it; the status is `recorded` (cash) or `provisional` (UPI/bank) and nobody can create a verified
payment; caretakers can't backdate; a UTR can be used once in the whole system.
"""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from psycopg import Cursor, sql
from psycopg.rows import DictRow

from app import whatsapp
from app.deps import Org
from app.schemas import Payment, PaymentCreate, PaymentMethod, PaymentStatus

router = APIRouter(prefix="/payments", tags=["payments"])

_NOT_FOUND = {404: {"description": "Not found"}}
PAYMENT_SELECT = """
  SELECT pm.id, pm.property_id, pm.resident_id, r.full_name AS resident_name, r.phone AS resident_phone,
         pr.name AS property_name, pm.invoice_id, pm.amount_paise, pm.method::text AS method, pm.utr_number,
         pm.status::text AS status, pm.received_by, u.full_name AS received_by_name, pm.received_at, pm.notes,
         pm.verified_at, pm.voided_at, pm.void_reason, pm.public_token
    FROM payments pm
    JOIN residents r ON r.id = pm.resident_id
    JOIN properties pr ON pr.id = pm.property_id
    JOIN users u ON u.id = pm.received_by
"""


def payment_out(row: dict) -> Payment:
    phone, property_name = row.pop("resident_phone"), row.pop("property_name")
    return Payment(
        **row,
        receipt_url=whatsapp.document_url(row["public_token"]),
        whatsapp_url=whatsapp.receipt_link(
            phone=phone,
            full_name=row["resident_name"],
            amount_paise=row["amount_paise"],
            method=row["method"],
            property_name=property_name,
            token=row["public_token"],
        ),
    )


def _one(cur: Cursor[DictRow], payment_id: UUID) -> Payment | None:
    cur.execute(PAYMENT_SELECT + " WHERE pm.id = %s", (payment_id,))
    row = cur.fetchone()
    return payment_out(row) if row else None


@router.post("", response_model=Payment, status_code=201, responses=_NOT_FOUND)
def log_payment(body: PaymentCreate, ctx: Org) -> Payment:
    """Owner or a caretaker of the resident's building. Returns the receipt link and a ready WhatsApp message."""
    with ctx.tx() as cur:
        cur.execute(
            """INSERT INTO payments (org_id, property_id, resident_id, invoice_id, amount_paise, method, utr_number,
                                     notes)
               SELECT org_id, property_id, id, %s, %s, %s, %s, %s FROM residents WHERE id = %s
               RETURNING id""",
            (body.invoice_id, body.amount_paise, body.method, body.utr_number, body.notes, body.resident_id),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "Resident not found")
        return _one(cur, row["id"])


@router.get("", response_model=list[Payment])
def list_payments(
    ctx: Org,
    property_id: UUID | None = None,
    from_: Annotated[date | None, Query(alias="from", description="Received on or after (IST)")] = None,
    to: Annotated[date | None, Query(description="Received on or before (IST)")] = None,
    status: PaymentStatus | None = None,
    method: PaymentMethod | None = None,
) -> list[Payment]:
    """Newest first, in the buildings the caller can access (RLS)."""
    where, params = [], []
    day = "(pm.received_at AT TIME ZONE 'Asia/Kolkata')::date"
    for clause, value in (
        ("pm.property_id = %s", property_id),
        (f"{day} >= %s", from_),
        (f"{day} <= %s", to),
        ("pm.status = %s", status),
        ("pm.method = %s", method),
    ):
        if value is not None:
            where.append(clause)
            params.append(value)
    query = PAYMENT_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY pm.received_at DESC"
    with ctx.tx() as cur:
        cur.execute(sql.SQL(query), params)
        return [payment_out(r) for r in cur.fetchall()]


@router.get("/{payment_id}", response_model=Payment, responses=_NOT_FOUND)
def get_payment(payment_id: UUID, ctx: Org) -> Payment:
    with ctx.tx() as cur:
        payment = _one(cur, payment_id)
    if payment is None:
        raise HTTPException(404, "Payment not found")
    return payment
