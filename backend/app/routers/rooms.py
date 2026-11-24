"""Rooms, beds and the bed board.

Writes are owner only (RLS `rooms_*` / `beds_*` policies; `require_owner` just gives caretakers a clear 403).
`beds.status` is derived from stays by a trigger and is never accepted in a request.
"""

import string
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from psycopg import Cursor, sql
from psycopg.rows import DictRow

from app.deps import Org, require_owner
from app.errors import error_body
from app.schemas import (
    AREA_WARNING,
    Bed,
    BedBoard,
    BedCreate,
    BedUpdate,
    BoardBed,
    BoardResident,
    BoardRoom,
    BoardStay,
    Room,
    RoomCreate,
    RoomUpdate,
)

router = APIRouter(tags=["rooms"])

_NOT_FOUND = {404: {"description": "Not found"}}
_OWNER_ONLY = "Only the owner can change rooms and beds."
_ROOM_COLS = "id, property_id, label, floor, sharing, is_ac, area_sqft, created_at, updated_at"
_BED_COLS = "id, room_id, property_id, label, base_rent_paise, status, is_active, created_at, updated_at"


def _area_warning(area_sqft: int | None, sharing: int) -> str | None:
    """GBA rule: at least 70 sq ft per resident. Warn, don't block."""
    return AREA_WARNING if area_sqft is not None and area_sqft < 70 * sharing else None


def _room(cur: Cursor[DictRow], row: dict) -> Room:
    cur.execute(f"SELECT {_BED_COLS} FROM beds WHERE room_id = %s ORDER BY label", (row["id"],))
    beds = [Bed(**b) for b in cur.fetchall()]
    return Room(**row, beds=beds, warning=_area_warning(row["area_sqft"], row["sharing"]))


def _set_clause(values: dict) -> sql.Composed:
    return sql.SQL(", ").join(sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder(k)) for k in values)


@router.post("/properties/{property_id}/rooms", response_model=Room, status_code=201, responses=_NOT_FOUND)
def create_room(property_id: UUID, body: RoomCreate, ctx: Org) -> Room:
    """Owner only. Creates the room and its `sharing` beds in one transaction."""
    with ctx.tx() as cur:
        require_owner(cur, _OWNER_ONLY)
        cur.execute(
            f"""INSERT INTO rooms (org_id, property_id, label, floor, sharing, is_ac, area_sqft)
                SELECT org_id, id, %(label)s, %(floor)s, %(sharing)s, %(is_ac)s, %(area_sqft)s
                  FROM properties WHERE id = %(property_id)s
                RETURNING {_ROOM_COLS}""",
            body.model_dump() | {"property_id": property_id},
        )
        room = cur.fetchone()
        if room is None:
            raise HTTPException(404, "Property not found")
        for letter in string.ascii_uppercase[: body.sharing]:
            cur.execute(
                """INSERT INTO beds (org_id, property_id, room_id, label, base_rent_paise)
                   VALUES (%s, %s, %s, %s, %s)""",
                (ctx.org_id, property_id, room["id"], f"{body.label}-{letter}", body.base_rent_paise),
            )
        return _room(cur, room)


@router.patch("/rooms/{room_id}", response_model=Room, responses=_NOT_FOUND)
def update_room(room_id: UUID, body: RoomUpdate, ctx: Org) -> Room:
    """Owner only. Changes only the fields sent."""
    values = body.model_dump(exclude_unset=True)
    with ctx.tx() as cur:
        require_owner(cur, _OWNER_ONLY)
        if values:
            cur.execute(
                sql.SQL("UPDATE rooms SET {} WHERE id = {} RETURNING {}").format(
                    _set_clause(values), sql.Placeholder("_id"), sql.SQL(_ROOM_COLS)
                ),
                values | {"_id": room_id},
            )
        else:
            cur.execute(f"SELECT {_ROOM_COLS} FROM rooms WHERE id = %s", (room_id,))
        room = cur.fetchone()
        if room is None:
            raise HTTPException(404, "Room not found")
        return _room(cur, room)


@router.post("/rooms/{room_id}/beds", response_model=Bed, status_code=201, responses=_NOT_FOUND)
def add_bed(room_id: UUID, body: BedCreate, ctx: Org) -> Bed:
    """Owner only. Adds one bed to the room."""
    with ctx.tx() as cur:
        require_owner(cur, _OWNER_ONLY)
        cur.execute(
            f"""INSERT INTO beds (org_id, property_id, room_id, label, base_rent_paise)
                SELECT org_id, property_id, id, %s, %s FROM rooms WHERE id = %s
                RETURNING {_BED_COLS}""",
            (body.label, body.base_rent_paise, room_id),
        )
        bed = cur.fetchone()
    if bed is None:
        raise HTTPException(404, "Room not found")
    return Bed(**bed)


@router.patch("/beds/{bed_id}", response_model=Bed, responses=_NOT_FOUND)
def update_bed(bed_id: UUID, body: BedUpdate, ctx: Org) -> Bed | JSONResponse:
    """Owner only. Changes only the fields sent. Lowering `base_rent_paise` doesn't change existing stays."""
    values = body.model_dump(exclude_unset=True)
    with ctx.tx() as cur:
        require_owner(cur, _OWNER_ONLY)
        if values.get("is_active") is False:
            cur.execute("SELECT 1 FROM stays WHERE bed_id = %s AND status <> 'vacated'", (bed_id,))
            if cur.fetchone():
                return JSONResponse(status_code=422, content=error_body("invalid", "Move the resident out first."))
        if values:
            cur.execute(
                sql.SQL("UPDATE beds SET {} WHERE id = {} RETURNING {}").format(
                    _set_clause(values), sql.Placeholder("_id"), sql.SQL(_BED_COLS)
                ),
                values | {"_id": bed_id},
            )
        else:
            cur.execute(f"SELECT {_BED_COLS} FROM beds WHERE id = %s", (bed_id,))
        bed = cur.fetchone()
    if bed is None:
        raise HTTPException(404, "Bed not found")
    return Bed(**bed)


@router.get("/properties/{property_id}/bed-board", response_model=BedBoard, responses=_NOT_FOUND)
def bed_board(property_id: UUID, ctx: Org) -> BedBoard:
    """Owner, or a caretaker assigned to the property. Every room with its beds and each bed's open stay."""
    with ctx.tx() as cur:
        cur.execute(
            """SELECT r.id AS room_id, r.label AS room_label, r.floor, r.sharing, r.is_ac,
                      b.id AS bed_id, b.label AS bed_label, b.status AS bed_status, b.base_rent_paise,
                      b.is_active AS bed_is_active,
                      s.id AS stay_id, s.stay_type, s.status AS stay_status, s.rent_paise, s.check_in_date,
                      s.expected_vacate_date, res.id AS resident_id, res.full_name
                 FROM properties p
                 LEFT JOIN rooms r ON r.property_id = p.id
                 LEFT JOIN beds b ON b.room_id = r.id
                 LEFT JOIN stays s ON s.bed_id = b.id AND s.status <> 'vacated'
                 LEFT JOIN residents res ON res.id = s.resident_id
                WHERE p.id = %s
                ORDER BY r.floor NULLS LAST, r.label, b.label""",
            (property_id,),
        )
        rows = cur.fetchall()
    if not rows:
        raise HTTPException(404, "Property not found")

    rooms: dict[UUID, BoardRoom] = {}
    for r in rows:
        if r["room_id"] is None:
            continue  # property with no rooms yet
        room = rooms.get(r["room_id"])
        if room is None:
            room = rooms[r["room_id"]] = BoardRoom(
                id=r["room_id"],
                label=r["room_label"],
                floor=r["floor"],
                sharing=r["sharing"],
                is_ac=r["is_ac"],
                beds=[],
            )
        if r["bed_id"] is None:
            continue
        stay = None
        if r["stay_id"] is not None:
            stay = BoardStay(
                id=r["stay_id"],
                stay_type=r["stay_type"],
                status=r["stay_status"],
                rent_paise=r["rent_paise"],
                check_in_date=r["check_in_date"],
                expected_vacate_date=r["expected_vacate_date"],
                resident=BoardResident(id=r["resident_id"], full_name=r["full_name"]),
            )
        room.beds.append(
            BoardBed(
                id=r["bed_id"],
                label=r["bed_label"],
                status=r["bed_status"],
                base_rent_paise=r["base_rent_paise"],
                is_active=r["bed_is_active"],
                stay=stay,
            )
        )
    return BedBoard(rooms=list(rooms.values()))
