"""BE-12: rooms, beds and the bed board."""

import pytest
from conftest import BASE_RENT, World, as_user, raises_sqlstate
from fastapi.testclient import TestClient

from app.main import app
from app.security import create_access_token

client = TestClient(app)
AREA_WARNING = "Below 70 sq ft per resident (GBA rule)"


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)  # assigned to prop_a
    world.ct_b_h = _h(world.caretaker_b, world.org)  # assigned to prop_b
    return world


def _room(w, prop=None, **body):
    body = {"label": "102", "sharing": 3, "is_ac": False, "base_rent_paise": 6_000_00} | body
    return client.post(f"/api/v1/properties/{prop or w.prop_a}/rooms", json=body, headers=w.owner_h)


def _board(w, headers=None, prop=None):
    r = client.get(f"/api/v1/properties/{prop or w.prop_a}/bed-board", headers=headers or w.owner_h)
    return r


def _board_bed(board: dict, bed_id) -> dict:
    return next(b for room in board["rooms"] for b in room["beds"] if b["id"] == str(bed_id))


def _check_in(w, bed) -> str:
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, rent_paise, check_in_date)
               VALUES (%s, %s, %s, %s, 'monthly', %s, app.today_ist()) RETURNING id""",
            (w.org, w.prop_a, w.resident_a, bed, BASE_RENT),
        )
        return cur.fetchone()["id"]


def _move_out(w, stay) -> None:
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE stays SET status = 'vacated', actual_vacate_date = app.today_ist() WHERE id = %s", (stay,))


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-12", "AC1")
def test_room_creates_one_bed_per_sharing(w):
    r = _room(w, label="102", sharing=3, base_rent_paise=6_000_00, floor=1, is_ac=True, area_sqft=300)
    assert r.status_code == 201, r.text
    room = r.json()
    assert (room["label"], room["sharing"], room["floor"], room["is_ac"], room["area_sqft"]) == ("102", 3, 1, True, 300)
    assert [(b["label"], b["base_rent_paise"], b["status"], b["is_active"]) for b in room["beds"]] == [
        ("102-A", 600000, "vacant", True),
        ("102-B", 600000, "vacant", True),
        ("102-C", 600000, "vacant", True),
    ]
    assert room["warning"] is None

    board_room = next(x for x in _board(w).json()["rooms"] if x["id"] == room["id"])
    assert [b["label"] for b in board_room["beds"]] == ["102-A", "102-B", "102-C"]


def test_add_bed_and_edit_room_and_bed(w):
    room = _room(w).json()
    r = client.post(
        f"/api/v1/rooms/{room['id']}/beds", json={"label": "102-D", "base_rent_paise": 5_500_00}, headers=w.owner_h
    )
    assert r.status_code == 201, r.text
    assert (r.json()["label"], r.json()["base_rent_paise"], r.json()["room_id"]) == ("102-D", 550000, room["id"])

    r = client.patch(f"/api/v1/rooms/{room['id']}", json={"label": "103", "floor": 2}, headers=w.owner_h)
    assert r.status_code == 200 and (r.json()["label"], r.json()["floor"], r.json()["sharing"]) == ("103", 2, 3)
    assert len(r.json()["beds"]) == 4

    bed = room["beds"][0]["id"]
    r = client.patch(f"/api/v1/beds/{bed}", json={"label": "103-A"}, headers=w.owner_h)
    assert r.status_code == 200 and r.json()["label"] == "103-A" and r.json()["base_rent_paise"] == 600000


def test_unknown_ids_are_404(w):
    zero = "00000000-0000-0000-0000-000000000000"
    assert _room(w, prop=zero).status_code == 404
    assert client.patch(f"/api/v1/rooms/{zero}", json={"floor": 1}, headers=w.owner_h).status_code == 404
    assert (
        client.post(f"/api/v1/rooms/{zero}/beds", json={"label": "X", "base_rent_paise": 1}, headers=w.owner_h)
    ).status_code == 404
    assert client.patch(f"/api/v1/beds/{zero}", json={"label": "X"}, headers=w.owner_h).status_code == 404
    assert _board(w, prop=zero).status_code == 404


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-12", "AC2")
def test_bed_board_follows_stays(w):
    bed = _board_bed(_board(w).json(), w.bed_a1)
    assert bed["status"] == "vacant" and bed["stay"] is None

    stay = _check_in(w, w.bed_a1)
    bed = _board_bed(_board(w).json(), w.bed_a1)
    assert bed["status"] == "occupied"
    assert bed["stay"]["id"] == str(stay)
    assert bed["stay"]["status"] == "active" and bed["stay"]["stay_type"] == "monthly"
    assert bed["stay"]["rent_paise"] == BASE_RENT
    assert bed["stay"]["resident"] == {"id": str(w.resident_a), "full_name": "Anika Rao"}
    assert _board_bed(_board(w).json(), w.bed_a2)["status"] == "vacant"

    _move_out(w, stay)
    bed = _board_bed(_board(w).json(), w.bed_a1)
    assert bed["status"] == "vacant" and bed["stay"] is None


def test_bed_board_lists_rooms_without_beds_and_never_shows_phones(w):
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "INSERT INTO rooms (org_id, property_id, label, sharing) VALUES (%s, %s, '900', 1)", (w.org, w.prop_a)
        )
    _check_in(w, w.bed_a1)
    board = _board(w).json()
    assert next(r for r in board["rooms"] if r["label"] == "900")["beds"] == []
    assert "phone" not in str(board)
    assert _board(w, prop=w.prop_b).json() == {"rooms": []}


def test_lowering_floor_price_keeps_existing_stay_rent(w):
    stay = _check_in(w, w.bed_a1)
    r = client.patch(f"/api/v1/beds/{w.bed_a1}", json={"base_rent_paise": 8_000_00}, headers=w.owner_h)
    assert r.status_code == 200 and r.json()["base_rent_paise"] == 800000
    bed = _board_bed(_board(w).json(), w.bed_a1)
    assert bed["stay"]["id"] == str(stay) and bed["stay"]["rent_paise"] == BASE_RENT


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-12", "AC3")
def test_no_endpoint_accepts_bed_status(w):
    room = _room(w).json()
    bed = room["beds"][0]["id"]
    r = client.patch(f"/api/v1/beds/{bed}", json={"status": "occupied"}, headers=w.owner_h)
    assert r.status_code == 422
    r = client.post(
        f"/api/v1/rooms/{room['id']}/beds",
        json={"label": "Z", "base_rent_paise": 1_00, "status": "occupied"},
        headers=w.owner_h,
    )
    assert r.status_code == 422
    r = _room(w, label="777", status="occupied")
    assert r.status_code == 422
    assert _board_bed(_board(w).json(), bed)["status"] == "vacant"

    # The request schemas don't even offer it, so the frontend can't send it.
    spec = client.get("/openapi.json").json()["components"]["schemas"]
    for name in ("RoomCreate", "RoomUpdate", "BedCreate", "BedUpdate"):
        assert "status" not in spec[name]["properties"], name


@pytest.mark.ac("BE-12", "AC3")
def test_db_rejects_direct_bed_status_change(w):
    with raises_sqlstate("PC003"), as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE beds SET status = 'occupied' WHERE id = %s", (w.bed_a1,))


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-12", "AC4")
def test_deactivating_bed_with_open_stay_is_422(w):
    stay = _check_in(w, w.bed_a1)
    r = client.patch(f"/api/v1/beds/{w.bed_a1}", json={"is_active": False}, headers=w.owner_h)
    assert r.status_code == 422
    assert r.json() == {"error": {"code": "invalid", "message": "Move the resident out first."}}
    assert _board_bed(_board(w).json(), w.bed_a1)["is_active"] is True

    _move_out(w, stay)
    r = client.patch(f"/api/v1/beds/{w.bed_a1}", json={"is_active": False}, headers=w.owner_h)
    assert r.status_code == 200 and r.json()["is_active"] is False


# ---- AC5 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-12", "AC5")
def test_duplicate_labels_are_409(w):
    room = _room(w, label="102").json()
    r = _room(w, label="102")
    assert r.status_code == 409
    assert r.json()["error"] == {
        "code": "duplicate",
        "message": "A room with this label already exists in this property.",
    }
    assert _room(w, label="102", prop=w.prop_b).status_code == 201  # same label, other building: fine

    r = client.post(
        f"/api/v1/rooms/{room['id']}/beds", json={"label": "102-A", "base_rent_paise": 1_00}, headers=w.owner_h
    )
    assert r.status_code == 409
    assert r.json()["error"]["message"] == "A bed with this label already exists in this room."

    other = _room(w, label="104").json()
    r = client.patch(f"/api/v1/rooms/{other['id']}", json={"label": "102"}, headers=w.owner_h)
    assert r.status_code == 409
    r = client.patch(f"/api/v1/beds/{room['beds'][1]['id']}", json={"label": "102-A"}, headers=w.owner_h)
    assert r.status_code == 409


# ---- AC6 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-12", "AC6")
def test_small_room_is_saved_with_area_warning(w):
    r = _room(w, label="105", sharing=3, area_sqft=200)  # 66.7 sq ft each
    assert r.status_code == 201 and r.json()["warning"] == AREA_WARNING
    assert len(r.json()["beds"]) == 3
    assert _room(w, label="106", sharing=3, area_sqft=210).json()["warning"] is None  # exactly 70 each

    room = _room(w, label="107", sharing=2, area_sqft=200).json()
    assert room["warning"] is None
    r = client.patch(f"/api/v1/rooms/{room['id']}", json={"area_sqft": 120}, headers=w.owner_h)
    assert r.status_code == 200 and r.json()["warning"] == AREA_WARNING
    r = client.patch(f"/api/v1/rooms/{room['id']}", json={"area_sqft": None}, headers=w.owner_h)
    assert r.status_code == 200 and r.json()["warning"] is None


# ---- AC7 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-12", "AC7")
def test_caretaker_reads_only_assigned_bed_board(w):
    r = _board(w, headers=w.ct_a_h)
    assert r.status_code == 200
    assert {b["id"] for room in r.json()["rooms"] for b in room["beds"]} == {str(w.bed_a1), str(w.bed_a2)}
    r = _board(w, headers=w.ct_b_h)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


@pytest.mark.ac("BE-12", "AC7")
def test_caretaker_create_and_update_are_403(w):
    h = w.ct_a_h
    room_id = _board(w).json()["rooms"][0]["id"]
    calls = [
        client.post(
            f"/api/v1/properties/{w.prop_a}/rooms",
            json={"label": "X", "sharing": 1, "is_ac": False, "base_rent_paise": 1_00},
            headers=h,
        ),
        client.patch(f"/api/v1/rooms/{room_id}", json={"label": "X"}, headers=h),
        client.post(f"/api/v1/rooms/{room_id}/beds", json={"label": "X", "base_rent_paise": 1_00}, headers=h),
        client.patch(f"/api/v1/beds/{w.bed_a1}", json={"base_rent_paise": 1_00}, headers=h),
        client.patch(f"/api/v1/beds/{w.bed_a1}", json={"is_active": False}, headers=h),
    ]
    for r in calls:
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", r.text
    bed = _board_bed(_board(w).json(), w.bed_a1)
    assert bed["base_rent_paise"] == BASE_RENT and bed["is_active"] is True


@pytest.mark.ac("BE-12", "AC7")
def test_caretaker_room_and_bed_writes_blocked_by_rls(w):
    """RLS is the real guard: the Python owner check only improves the message."""
    with raises_sqlstate("42501"), as_user(w.caretaker_a, w.org) as cur:
        cur.execute(
            "INSERT INTO rooms (org_id, property_id, label, sharing) VALUES (%s, %s, 'X', 1)", (w.org, w.prop_a)
        )
    with as_user(w.caretaker_a, w.org) as cur:
        cur.execute("UPDATE beds SET base_rent_paise = 100 WHERE id = %s", (w.bed_a1,))
        assert cur.rowcount == 0
        cur.execute("UPDATE rooms SET label = 'X' WHERE property_id = %s", (w.prop_a,))
        assert cur.rowcount == 0
