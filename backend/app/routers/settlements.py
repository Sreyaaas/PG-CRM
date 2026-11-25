"""Exit settlement (BE-50): what happens to the deposit at move-out.

The resident accepted an exact exit deduction on Day 1 (`onboarding_requests.accepted_exit_deduction_paise`), which
settles most arguments. The rules are in the database (`app.exit_settlements_guard`, RLS, the unique stay_id):
the stay must be vacated first (422), one settlement per stay (409), immutable, owner only (403);
`net_refund_paise` is a generated column. A negative net means the resident still owes: shown, not blocked.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException
from psycopg import Cursor
from psycopg.rows import DictRow

from app import whatsapp
from app.deps import Org, require_owner
from app.schemas import SettlementCreate, SettlementCreated, SettlementPreview

router = APIRouter(tags=["settlements"])

_NOT_FOUND = {404: {"description": "Not found"}}

# Pending dues: dues are per resident (BE-30) and payments needn't name an invoice, so this takes the non-void,
# non-deposit invoices of this stay plus the resident's one-off charges (created without a stay), minus the
# resident's non-void payments except those logged against a deposit invoice or another stay's invoice.
_PREVIEW = """
  WITH st AS (SELECT id, resident_id, property_id FROM stays WHERE id = %(stay)s),
  owed AS (
    SELECT i.id, i.amount_paise FROM invoices i JOIN st ON i.resident_id = st.resident_id
     WHERE i.voided_at IS NULL AND i.kind <> 'deposit' AND (i.stay_id = st.id OR i.stay_id IS NULL)
  ),
  paid AS (
    SELECT pm.amount_paise FROM payments pm JOIN st ON pm.resident_id = st.resident_id
     WHERE pm.voided_at IS NULL AND (pm.invoice_id IS NULL OR pm.invoice_id IN (SELECT id FROM owed))
  )
  SELECT st.id AS stay_id, st.resident_id, st.property_id,
         (SELECT coalesce(sum(pm.amount_paise), 0) FROM payments pm JOIN invoices i ON i.id = pm.invoice_id
           WHERE i.stay_id = st.id AND i.kind = 'deposit' AND pm.voided_at IS NULL)::bigint AS deposit_held_paise,
         coalesce(o.accepted_exit_deduction_paise, p.exit_deduction_paise) AS exit_deduction_paise,
         greatest(0, (SELECT coalesce(sum(amount_paise), 0) FROM owed)
                   - (SELECT coalesce(sum(amount_paise), 0) FROM paid))::bigint AS pending_dues_paise
    FROM st
    JOIN residents r ON r.id = st.resident_id
    JOIN properties p ON p.id = st.property_id
    LEFT JOIN onboarding_requests o ON o.id = r.onboarding_request_id
"""


def _preview(cur: Cursor[DictRow], stay_id: UUID) -> dict:
    cur.execute(_PREVIEW, {"stay": stay_id})
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Stay not found")
    return row


@router.get("/stays/{stay_id}/settlement-preview", response_model=SettlementPreview, responses=_NOT_FOUND)
def settlement_preview(stay_id: UUID, ctx: Org) -> SettlementPreview:
    """Owner or a caretaker of the building: the numbers to explain to the resident before settling."""
    with ctx.tx() as cur:
        row = _preview(cur, stay_id)
    return SettlementPreview(
        deposit_held_paise=row["deposit_held_paise"],
        exit_deduction_paise=row["exit_deduction_paise"],
        pending_dues_paise=row["pending_dues_paise"],
        suggested_net_refund_paise=row["deposit_held_paise"] - row["exit_deduction_paise"] - row["pending_dues_paise"],
    )


@router.post(
    "/stays/{stay_id}/settlement",
    response_model=SettlementCreated,
    status_code=201,
    responses={**_NOT_FOUND, 409: {"description": "Already settled"}, 422: {"description": "Not moved out yet"}},
)
def settle(stay_id: UUID, body: SettlementCreate, ctx: Org) -> SettlementCreated:
    """Owner only. Records the settlement with the preview's numbers plus any other deductions, and returns the
    public settlement link and a ready WhatsApp message. Final: it can't be changed afterwards."""
    with ctx.tx() as cur:
        require_owner(cur, "Only the owner can settle a deposit.")
        row = _preview(cur, stay_id)
        cur.execute(
            """INSERT INTO exit_settlements (org_id, property_id, stay_id, resident_id, deposit_paise,
                                             exit_deduction_paise, other_deductions_paise, other_deductions_note,
                                             pending_dues_paise, refund_method, refund_utr)
               VALUES (app.current_org_id(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               RETURNING id, net_refund_paise, public_token""",
            (
                row["property_id"],
                row["stay_id"],
                row["resident_id"],
                row["deposit_held_paise"],
                row["exit_deduction_paise"],
                body.other_deductions_paise,
                body.other_deductions_note if body.other_deductions_paise > 0 else None,
                row["pending_dues_paise"],
                body.refund_method,
                body.refund_utr,
            ),
        )
        settled = cur.fetchone()
        cur.execute(
            """SELECT r.full_name, r.phone, p.name AS property_name
                 FROM residents r JOIN properties p ON p.id = r.property_id WHERE r.id = %s""",
            (row["resident_id"],),
        )
        who = cur.fetchone()
    token = settled["public_token"]
    return SettlementCreated(
        id=settled["id"],
        net_refund_paise=settled["net_refund_paise"],
        public_token=token,
        settlement_url=whatsapp.document_url(token),
        whatsapp_url=whatsapp.settlement_link(
            phone=who["phone"], full_name=who["full_name"], property_name=who["property_name"], token=token
        ),
    )
