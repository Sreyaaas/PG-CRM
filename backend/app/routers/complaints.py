"""Complaints / maintenance tickets (BE-26): the caretaker's work queue.

Owners and the building's caretakers read and write them (RLS). The database forces `created_by`, needs a
resolution note to resolve (and records who/when), clears it on reopen, checks the assignee is an active member,
keeps room/bed/resident in the same building and forbids deletes. This router adds the photo-key check.
"""

import re
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from psycopg import Cursor, sql
from psycopg.rows import DictRow

from app import storage
from app.deps import Org
from app.errors import error_body
from app.schemas import (
    Complaint,
    ComplaintCategory,
    ComplaintCreate,
    ComplaintPriority,
    ComplaintStatus,
    ComplaintUpdate,
)

router = APIRouter(prefix="/complaints", tags=["complaints"])

_NOT_FOUND = {404: {"description": "Not found"}}
_KEY_NAME = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$")
_SELECT = """
  SELECT c.id, c.property_id, p.name AS property_name, c.room_id, r.label AS room_label, c.bed_id,
         b.label AS bed_label, c.resident_id, res.full_name AS resident_name, c.category::text AS category,
         c.title, c.note, c.priority::text AS priority, c.status::text AS status, c.photo_path, c.assigned_to,
         ua.full_name AS assigned_to_name, c.created_by, uc.full_name AS created_by_name, c.created_at,
         c.updated_at, c.resolved_by, c.resolved_at, c.resolution_note
    FROM complaints c
    JOIN properties p ON p.id = c.property_id
    JOIN users uc ON uc.id = c.created_by
    LEFT JOIN users ua ON ua.id = c.assigned_to
    LEFT JOIN rooms r ON r.id = c.room_id
    LEFT JOIN beds b ON b.id = c.bed_id
    LEFT JOIN residents res ON res.id = c.resident_id
"""


def _one(cur: Cursor[DictRow], complaint_id: UUID) -> Complaint | None:
    cur.execute(_SELECT + " WHERE c.id = %s", (complaint_id,))
    row = cur.fetchone()
    return Complaint(**row) if row else None


def _photo_ok(key: str, org_id: UUID, property_id: UUID) -> bool:
    prefix = f"org/{org_id}/{property_id}/complaint_photo/"
    return key.startswith(prefix) and bool(_KEY_NAME.match(key[len(prefix) :])) and storage.object_exists(key)[0]


@router.post("", response_model=Complaint, status_code=201, responses=_NOT_FOUND)
def create_complaint(body: ComplaintCreate, ctx: Org) -> Complaint | JSONResponse:
    """Owner or a caretaker of that building. Starts `open`; `created_by` is the caller."""
    with ctx.tx() as cur:
        cur.execute("SELECT 1 FROM properties WHERE id = %s", (body.property_id,))  # RLS hides other buildings
        if cur.fetchone() is None:
            raise HTTPException(404, "Property not found")
        if body.photo_path is not None and not _photo_ok(body.photo_path, ctx.org_id, body.property_id):
            return JSONResponse(
                status_code=422,
                content=error_body("invalid", "Upload the photo for this building first (kind complaint_photo)."),
            )
        values = body.model_dump() | {"org_id": ctx.org_id}
        cur.execute(
            sql.SQL("INSERT INTO complaints ({}) VALUES ({}) RETURNING id").format(
                sql.SQL(", ").join(map(sql.Identifier, values)), sql.SQL(", ").join(map(sql.Placeholder, values))
            ),
            values,
        )
        return _one(cur, cur.fetchone()["id"])


@router.get("", response_model=list[Complaint])
def list_complaints(
    ctx: Org,
    property_id: UUID | None = None,
    status: ComplaintStatus | None = None,
    priority: ComplaintPriority | None = None,
    category: ComplaintCategory | None = None,
) -> list[Complaint]:
    """Newest first, in the buildings the caller can access (RLS)."""
    where, params = [], []
    for column, value in (
        ("c.property_id", property_id),
        ("c.status", status),
        ("c.priority", priority),
        ("c.category", category),
    ):
        if value is not None:
            where.append(f"{column} = %s")
            params.append(value)
    query = _SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY c.created_at DESC"
    with ctx.tx() as cur:
        cur.execute(query, params)
        return [Complaint(**r) for r in cur.fetchall()]


@router.get("/{complaint_id}", response_model=Complaint, responses=_NOT_FOUND)
def get_complaint(complaint_id: UUID, ctx: Org) -> Complaint:
    with ctx.tx() as cur:
        complaint = _one(cur, complaint_id)
    if complaint is None:
        raise HTTPException(404, "Complaint not found")
    return complaint


@router.patch("/{complaint_id}", response_model=Complaint, responses=_NOT_FOUND)
def update_complaint(complaint_id: UUID, body: ComplaintUpdate, ctx: Org) -> Complaint:
    """Change status, priority, category, title, note or assignee. `status=resolved` needs `resolution_note`."""
    values = body.model_dump(exclude_unset=True)
    with ctx.tx() as cur:
        if values:
            cur.execute(
                sql.SQL("UPDATE complaints SET {} WHERE id = {} RETURNING id").format(
                    sql.SQL(", ").join(
                        sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder(k)) for k in values
                    ),
                    sql.Placeholder("_id"),
                ),
                values | {"_id": complaint_id},
            )
            if cur.fetchone() is None:
                raise HTTPException(404, "Complaint not found")
        complaint = _one(cur, complaint_id)
    if complaint is None:
        raise HTTPException(404, "Complaint not found")
    return complaint
