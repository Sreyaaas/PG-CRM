"""Expenses (threat #6, padded no-bill expenses; lease rent is owner-only).

The rules live in `app.expenses_guard` and the `expenses_*` RLS policies: no-bill needs a note, a live photo with
time and GPS and is auto-flagged for caretakers; caretakers pay from their cash, date within 3 days, never see or
log lease rent. This router adds the checks the database can't make: the proof key must be one BE-20 issued for
this org/property, and a no-bill photo must have been *uploaded* in the last 15 minutes by the storage clock
(the phone's capture timestamp alone can be faked).
"""

import re
from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from psycopg import sql

from app import idempotency, storage
from app.deps import Org, require_owner
from app.errors import error_body
from app.idempotency import IdempotencyKey
from app.schemas import Expense, ExpenseCategory, ExpenseCreate, ExpenseReview, VoidRequest

router = APIRouter(prefix="/expenses", tags=["expenses"])

LIVE_PHOTO_WINDOW = timedelta(minutes=15)
_CLOCK_SKEW = timedelta(minutes=2)
_KEY_NAME = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$")
_COLUMNS = """
  id, property_id, category::text AS category, amount_paise, quantity::float8 AS quantity, unit, expense_date,
  vendor_name, notes, bill_mode::text AS bill_mode, proof_path, proof_captured_at, proof_lat::float8 AS proof_lat,
  proof_lng::float8 AS proof_lng, paid_from::text AS paid_from, owner_only, flagged_for_review, reviewed_by,
  reviewed_at, review_note, created_by, created_at, voided_at, voided_by, void_reason
"""
_NOT_FOUND = {404: {"description": "Not found"}}


def _invalid(message: str) -> JSONResponse:
    return JSONResponse(status_code=422, content=error_body("invalid", message))


def _proof_problem(body: ExpenseCreate, org_id: UUID) -> str | None:
    prefix = f"org/{org_id}/{body.property_id}/expense_proof/"
    if not body.proof_path.startswith(prefix) or not _KEY_NAME.match(body.proof_path[len(prefix) :]):
        return "The bill photo must be uploaded for this building (POST /uploads, kind expense_proof)."
    exists, uploaded_at = storage.object_exists(body.proof_path)
    if not exists:
        return "The bill photo hasn't been uploaded. Please take it again."
    if body.bill_mode == "no_bill":
        now = datetime.now(UTC)
        if uploaded_at is None or not (now - LIVE_PHOTO_WINDOW <= uploaded_at <= now + _CLOCK_SKEW):
            return "No-bill photo must be taken and uploaded within the last 15 minutes."
    return None


@router.post("", response_model=Expense, status_code=201, responses=_NOT_FOUND)
def create_expense(body: ExpenseCreate, ctx: Org, idempotency_key: IdempotencyKey = None) -> Expense | JSONResponse:
    """Caretaker or owner, for a building they can access. `created_by` is always the caller. Send an
    `Idempotency-Key` so a retry after a timeout can't record the expense twice."""
    request_hash = idempotency.hash_body(body)
    with ctx.tx() as cur:
        if (replay := idempotency.replay(cur, idempotency_key, request_hash)) is not None:
            return replay
        cur.execute("SELECT 1 FROM properties WHERE id = %s", (body.property_id,))  # RLS hides other buildings
        if cur.fetchone() is None:
            raise HTTPException(404, "Property not found")
        problem = _proof_problem(body, ctx.org_id)
        if problem:
            return _invalid(problem)
        values = body.model_dump() | {"org_id": ctx.org_id}
        cur.execute(
            sql.SQL("INSERT INTO expenses ({cols}) VALUES ({vals}) RETURNING {ret}").format(
                cols=sql.SQL(", ").join(map(sql.Identifier, values)),
                vals=sql.SQL(", ").join(map(sql.Placeholder, values)),
                ret=sql.SQL(_COLUMNS),
            ),
            values,
        )
        expense = Expense(**cur.fetchone())
        idempotency.save(cur, idempotency_key, request_hash, 201, expense)
        return expense


@router.get("", response_model=list[Expense])
def list_expenses(
    ctx: Org,
    property_id: UUID | None = None,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    category: ExpenseCategory | None = None,
    flagged: bool | None = Query(default=None, description="true = only expenses waiting for owner review"),
) -> list[Expense]:
    """Newest first. Caretakers see their buildings only and never lease rent (RLS)."""
    where, params = [], []
    for column, op, value in (
        ("property_id", "=", property_id),
        ("expense_date", ">=", from_),
        ("expense_date", "<=", to),
        ("category", "=", category),
        ("flagged_for_review", "=", flagged),
    ):
        if value is not None:
            where.append(sql.SQL("{} " + op + " %s").format(sql.Identifier(column)))
            params.append(value)
    query = sql.SQL("SELECT {} FROM expenses").format(sql.SQL(_COLUMNS))
    if where:
        query += sql.SQL(" WHERE ") + sql.SQL(" AND ").join(where)
    query += sql.SQL(" ORDER BY expense_date DESC, created_at DESC")
    with ctx.tx() as cur:
        cur.execute(query, params)
        return [Expense(**r) for r in cur.fetchall()]


@router.post("/{expense_id}/review", response_model=Expense, responses=_NOT_FOUND)
def review_expense(expense_id: UUID, body: ExpenseReview, ctx: Org) -> Expense:
    """Owner only: mark as reviewed (sets reviewed_by/reviewed_at, clears the yellow flag)."""
    with ctx.tx() as cur:
        require_owner(cur, "Only the owner can review expenses.")
        cur.execute(
            f"""UPDATE expenses SET reviewed_at = now(), flagged_for_review = false, review_note = %s
                 WHERE id = %s RETURNING {_COLUMNS}""",
            (body.note, expense_id),
        )
        row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Expense not found")
    return Expense(**row)


# ---- Void (BE-44) -------------------------------------------------------------------------------------------------


@router.post("/{expense_id}/void", response_model=Expense, responses=_NOT_FOUND)
def void_expense(expense_id: UUID, body: VoidRequest, ctx: Org) -> Expense:
    """Owner only. Final (409 on a second void). A void cash expense no longer lowers the caretaker's cash in hand."""
    with ctx.tx() as cur:
        require_owner(cur, "Only the owner can void an expense.")
        cur.execute(
            f"UPDATE expenses SET voided_at = now(), void_reason = %s WHERE id = %s RETURNING {_COLUMNS}",
            (body.reason, expense_id),
        )
        row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Expense not found")
    return Expense(**row)
