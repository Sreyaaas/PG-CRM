"""BE-26: complaints / maintenance tickets."""

import httpx
import pytest
from conftest import World, api_client, as_user

from app import storage
from app.security import create_access_token

JPEG = b"\xff\xd8\xff\xe0" + b"3" * 512
client = api_client()


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    storage.ensure_bucket()
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)  # assigned to prop_a
    world.ct_b_h = _h(world.caretaker_b, world.org)  # assigned to prop_b
    with as_user(world.owner, world.org) as cur:
        cur.execute("SELECT room_id FROM beds WHERE id = %s", (world.bed_a1,))
        world.room_a = cur.fetchone()["room_id"]
    return world


def _create(w, headers=None, **body):
    body = {"property_id": str(w.prop_a), "category": "wifi", "title": "Wi-Fi down on 1st floor"} | body
    return client.post("/api/v1/complaints", json=body, headers=headers or w.ct_a_h)


def _patch(w, cid, headers=None, **body):
    return client.patch(f"/api/v1/complaints/{cid}", json=body, headers=headers or w.ct_a_h)


def _list(w, headers=None, **params):
    r = client.get("/api/v1/complaints", params=params, headers=headers or w.owner_h)
    assert r.status_code == 200, r.text
    return r.json()


def _photo(w, prop=None, kind="complaint_photo", headers=None) -> str:
    r = client.post(
        "/api/v1/uploads",
        json={
            "kind": kind,
            "property_id": str(prop or w.prop_a),
            "content_type": "image/jpeg",
            "size_bytes": len(JPEG),
        },
        headers=headers or w.ct_a_h,
    )
    assert r.status_code == 200, r.text
    assert httpx.put(r.json()["upload_url"], content=JPEG, headers={"Content-Type": "image/jpeg"}).status_code == 200
    return r.json()["object_key"]


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-26", "AC1")
def test_caretaker_creates_open_complaint(w):
    r = _create(
        w,
        room_id=str(w.room_a),
        bed_id=str(w.bed_a1),
        resident_id=str(w.resident_a),
        category="ac",
        title="  AC not cooling  ",
        note="Since last night",
        priority="urgent",
    )
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["status"] == "open" and c["created_by"] == str(w.caretaker_a) and c["created_by_name"] == "Ravi"
    assert (c["title"], c["priority"], c["category"]) == ("AC not cooling", "urgent", "ac")
    assert (c["property_name"], c["room_label"], c["bed_label"], c["resident_name"]) == (
        "Sunrise HSR",
        "101",
        "101-A",
        "Anika Rao",
    )
    assert c["resolved_at"] is None
    assert client.get(f"/api/v1/complaints/{c['id']}", headers=w.owner_h).json() == c

    # Defaults, and fields the caller can't set.
    minimal = _create(w).json()
    assert minimal["priority"] == "normal" and minimal["status"] == "open"
    assert _create(w, status="resolved").status_code == 422
    assert _create(w, created_by=str(w.owner)).status_code == 422


def test_create_validation(w):
    assert _create(w, title="   ").status_code == 422
    assert _create(w, category="noise").status_code == 422
    assert _create(w, headers=w.ct_b_h).status_code == 404  # building A isn't theirs


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-26", "AC2")
def test_caretakers_see_only_their_buildings_and_filters_work(w):
    a1 = _create(w, priority="urgent").json()
    a2 = _create(w, category="water", title="No water, 2nd floor").json()
    b1 = _create(w, headers=w.owner_h, property_id=str(w.prop_b), category="food", title="Dinner cold").json()
    _patch(w, a2["id"], status="in_progress")

    assert {c["id"] for c in _list(w, headers=w.ct_a_h)} == {a1["id"], a2["id"]}
    assert [c["id"] for c in _list(w, headers=w.ct_b_h)] == [b1["id"]]
    assert client.get(f"/api/v1/complaints/{a1['id']}", headers=w.ct_b_h).status_code == 404
    assert _patch(w, a1["id"], headers=w.ct_b_h, priority="low").status_code == 404

    assert {c["id"] for c in _list(w)} == {a1["id"], a2["id"], b1["id"]}
    assert [c["id"] for c in _list(w, property_id=str(w.prop_b))] == [b1["id"]]
    assert [c["id"] for c in _list(w, status="in_progress")] == [a2["id"]]
    assert [c["id"] for c in _list(w, priority="urgent")] == [a1["id"]]
    assert [c["id"] for c in _list(w, category="food")] == [b1["id"]]
    assert [c["id"] for c in _list(w, property_id=str(w.prop_a))] == [a2["id"], a1["id"]]  # newest first


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-26", "AC3")
def test_resolve_needs_note_and_records_who_and_when(w):
    c = _create(w).json()
    r = _patch(w, c["id"], status="resolved")
    assert r.status_code == 422 and r.json()["error"]["message"] == "Say how the complaint was resolved"

    r = _patch(w, c["id"], status="resolved", resolution_note="Router restarted, ISP ticket closed")
    assert r.status_code == 200, r.text
    done = r.json()
    assert done["status"] == "resolved" and done["resolved_by"] == str(w.caretaker_a)
    assert done["resolved_at"] is not None and done["resolution_note"] == "Router restarted, ISP ticket closed"

    # Editing other fields later keeps who resolved it and when.
    later = _patch(w, c["id"], headers=w.owner_h, priority="low").json()
    assert (later["resolved_by"], later["resolved_at"]) == (done["resolved_by"], done["resolved_at"])

    reopened = _patch(w, c["id"], headers=w.owner_h, status="open").json()
    assert reopened["status"] == "open"
    assert reopened["resolved_by"] is None and reopened["resolved_at"] is None and reopened["resolution_note"] is None


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-26", "AC4")
def test_room_bed_or_resident_from_another_building_is_422(w):
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "INSERT INTO rooms (org_id, property_id, label, sharing) VALUES (%s, %s, 'B1', 1) RETURNING id",
            (w.org, w.prop_b),
        )
        room_b = cur.fetchone()["id"]
        cur.execute(
            """INSERT INTO beds (org_id, property_id, room_id, label, base_rent_paise)
               VALUES (%s, %s, %s, 'B1-A', 500000) RETURNING id""",
            (w.org, w.prop_b, room_b),
        )
        bed_b = cur.fetchone()["id"]
    for field, value, msg in (
        ("room_id", room_b, "That room isn't in this building."),
        ("bed_id", bed_b, "That bed isn't in this building."),
    ):
        r = _create(w, headers=w.owner_h, **{field: str(value)})
        assert r.status_code == 422 and r.json()["error"]["message"] == msg
    r = _create(w, headers=w.owner_h, property_id=str(w.prop_b), resident_id=str(w.resident_a))
    assert r.status_code == 422 and r.json()["error"]["message"] == "That resident isn't in this building."


# ---- AC5 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-26", "AC5")
def test_photo_must_be_this_buildings_complaint_upload(w):
    good = _photo(w)
    name = good.rsplit("/", 1)[1]
    for bad in (
        _photo(w, prop=w.prop_b, headers=w.owner_h),  # another building
        _photo(w, kind="expense_proof"),  # another kind
        f"org/{w.org}/{w.prop_a}/complaint_photo/00000000-0000-4000-8000-000000000000.jpg",  # never uploaded
        f"org/{w.org}/{w.prop_a}/complaint_photo/../selfie/{name}",
    ):
        r = _create(w, photo_path=bad)
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid", bad

    c = _create(w, photo_path=good).json()
    assert c["photo_path"] == good
    for headers in (w.ct_a_h, w.owner_h):
        link = client.get("/api/v1/files/url", params={"key": good}, headers=headers)
        assert link.status_code == 200 and httpx.get(link.json()["url"]).content == JPEG
    assert client.get("/api/v1/files/url", params={"key": good}, headers=w.ct_b_h).status_code == 404


# ---- AC6 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-26", "AC6")
def test_no_delete_endpoint(w):
    c = _create(w).json()
    assert client.delete(f"/api/v1/complaints/{c['id']}", headers=w.owner_h).status_code == 405
    assert client.get(f"/api/v1/complaints/{c['id']}", headers=w.owner_h).status_code == 200


# ---- AC7 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-26", "AC7")
def test_assignee_must_be_an_active_member(w, admin):
    c = _create(w, assigned_to=str(w.caretaker_a)).json()
    assert (c["assigned_to"], c["assigned_to_name"]) == (str(w.caretaker_a), "Ravi")

    msg = "Assignee must be an active member of this organization"
    outsider = admin.execute(
        "SELECT id FROM users WHERE id <> ALL(%s) LIMIT 1", ([w.owner, w.caretaker_a, w.caretaker_b],)
    )
    outsider_id = outsider.fetchone()["id"]
    r = _create(w, assigned_to=str(outsider_id))
    assert r.status_code == 422 and r.json()["error"]["message"] == msg

    admin.execute(
        "UPDATE organization_members SET is_active = false WHERE user_id = %s AND org_id = %s", (w.caretaker_b, w.org)
    )
    r = _patch(w, c["id"], headers=w.owner_h, assigned_to=str(w.caretaker_b))
    assert r.status_code == 422 and r.json()["error"]["message"] == msg
    assert _patch(w, c["id"], headers=w.owner_h, assigned_to=None).json()["assigned_to"] is None
