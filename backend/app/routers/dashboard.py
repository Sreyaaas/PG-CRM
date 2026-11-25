"""Owner dashboard (BE-43): the absentee owner's one screen. Is money coming in (P&L), are the beds full
(occupancy), where is it leaking and what needs my approval (attention counts).

Owner only. Each attention count uses the same filter as the list the frontend deep-links to, so tapping a count
always shows exactly that many rows:

| count                                   | list                                                  |
|-----------------------------------------|-------------------------------------------------------|
| pending_onboarding                      | GET /onboarding-requests?status=pending               |
| pending_discounts                       | GET /discount-requests?status=pending                 |
| flagged_expenses_unreviewed             | GET /expenses?flagged=true                            |
| provisional_payments_older_than_3_days  | GET /reconciliation/unverified-payments?older_than_days=3 |
| flagged_payments                        | GET /payments?status=flagged                          |
| cash_in_hand_total_paise                | sum of in_hand_paise from GET /cash/balances          |
| overstaying_residents                   | (no list yet)                                         |
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.deps import Org, require_owner
from app.errors import error_body
from app.routers.reconciliation import UNVERIFIED_WHERE
from app.schemas import Dashboard, DashboardAttention, DashboardOccupancy, DashboardPnl

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

PROVISIONAL_AGE_DAYS = 3

_OCCUPANCY = """
  SELECT p.id AS property_id, p.name,
         count(b.id)                                       AS beds_total,
         count(b.id) FILTER (WHERE b.status = 'vacant')    AS vacant,
         count(b.id) FILTER (WHERE b.status = 'reserved')  AS reserved,
         count(b.id) FILTER (WHERE b.status = 'occupied')  AS occupied,
         count(b.id) FILTER (WHERE b.status = 'on_notice') AS on_notice
    FROM properties p
    LEFT JOIN beds b ON b.property_id = p.id AND b.is_active
   GROUP BY p.id, p.name
   ORDER BY p.name, p.id
"""

_ATTENTION = f"""
  SELECT
    (SELECT count(*) FROM onboarding_requests WHERE status = 'pending') AS pending_onboarding,
    (SELECT count(*) FROM discount_requests WHERE status = 'pending') AS pending_discounts,
    (SELECT count(*) FROM expenses WHERE flagged_for_review) AS flagged_expenses_unreviewed,
    (SELECT count(*) FROM payments pm WHERE {UNVERIFIED_WHERE}) AS provisional_payments_older_than_3_days,
    (SELECT count(*) FROM payments WHERE status = 'flagged') AS flagged_payments,
    (SELECT coalesce(sum(in_hand_paise), 0) FROM api.cash_balances()) AS cash_in_hand_total_paise,
    (SELECT count(DISTINCT resident_id) FROM stays
      WHERE status = 'on_notice' AND expected_vacate_date < app.today_ist() AND actual_vacate_date IS NULL
    ) AS overstaying_residents
"""


@router.get("", response_model=Dashboard, responses={422: {"description": "`from` is after `to`"}})
def dashboard(
    ctx: Org,
    from_: Annotated[date | None, Query(alias="from", description="First day (IST). Default: 1st of the month")] = None,
    to: Annotated[date | None, Query(description="Last day (IST), inclusive. Default: last day of this month")] = None,
) -> Dashboard | JSONResponse:
    """Owner only. P&L for the period, occupancy now, and the counts that need the owner's attention now."""
    with ctx.tx() as cur:
        require_owner(cur, "Only the owner can see the dashboard.")
        cur.execute(
            """SELECT coalesce(%(from)s::date, date_trunc('month', app.today_ist())::date) AS f,
                      coalesce(%(to)s::date,
                               (date_trunc('month', app.today_ist()) + interval '1 month - 1 day')::date) AS t""",
            {"from": from_, "to": to},
        )
        period = cur.fetchone()
        if period["f"] > period["t"]:
            return JSONResponse(status_code=422, content=error_body("invalid", "`from` must be on or before `to`."))

        cur.execute("SELECT * FROM api.owner_pnl(%s, %s)", (period["f"], period["t"]))
        pnl = [DashboardPnl(**r) for r in cur.fetchall()]
        cur.execute(_OCCUPANCY)
        occupancy = [DashboardOccupancy(**r) for r in cur.fetchall()]
        cur.execute(_ATTENTION, {"older_than_days": PROVISIONAL_AGE_DAYS})
        attention = DashboardAttention(**cur.fetchone())
    return Dashboard(pnl=pnl, occupancy=occupancy, attention=attention)
