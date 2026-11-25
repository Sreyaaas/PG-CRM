"""Caretaker cash in hand and owner handovers (BE-41): threat #1, cash pocketing.

Every cash payment raises the cash in hand of the caretaker who logged it (`payments.received_by` is forced to the
caller); cash expenses lower it; only the owner can record a handover that lowers it, and handovers are immutable
(`app.cash_handovers_guard`). Void payments and expenses drop out automatically. The sums come from
`api.cash_balances()` and the entries from `api.cash_ledger()`, which share one scope, so the ledger always adds up
to the balance.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from psycopg import Cursor
from psycopg.rows import DictRow

from app import idempotency
from app.deps import Org, require_owner
from app.idempotency import IdempotencyKey
from app.money import format_inr
from app.schemas import CashBalance, CashHandover, CashHandoverCreate, CashHandoverResult, CashLedger, CashLedgerEntry

router = APIRouter(prefix="/cash", tags=["cash"])

_NOT_FOUND = {404: {"description": "Not found"}}
_HANDOVERS = """
  SELECT h.id, h.caretaker_user_id, c.full_name AS caretaker_name, h.amount_paise, h.handed_over_at, h.recorded_by,
         o.full_name AS recorded_by_name, h.notes
    FROM cash_handovers h
    JOIN users c ON c.id = h.caretaker_user_id
    JOIN users o ON o.id = h.recorded_by
"""
_CATEGORY = {
    "water_tanker": "Water tanker",
    "electricity_bescom": "Electricity (BESCOM)",
    "groceries": "Groceries",
    "gas_lpg": "Gas (LPG)",
    "maintenance_repairs": "Maintenance and repairs",
    "cleaning": "Cleaning",
    "internet": "Internet",
    "staff_salary": "Staff salary",
    "security": "Security",
    "lease_rent": "Lease rent",
    "other": "Other expense",
}


def _balance(cur: Cursor[DictRow], user_id: UUID) -> dict | None:
    cur.execute("SELECT * FROM api.cash_balances() WHERE user_id = %s", (user_id,))
    return cur.fetchone()


@router.get("/balances", response_model=list[CashBalance])
def balances(ctx: Org) -> list[CashBalance]:
    """Owner: every caretaker. Caretaker: only themself."""
    with ctx.tx() as cur:
        cur.execute("SELECT * FROM api.cash_balances()")
        return [CashBalance(**r) for r in cur.fetchall()]


@router.post("/handovers", response_model=CashHandoverResult, status_code=201)
def record_handover(
    body: CashHandoverCreate, ctx: Org, idempotency_key: IdempotencyKey = None
) -> CashHandoverResult | JSONResponse:
    """Owner only. A handover larger than the caretaker's cash in hand is recorded (the owner may be settling an
    advance) but comes back with a `warning`. Send an `Idempotency-Key` so a retry can't record it twice."""
    request_hash = idempotency.hash_body(body)
    with ctx.tx() as cur:
        require_owner(cur, "Only the owner can record a cash handover.")
        if (replay := idempotency.replay(cur, idempotency_key, request_hash)) is not None:
            return replay
        cur.execute(
            """INSERT INTO cash_handovers (org_id, caretaker_user_id, amount_paise, recorded_by, notes)
               VALUES (%s, %s, %s, %s, %s) RETURNING id""",
            (ctx.org_id, body.caretaker_user_id, body.amount_paise, ctx.user_id, body.notes),
        )
        handover_id = cur.fetchone()["id"]
        cur.execute(_HANDOVERS + " WHERE h.id = %s", (handover_id,))
        handover = cur.fetchone()
        after = _balance(cur, body.caretaker_user_id)["in_hand_paise"]
        warning = None
        if after < 0:
            warning = (
                f"This is {format_inr(-after)} more than {handover['caretaker_name']} had in hand "
                f"({format_inr(after + body.amount_paise)}). Recorded anyway."
            )
        result = CashHandoverResult(**handover, in_hand_paise=after, warning=warning)
        idempotency.save(cur, idempotency_key, request_hash, 201, result)
    return result


@router.get("/handovers", response_model=list[CashHandover])
def list_handovers(ctx: Org, caretaker_user_id: UUID | None = None) -> list[CashHandover]:
    """Newest first. Caretakers see only their own (RLS)."""
    with ctx.tx() as cur:
        cur.execute(
            _HANDOVERS
            + " WHERE (%(c)s::uuid IS NULL OR h.caretaker_user_id = %(c)s::uuid)"
            + " ORDER BY h.handed_over_at DESC, h.id",
            {"c": caretaker_user_id},
        )
        return [CashHandover(**r) for r in cur.fetchall()]


def _describe(row: dict) -> str:
    if row["entry_type"] == "payment":
        return f"Cash from {row['resident_name']}"
    if row["entry_type"] == "expense":
        return _CATEGORY.get(row["expense_category"], row["expense_category"])
    return "Handed over to the owner"


@router.get("/ledger", response_model=CashLedger, responses=_NOT_FOUND)
def ledger(ctx: Org, caretaker_user_id: UUID | None = None) -> CashLedger:
    """One caretaker's cash payments (+), cash expenses (-) and handovers (-), oldest first, with the running
    balance. Defaults to the caller. A caretaker can only see their own."""
    target = caretaker_user_id or ctx.user_id
    with ctx.tx() as cur:
        who = _balance(cur, target)
        if who is None:
            raise HTTPException(404, "Caretaker not found")
        cur.execute("SELECT * FROM api.cash_ledger(%s)", (target,))
        rows = cur.fetchall()
    balance, entries = 0, []
    for row in rows:
        if not row["voided"]:
            balance += row["amount_paise"]
        entries.append(
            CashLedgerEntry(
                entry_at=row["entry_at"],
                type=row["entry_type"],
                id=row["id"],
                property_name=row["property_name"],
                description=_describe(row),
                notes=row["notes"],
                amount_paise=row["amount_paise"],
                voided=row["voided"],
                balance_paise=balance,
            )
        )
    return CashLedger(user_id=who["user_id"], full_name=who["full_name"], in_hand_paise=balance, entries=entries)


@router.get("/ci-proof")
def ci_proof() -> dict:
    """Throwaway (BE-02 proof): an API change without a regenerated contract."""
    return {}
