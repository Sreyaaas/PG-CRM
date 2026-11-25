"""Organization settings (BE-14): business name, GSTIN, WhatsApp message language, receipt footer.

Any member can read them; only the owner can change them (the `org_update` RLS policy requires `app.is_owner()`).
"""

from fastapi import APIRouter
from psycopg import sql

from app.deps import Org, require_owner
from app.schemas import Organization, OrganizationUpdate

router = APIRouter(prefix="/organization", tags=["organization"])

_COLUMNS = "id, name, gstin, whatsapp_language, receipt_footer, created_at"


@router.get("", response_model=Organization)
def get_organization(ctx: Org) -> Organization:
    """The organization in `X-Org-Id`."""
    with ctx.tx() as cur:
        cur.execute(f"SELECT {_COLUMNS} FROM organizations WHERE id = %s", (ctx.org_id,))
        return Organization(**cur.fetchone())


@router.patch("", response_model=Organization)
def update_organization(body: OrganizationUpdate, ctx: Org) -> Organization:
    """Owner only. Changes only the fields sent."""
    values = body.model_dump(exclude_unset=True)
    with ctx.tx() as cur:
        require_owner(cur, "Only the owner can change organization settings.")
        if values:
            cur.execute(
                sql.SQL("UPDATE organizations SET {} WHERE id = {}").format(
                    sql.SQL(", ").join(
                        sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder(k)) for k in values
                    ),
                    sql.Placeholder("_id"),
                ),
                values | {"_id": ctx.org_id},
            )
        cur.execute(f"SELECT {_COLUMNS} FROM organizations WHERE id = %s", (ctx.org_id,))
        return Organization(**cur.fetchone())
