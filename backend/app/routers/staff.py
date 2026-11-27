"""Staff: the organization's members (owners and caretakers) and which buildings each caretaker can see.

`organization_members.assigned_property_ids` drives every RLS policy, and roles are read from the database on
every request, so a change applies to the member's next request without a new login.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from psycopg import Cursor, sql
from psycopg.rows import DictRow

from app.deps import Org, require_owner
from app.errors import error_body
from app.schemas import StaffCreate, StaffMember, StaffMemberCreated, StaffUpdate
from app.security import hash_password

router = APIRouter(prefix="/staff", tags=["staff"])

_OWNER_ONLY = "Only the owner can manage staff."
_SELECT = """
  SELECT m.user_id, u.full_name, u.phone, m.role::text AS role, m.assigned_property_ids, m.is_active,
         u.created_at < now() AS existing_account
    FROM organization_members m
    JOIN users u ON u.id = m.user_id
   WHERE m.org_id = app.current_org_id()
"""


def _member(cur: Cursor[DictRow], user_id: UUID) -> dict | None:
    cur.execute(_SELECT + " AND m.user_id = %s", (user_id,))
    return cur.fetchone()


@router.get("", response_model=list[StaffMember])
def list_staff(ctx: Org) -> list[StaffMember]:
    """Owner only. Every member of the organization, including inactive ones. Never includes passwords."""
    with ctx.tx() as cur:
        require_owner(cur, _OWNER_ONLY)
        cur.execute(_SELECT + " ORDER BY m.role, u.full_name")
        return [StaffMember(**r) for r in cur.fetchall()]


@router.post("", response_model=StaffMemberCreated, status_code=201)
def add_staff(body: StaffCreate, ctx: Org) -> StaffMemberCreated:
    """Owner only. Wraps `api.add_staff_member`. If the phone already has an account (e.g. a caretaker who
    works for two owners) only a membership is added and their password is not changed: `existing_account`."""
    with ctx.tx() as cur:
        require_owner(cur, _OWNER_ONLY)
        cur.execute(
            "SELECT api.add_staff_member(%s, %s, %s, %s, %s) AS user_id",
            (body.phone, body.full_name, hash_password(body.password), body.role, body.property_ids),
        )
        # A user created in this transaction has created_at = now(); an existing account is older.
        return StaffMemberCreated(**_member(cur, cur.fetchone()["user_id"]))


@router.patch("/{user_id}", response_model=StaffMember, responses={404: {"description": "Not found"}})
def update_staff(user_id: UUID, body: StaffUpdate, ctx: Org) -> StaffMember | JSONResponse:
    """Owner only, for other members: change assigned buildings, role, or deactivate (removes all access at
    once). Owners can't change their own membership (RLS `members_update` excludes self), so nobody can lock
    themselves out."""
    values = body.model_dump(exclude_unset=True)
    new_name = values.pop("full_name", None)
    with ctx.tx() as cur:
        require_owner(cur, _OWNER_ONLY)
        if user_id == ctx.user_id:
            raise HTTPException(403, "You can't change your own membership.")
        if new_name is not None:
            cur.execute(
                """UPDATE users SET full_name = %s
                   WHERE id = %s AND EXISTS (
                       SELECT 1 FROM organization_members WHERE org_id = app.current_org_id() AND user_id = %s
                   )""",
                (new_name, user_id, user_id),
            )
        if "assigned_property_ids" in values:
            values["assigned_property_ids"] = list(dict.fromkeys(values["assigned_property_ids"]))
            cur.execute(
                "SELECT count(*) AS n FROM properties WHERE org_id = app.current_org_id() AND id = ANY(%s)",
                (values["assigned_property_ids"],),
            )
            if cur.fetchone()["n"] != len(values["assigned_property_ids"]):
                return JSONResponse(
                    status_code=422, content=error_body("invalid", "Property does not belong to this organization")
                )
        if values:
            cur.execute(
                sql.SQL(
                    "UPDATE organization_members SET {} WHERE org_id = app.current_org_id() AND user_id = {}"
                ).format(
                    sql.SQL(", ").join(
                        sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder(k)) for k in values
                    ),
                    sql.Placeholder("_user"),
                ),
                values | {"_user": user_id},
            )
        row = _member(cur, user_id)
    if row is None:
        raise HTTPException(404, "Not a member of this organization")
    return StaffMember(**row)
