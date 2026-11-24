"""Stays: notice, withdraw notice, move-out, arrival of a reserved stay, owner corrections; resident detail.

The occupancy rules live in `app.stays_guard` (threat #4): caretakers give notice only today with the computed
last day, move out only today, never change check-in date / deposit / resident or a vacated stay. Owners can, and
every change lands in the audit log. Bed status follows the stay (`stays_sync_bed`).
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from psycopg import Cursor, sql
from psycopg.rows import DictRow

from app import billing, storage
from app.deps import Org, require_owner
from app.errors import error_body
from app.schemas import MoveOutRequest, NoticeRequest, Resident, Stay, StayCorrection

router = APIRouter(tags=["stays"])

_NOT_FOUND = {404: {"description": "Not found"}}

_SELECT = """
  SELECT s.id, s.property_id, s.resident_id, r.full_name AS resident_name, s.bed_id, b.label AS bed_label,
         rm.label AS room_label, s.stay_type::text AS stay_type, s.status::text AS status, s.rent_paise,
         s.deposit_paise, s.check_in_date, s.notice_given_on, s.expected_vacate_date, s.actual_vacate_date,
         s.discount_request_id, s.created_at, s.updated_at
    FROM stays s
    JOIN residents r ON r.id = s.resident_id
    JOIN beds b ON b.id = s.bed_id
    JOIN rooms rm ON rm.id = b.room_id
"""


def _invalid(message: str) -> JSONResponse:
    return JSONResponse(status_code=422, content=error_body("invalid", message))


def _stay(cur: Cursor[DictRow], stay_id: UUID) -> Stay:
    cur.execute(_SELECT + " WHERE s.id = %s", (stay_id,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Stay not found")
    return Stay(**row)


def _update(cur: Cursor[DictRow], stay_id: UUID, values: dict) -> Stay:
    cur.execute(
        sql.SQL("UPDATE stays SET {} WHERE id = {}").format(
            sql.SQL(", ").join(sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder(k)) for k in values),
            sql.Placeholder("_id"),
        ),
        values | {"_id": stay_id},
    )
    return _stay(cur, stay_id)


@router.get("/stays/{stay_id}", response_model=Stay, responses=_NOT_FOUND)
def get_stay(stay_id: UUID, ctx: Org) -> Stay:
    with ctx.tx() as cur:
        return _stay(cur, stay_id)


@router.post("/stays/{stay_id}/notice", response_model=Stay, responses=_NOT_FOUND)
def give_notice(stay_id: UUID, ctx: Org, body: NoticeRequest | None = None) -> Stay | JSONResponse:
    """Monthly stays. Caretakers send no body: notice is today (IST) and the last day follows the property's notice
    deadline day. Owners may send `notice_given_on` and/or `expected_vacate_date` to override (audit-logged)."""
    body = body or NoticeRequest()
    with ctx.tx() as cur:
        stay = _stay(cur, stay_id)
        if stay.stay_type != "monthly":
            return _invalid("Notice is only for monthly stays; a short stay ends on its check-out date.")
        if stay.status not in ("active", "on_notice"):
            return _invalid("Notice can only be given for an active stay.")
        cur.execute(
            "SELECT app.today_ist() AS today, notice_deadline_day FROM properties WHERE id = %s", (stay.property_id,)
        )
        p = cur.fetchone()
        notice = body.notice_given_on or p["today"]
        last_day = body.expected_vacate_date or billing.notice_last_day(notice, p["notice_deadline_day"])
        if last_day < stay.check_in_date:
            return _invalid("The last day can't be before the check-in date.")
        return _update(
            cur, stay_id, {"status": "on_notice", "notice_given_on": notice, "expected_vacate_date": last_day}
        )


@router.post("/stays/{stay_id}/withdraw-notice", response_model=Stay, responses=_NOT_FOUND)
def withdraw_notice(stay_id: UUID, ctx: Org) -> Stay | JSONResponse:
    """Back to `active`; clears the notice date and the last day."""
    with ctx.tx() as cur:
        if _stay(cur, stay_id).status != "on_notice":
            return _invalid("This stay is not on notice.")
        return _update(cur, stay_id, {"status": "active", "notice_given_on": None, "expected_vacate_date": None})


@router.post("/stays/{stay_id}/move-out", response_model=Stay, responses=_NOT_FOUND)
def move_out(stay_id: UUID, body: MoveOutRequest, ctx: Org) -> Stay | JSONResponse:
    """`vacated`, and the bed becomes vacant. Caretakers: today only. Doesn't settle the deposit (BE-50)."""
    with ctx.tx() as cur:
        stay = _stay(cur, stay_id)
        if stay.status == "vacated":
            # Caretakers get the guard's 403; owners correct the date with PATCH.
            cur.execute("SELECT app.is_owner() AS owner")
            if cur.fetchone()["owner"]:
                return _invalid("This resident has already moved out; correct the date instead.")
        return _update(cur, stay_id, {"status": "vacated", "actual_vacate_date": body.actual_vacate_date})


@router.post("/stays/{stay_id}/check-in", response_model=Stay, responses=_NOT_FOUND)
def check_in(stay_id: UUID, ctx: Org) -> Stay | JSONResponse:
    """A reserved resident has arrived: `reserved` -> `active`."""
    with ctx.tx() as cur:
        if _stay(cur, stay_id).status != "reserved":
            return _invalid("Only a reserved stay can be checked in.")
        return _update(cur, stay_id, {"status": "active"})


@router.patch("/stays/{stay_id}", response_model=Stay, responses=_NOT_FOUND)
def correct_stay(stay_id: UUID, body: StayCorrection, ctx: Org) -> Stay | JSONResponse:
    """Owner only: correct check-in date, move-out date, deposit or rent. Every change is in the audit log."""
    values = body.model_dump(exclude_unset=True)
    with ctx.tx() as cur:
        require_owner(cur, "Only the owner can correct a stay.")
        stay = _stay(cur, stay_id)
        if "actual_vacate_date" in values and stay.status != "vacated":
            return _invalid("Record the move-out first; only an existing move-out date can be corrected.")
        if not values:
            return stay
        return _update(cur, stay_id, values)


@router.get("/residents/{resident_id}", response_model=Resident, responses=_NOT_FOUND)
def get_resident(resident_id: UUID, ctx: Org) -> Resident:
    """Resident details, signed ID photo URLs, the current stay and past stays."""
    with ctx.tx() as cur:
        cur.execute(
            """SELECT id, property_id, onboarding_request_id, full_name, phone, email, date_of_birth,
                      permanent_address, occupation::text AS occupation, employer_or_college, emergency_contact_name,
                      emergency_contact_phone, id_doc_type::text AS id_doc_type, id_doc_number, id_doc_path,
                      selfie_path, is_foreign_national, passport_number, visa_number, visa_expiry, created_at
                 FROM residents WHERE id = %s""",
            (resident_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "Resident not found")
        cur.execute(
            _SELECT + " WHERE s.resident_id = %s ORDER BY s.check_in_date DESC, s.created_at DESC", (resident_id,)
        )
        stays = [Stay(**s) for s in cur.fetchall()]
    id_doc, selfie = row.pop("id_doc_path"), row.pop("selfie_path")
    return Resident(
        **row,
        id_doc_url=storage.presign_get(id_doc) if id_doc else None,
        selfie_url=storage.presign_get(selfie) if selfie else None,
        url_expires_in=storage.VIEW_TTL,
        current_stay=next((s for s in stays if s.status != "vacated"), None),
        past_stays=[s for s in stays if s.status == "vacated"],
    )
