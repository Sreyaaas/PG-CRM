"""Audit log viewer (BE-44): threat #4, nothing is ever deleted.

`audit_logs` is written only by the `app.audit_row()` triggers and can't be edited or deleted, even by a superuser.
RLS lets only the owner read it; the explicit 403 below is just a clearer message for caretakers.
"""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from app.deps import Org, require_owner
from app.schemas import AuditLogEntry, AuditLogPage

router = APIRouter(tags=["audit"])

_DAY = "(a.created_at AT TIME ZONE 'Asia/Kolkata')::date"
_FILTERS = (
    ("entity_type", "a.entity_type = %(entity_type)s"),
    ("entity_id", "a.entity_id = %(entity_id)s"),
    ("actor_id", "a.actor_id = %(actor_id)s"),
    ("from", f"{_DAY} >= %(from)s"),
    ("to", f"{_DAY} <= %(to)s"),
    ("cursor", "a.id < %(cursor)s"),
)


@router.get("/audit-logs", response_model=AuditLogPage)
def audit_logs(
    ctx: Org,
    entity_type: Annotated[str | None, Query(description="Table name, e.g. payments")] = None,
    entity_id: UUID | None = None,
    actor_id: UUID | None = None,
    from_: Annotated[date | None, Query(alias="from", description="On or after (IST)")] = None,
    to: Annotated[date | None, Query(description="On or before (IST)")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    cursor: Annotated[int | None, Query(ge=1, description="`next_cursor` of the previous page")] = None,
) -> AuditLogPage:
    """Owner only. Every insert and update, newest first, with the actor's name."""
    params = {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "actor_id": actor_id,
        "from": from_,
        "to": to,
        "cursor": cursor,
    }
    where = [clause for key, clause in _FILTERS if params[key] is not None]
    params = {k: v for k, v in params.items() if v is not None} | {"limit": limit}
    query = """
      SELECT a.id, a.created_at, a.actor_id, u.full_name AS actor_name, a.entity_type, a.entity_id, a.action,
             a.old_value, a.new_value
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_id
    """
    if where:
        query += " WHERE " + " AND ".join(where)
    query += " ORDER BY a.id DESC LIMIT %(limit)s"
    with ctx.tx() as cur:
        require_owner(cur, "Only the owner can see the audit log.")
        cur.execute(query, params)
        rows = cur.fetchall()
    return AuditLogPage(
        items=[AuditLogEntry(**r) for r in rows],
        next_cursor=rows[-1]["id"] if len(rows) == limit else None,
    )
