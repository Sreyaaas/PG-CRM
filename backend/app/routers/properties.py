from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from psycopg import sql

from app.deps import Org, require_owner
from app.errors import error_body
from app.schemas import Property, PropertyCreate, PropertyUpdate, UpiFromQrRequest, UpiPayeeDetails
from app.upi import NOT_MERCHANT_WARNING, UpiQrError, parse_upi_qr

router = APIRouter(tags=["properties"])

_COLUMNS = """
  id, name, address, locality, qr_slug, upi_vpa, upi_payee_name, upi_mcc, fallback_upi_id, bank_details,
  short_term_daily_rate_paise, exit_deduction_paise, house_rules, rent_due_day, security_deposit_paise,
  maintenance_charge_paise, notice_deadline_day, is_active, created_at, updated_at
"""


def _require_owner(cur) -> None:
    require_owner(cur, "Only the owner can change property settings.")


@router.get("/properties", response_model=list[Property])
def list_properties(ctx: Org) -> list[Property]:
    """Properties the caller can access. Caretakers see only assigned buildings
    (enforced by RLS, not by this query)."""
    with ctx.tx() as cur:
        cur.execute(f"SELECT {_COLUMNS} FROM properties ORDER BY name")
        return [Property(**r) for r in cur.fetchall()]


@router.post("/properties", response_model=Property, status_code=201)
def create_property(body: PropertyCreate, ctx: Org) -> Property:
    """Owner only. Fields left out get the database defaults."""
    values = body.model_dump(exclude_unset=True)
    values["org_id"] = ctx.org_id
    query = sql.SQL("INSERT INTO properties ({cols}) VALUES ({vals}) RETURNING {ret}").format(
        cols=sql.SQL(", ").join(map(sql.Identifier, values)),
        vals=sql.SQL(", ").join(map(sql.Placeholder, values)),
        ret=sql.SQL(_COLUMNS),
    )
    with ctx.tx() as cur:
        _require_owner(cur)
        cur.execute(query, values)
        return Property(**cur.fetchone())


@router.get("/properties/{property_id}", response_model=Property, responses={404: {"description": "Not found"}})
def get_property(property_id: UUID, ctx: Org) -> Property:
    """Owner, or a caretaker assigned to this property (RLS hides the rest: 404)."""
    with ctx.tx() as cur:
        cur.execute(f"SELECT {_COLUMNS} FROM properties WHERE id = %s", (property_id,))
        row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Property not found")
    return Property(**row)


@router.patch("/properties/{property_id}", response_model=Property, responses={404: {"description": "Not found"}})
def update_property(property_id: UUID, body: PropertyUpdate, ctx: Org) -> Property:
    """Owner only. Changes only the fields sent."""
    values = body.model_dump(exclude_unset=True)
    with ctx.tx() as cur:
        _require_owner(cur)
        if values:
            query = sql.SQL("UPDATE properties SET {sets} WHERE id = {id} RETURNING {ret}").format(
                sets=sql.SQL(", ").join(
                    sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder(k)) for k in values
                ),
                id=sql.Placeholder("_id"),
                ret=sql.SQL(_COLUMNS),
            )
            cur.execute(query, values | {"_id": property_id})
        else:
            cur.execute(f"SELECT {_COLUMNS} FROM properties WHERE id = %s", (property_id,))
        row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Property not found")
    return Property(**row)


@router.post(
    "/properties/{property_id}/upi-from-qr",
    response_model=UpiPayeeDetails,
    responses={404: {"description": "Not found"}},
)
def upi_from_qr(property_id: UUID, body: UpiFromQrRequest, ctx: Org) -> UpiPayeeDetails | JSONResponse:
    """Owner only. Saves the payee details (`pa`, `pn`, `mc`) from the owner's scanned Soundbox QR.
    Everything else in the QR (`sign`, `am`, `tr`, `tn`, ...) is dropped; the raw text is never stored."""
    with ctx.tx() as cur:
        _require_owner(cur)
        try:
            payee = parse_upi_qr(body.qr_text)
        except UpiQrError as e:
            return JSONResponse(status_code=422, content=error_body("invalid", str(e)))
        cur.execute(
            """UPDATE properties SET upi_vpa = %s, upi_payee_name = %s, upi_mcc = %s
               WHERE id = %s RETURNING upi_vpa, upi_payee_name, upi_mcc""",
            (payee.vpa, payee.payee_name, payee.mcc, property_id),
        )
        row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "Property not found")
    return UpiPayeeDetails(**row, warning=None if payee.mcc else NOT_MERCHANT_WARNING)
