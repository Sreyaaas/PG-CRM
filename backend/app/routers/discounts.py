"""Discount requests (threat #3, fake discounts).

A caretaker can't log rent below a bed's floor price on their own: they ask, the owner approves or rejects once,
and the approval is tied to that bed, the resident (if set) and the exact amount. All of it is enforced in the
database (`app.discount_requests_guard`, `app.stays_guard`, `uq_stays_discount_request`); this router only
exposes it.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException
from psycopg import Cursor
from psycopg.rows import DictRow

from app.deps import Org, require_owner
from app.schemas import DiscountDecision, DiscountRequest, DiscountRequestCreate, DiscountStatus

router = APIRouter(prefix="/discount-requests", tags=["discounts"])

_SELECT = """
  SELECT d.id, d.status::text AS status, d.property_id, p.name AS property_name, d.bed_id, b.label AS bed_label,
         d.resident_id, r.full_name AS resident_name, b.base_rent_paise, d.requested_rent_paise,
         b.base_rent_paise - d.requested_rent_paise AS difference_paise, d.reason,
         d.requested_by, u.full_name AS requested_by_name, d.created_at, d.decided_by, d.decided_at, d.decision_note
    FROM discount_requests d
    JOIN properties p ON p.id = d.property_id
    JOIN beds b ON b.id = d.bed_id
    JOIN users u ON u.id = d.requested_by
    LEFT JOIN residents r ON r.id = d.resident_id
"""


def _one(cur: Cursor[DictRow], request_id: UUID) -> DiscountRequest:
    cur.execute(_SELECT + " WHERE d.id = %s", (request_id,))
    return DiscountRequest(**cur.fetchone())


@router.post("", response_model=DiscountRequest, status_code=201, responses={404: {"description": "Not found"}})
def create_discount_request(body: DiscountRequestCreate, ctx: Org) -> DiscountRequest:
    """Caretaker or owner, for a bed they can access. `requested_by` and `status='pending'` are set by the DB."""
    with ctx.tx() as cur:
        cur.execute(
            """INSERT INTO discount_requests (org_id, property_id, bed_id, resident_id, requested_rent_paise, reason)
               SELECT org_id, property_id, id, %s, %s, %s FROM beds WHERE id = %s
               RETURNING id""",
            (body.resident_id, body.requested_rent_paise, body.reason, body.bed_id),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "Bed not found")
        return _one(cur, row["id"])


@router.get("", response_model=list[DiscountRequest])
def list_discount_requests(ctx: Org, status: DiscountStatus | None = None) -> list[DiscountRequest]:
    """Requests in the buildings the caller can access (RLS), newest first. `?status=pending` for the inbox."""
    with ctx.tx() as cur:
        if status is None:
            cur.execute(_SELECT + " ORDER BY d.created_at DESC")
        else:
            cur.execute(_SELECT + " WHERE d.status = %s ORDER BY d.created_at DESC", (status,))
        return [DiscountRequest(**r) for r in cur.fetchall()]


@router.post("/{request_id}/decide", response_model=DiscountRequest, responses={404: {"description": "Not found"}})
def decide_discount_request(request_id: UUID, body: DiscountDecision, ctx: Org) -> DiscountRequest:
    """Owner only, once. Deciding again -> 409 (the DB raises PC001)."""
    with ctx.tx() as cur:
        require_owner(cur, "Only the owner can approve or reject a discount.")
        cur.execute(
            "UPDATE discount_requests SET status = %s, decision_note = %s WHERE id = %s RETURNING id",
            (body.decision, body.note, request_id),
        )
        if cur.fetchone() is None:
            raise HTTPException(404, "Discount request not found")
        return _one(cur, request_id)
