"""Onboarding queue: QR submissions reviewed by the owner or a caretaker of that property.

Approving turns a request into a resident + stay + joining invoices in ONE transaction. The rules live in the
database: RLS hides other buildings' requests, `app.onboarding_guard` allows one review, `app.stays_guard` holds the
rent floor / deposit floor / no backdating, `app.invoices_guard` the maintenance-charge floor, and
`uq_stays_open_bed` one open stay per bed. Any of them failing rolls everything back (the request stays pending).
"""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from psycopg import Cursor
from psycopg.rows import DictRow

from app import billing, storage
from app.deps import Org
from app.schemas import (
    OnboardingApprove,
    OnboardingApproved,
    OnboardingReject,
    OnboardingRequestDetail,
    OnboardingRequestSummary,
    OnboardingStatus,
    OnboardingSuggested,
    StayType,
)

router = APIRouter(prefix="/onboarding-requests", tags=["onboarding"])

_NOT_FOUND = {404: {"description": "Not found"}}

# Identity / KYC columns copied from the request onto the resident.
_RESIDENT_FIELDS = (
    "full_name, phone, email, date_of_birth, permanent_address, occupation, employer_or_college, "
    "emergency_contact_name, emergency_contact_phone, id_doc_type, id_doc_number, id_doc_path, selfie_path, "
    "is_foreign_national, passport_number, visa_number, visa_expiry, "
    "emergency_contact_relation, food_preference, vehicle_number"
)


def _today(cur: Cursor[DictRow]) -> date:
    cur.execute("SELECT app.today_ist() AS d")
    return cur.fetchone()["d"]


@router.get("", response_model=list[OnboardingRequestSummary])
def list_requests(
    ctx: Org, status: OnboardingStatus | None = None, property_id: UUID | None = None
) -> list[OnboardingRequestSummary]:
    """Requests in the buildings the caller can access (RLS), newest first. `?status=pending` for the queue."""
    with ctx.tx() as cur:
        cur.execute(
            """SELECT id, full_name, phone, occupation, employer_or_college, is_foreign_national, created_at
                 FROM onboarding_requests
                WHERE (%(status)s::onboarding_status IS NULL OR status = %(status)s::onboarding_status)
                  AND (%(property_id)s::uuid IS NULL OR property_id = %(property_id)s::uuid)
                ORDER BY created_at DESC""",
            {"status": status, "property_id": property_id},
        )
        return [OnboardingRequestSummary(**r) for r in cur.fetchall()]


def _detail(
    cur: Cursor[DictRow], request_id: UUID, bed_id: UUID | None = None, stay_type: StayType = "monthly"
) -> OnboardingRequestDetail:
    cur.execute(
        """SELECT o.id, o.property_id, p.name AS property_name, o.status::text AS status,
                  o.full_name, o.phone, o.email, o.date_of_birth, o.permanent_address, o.occupation::text AS occupation,
                  o.employer_or_college, o.emergency_contact_name, o.emergency_contact_phone,
                  o.emergency_contact_relation, o.food_preference::text AS food_preference, o.vehicle_number,
                  o.id_doc_type::text AS id_doc_type, o.id_doc_number, o.id_doc_path, o.selfie_path,
                  o.is_foreign_national, o.passport_number, o.visa_number, o.visa_expiry, o.accepted_rules,
                  o.accepted_exit_deduction_paise, o.accepted_at, o.created_at, o.reviewed_by, o.reviewed_at,
                  o.review_note, p.security_deposit_paise, p.maintenance_charge_paise, p.short_term_daily_rate_paise
             FROM onboarding_requests o JOIN properties p ON p.id = o.property_id
            WHERE o.id = %s""",
        (request_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Onboarding request not found")

    rent = None
    if stay_type == "short_term":
        rent = row["short_term_daily_rate_paise"]
    elif bed_id is not None:
        cur.execute("SELECT base_rent_paise FROM beds WHERE id = %s AND property_id = %s", (bed_id, row["property_id"]))
        bed = cur.fetchone()
        if bed is None:
            raise HTTPException(404, "Bed not found in this property")
        rent = bed["base_rent_paise"]
    suggested = OnboardingSuggested(
        rent_paise=rent,
        deposit_paise=row.pop("security_deposit_paise"),
        maintenance_charge_paise=row.pop("maintenance_charge_paise"),
        first_month_rent_paise=(
            billing.first_month_rent(rent, _today(cur)) if stay_type == "monthly" and rent is not None else None
        ),
    )
    row.pop("short_term_daily_rate_paise")
    return OnboardingRequestDetail(
        **row,
        id_doc_url=storage.presign_get(row["id_doc_path"]),
        selfie_url=storage.presign_get(row["selfie_path"]),
        url_expires_in=storage.VIEW_TTL,
        suggested=suggested,
    )


@router.get("/{request_id}", response_model=OnboardingRequestDetail, responses=_NOT_FOUND)
def get_request(
    request_id: UUID,
    ctx: Org,
    bed_id: Annotated[UUID | None, Query(description="Bed being considered: fills suggested.rent_paise")] = None,
    stay_type: StayType = "monthly",
) -> OnboardingRequestDetail:
    """Every submitted field, signed photo URLs (5 minutes) and `suggested` defaults for the approve form."""
    with ctx.tx() as cur:
        return _detail(cur, request_id, bed_id, stay_type)


@router.post("/{request_id}/approve", response_model=OnboardingApproved, status_code=201, responses=_NOT_FOUND)
def approve_request(request_id: UUID, body: OnboardingApprove, ctx: Org) -> OnboardingApproved:
    """Creates the resident, the stay (`active`, or `reserved` for a future check-in) and the joining invoices,
    all due on the check-in date: deposit, maintenance charge, and the pro-rata first month (monthly) or
    nights × daily rate (short-term). All or nothing."""
    with ctx.tx() as cur:
        cur.execute(
            "UPDATE onboarding_requests SET status = 'approved' WHERE id = %s RETURNING id, org_id, property_id",
            (request_id,),
        )
        req = cur.fetchone()
        if req is None:
            raise HTTPException(404, "Onboarding request not found")

        cur.execute(
            f"""INSERT INTO residents (org_id, property_id, onboarding_request_id, {_RESIDENT_FIELDS})
                SELECT org_id, property_id, id, {_RESIDENT_FIELDS} FROM onboarding_requests WHERE id = %s
                RETURNING id""",
            (request_id,),
        )
        resident_id = cur.fetchone()["id"]

        cur.execute(
            """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, status, rent_paise,
                                  deposit_paise, check_in_date, expected_vacate_date, discount_request_id)
               VALUES (%(org)s, %(prop)s, %(res)s, %(bed)s, %(type)s,
                       CASE WHEN %(cin)s::date <= app.today_ist() THEN 'active' ELSE 'reserved' END::stay_status,
                       %(rent)s, %(dep)s, %(cin)s, %(vac)s, %(disc)s)
               RETURNING id""",
            {
                "org": req["org_id"],
                "prop": req["property_id"],
                "res": resident_id,
                "bed": body.bed_id,
                "type": body.stay_type,
                "rent": body.rent_paise,
                "dep": body.deposit_paise,
                "cin": body.check_in_date,
                "vac": body.expected_vacate_date,
                "disc": body.discount_request_id,
            },
        )
        stay_id = cur.fetchone()["id"]

        cin = body.check_in_date
        invoices: list[tuple[str, int, date | None, date | None]] = []  # kind, amount, period_start, period_end
        if body.deposit_paise > 0:
            invoices.append(("deposit", body.deposit_paise, None, None))
        if body.maintenance_charge_paise > 0:
            invoices.append(("maintenance_charge", body.maintenance_charge_paise, None, None))
        if body.stay_type == "monthly":
            invoices.append(("rent", billing.first_month_rent(body.rent_paise, cin), cin, billing.month_end(cin)))
        else:
            vacate = body.expected_vacate_date
            invoices.append(("short_term", billing.short_term_amount(body.rent_paise, cin, vacate), cin, vacate))

        invoice_ids = []
        for kind, amount, start, end in invoices:
            cur.execute(
                """INSERT INTO invoices (org_id, property_id, resident_id, stay_id, kind, period_start, period_end,
                                         amount_paise, due_date)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (req["org_id"], req["property_id"], resident_id, stay_id, kind, start, end, amount, cin),
            )
            invoice_ids.append(cur.fetchone()["id"])

    return OnboardingApproved(resident_id=resident_id, stay_id=stay_id, invoice_ids=invoice_ids)


@router.post("/{request_id}/reject", response_model=OnboardingRequestDetail, responses=_NOT_FOUND)
def reject_request(request_id: UUID, body: OnboardingReject, ctx: Org) -> OnboardingRequestDetail:
    """Once only: reviewing the same request again -> 409."""
    with ctx.tx() as cur:
        cur.execute(
            "UPDATE onboarding_requests SET status = 'rejected', review_note = %s WHERE id = %s RETURNING id",
            (body.note, request_id),
        )
        if cur.fetchone() is None:
            raise HTTPException(404, "Onboarding request not found")
        return _detail(cur, request_id)
