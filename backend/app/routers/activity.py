"""Activity feed (BE-45): the audit log as human-readable lines for the owner home.

Owner only: `audit_logs` is readable only by owners (RLS `audit_logs_select`). Read-only; no new table.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from app.activity import Names, summarize
from app.deps import Org, require_owner
from app.schemas import ActivityItem

router = APIRouter(tags=["activity"])

_ROWS = """
  SELECT a.id, a.created_at AS at, a.actor_id, a.entity_type, a.entity_id, a.action, a.old_value, a.new_value,
         coalesce(a.new_value ->> 'property_id', a.old_value ->> 'property_id',
                  CASE WHEN a.entity_type = 'properties' THEN a.entity_id::text END) AS property_id
    FROM audit_logs a
   WHERE a.org_id = app.current_org_id()
"""
_PROPERTY_FILTER = """
     AND (a.new_value ->> 'property_id' = %(p)s OR a.old_value ->> 'property_id' = %(p)s
          OR (a.entity_type = 'properties' AND a.entity_id::text = %(p)s))
"""


def _ids(rows: list[dict], *keys: str) -> set[str]:
    out = set()
    for r in rows:
        for value in (r["new_value"] or {}, r["old_value"] or {}):
            for k in keys:
                if value.get(k):
                    out.add(value[k])
    return out


@router.get("/activity", response_model=list[ActivityItem])
def activity(
    ctx: Org,
    property_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[ActivityItem]:
    """Owner only. Newest first: who did what, as one line each (names, labels and ₹ amounts only)."""
    with ctx.tx() as cur:
        require_owner(cur, "Only the owner can see the activity feed.")
        query, params = _ROWS, {"limit": limit}
        if property_id is not None:
            query += _PROPERTY_FILTER
            params["p"] = str(property_id)
        cur.execute(query + " ORDER BY a.id DESC LIMIT %(limit)s", params)
        rows = cur.fetchall()

        names = Names()
        user_ids = {r["actor_id"] for r in rows if r["actor_id"]} | {
            UUID(x) for x in _ids(rows, "user_id", "caretaker_user_id", "assigned_to")
        }
        cur.execute("SELECT id, full_name FROM users WHERE id = ANY(%s)", (list(user_ids),))
        names.users = {r["id"]: r["full_name"] for r in cur.fetchall()}
        cur.execute("SELECT id, name FROM properties")
        names.properties = {r["id"]: r["name"] for r in cur.fetchall()}
        cur.execute("SELECT id, label FROM beds WHERE id = ANY(%s)", ([UUID(x) for x in _ids(rows, "bed_id")],))
        names.beds = {r["id"]: r["label"] for r in cur.fetchall()}
        cur.execute(
            "SELECT id, full_name FROM residents WHERE id = ANY(%s)", ([UUID(x) for x in _ids(rows, "resident_id")],)
        )
        names.residents = {r["id"]: r["full_name"] for r in cur.fetchall()}

    items = []
    for r in rows:
        actor = names.users.get(r["actor_id"], "Someone") if r["actor_id"] else None
        items.append(
            ActivityItem(
                id=r["id"],
                at=r["at"],
                actor_id=r["actor_id"],
                actor_name=names.users.get(r["actor_id"]) if r["actor_id"] else None,
                entity_type=r["entity_type"],
                entity_id=r["entity_id"],
                action=r["action"],
                property_id=r["property_id"],
                summary=summarize(r["entity_type"], r["action"], r["old_value"], r["new_value"], actor, names),
            )
        )
    return items
