"""BE-23: discount requests (threat #3, fake discounts).

The check-in endpoint is BE-22, so check-in here is a direct `INSERT INTO stays` as the caretaker, through the
same RLS-bound role and guard triggers the API uses. `_http` then shows the status the API's error handler turns
that database error into.
"""

import json

import psycopg
import pytest
from conftest import BASE_RENT, World, as_user, raises_sqlstate
from fastapi.testclient import TestClient

from app.errors import _db_error
from app.main import app
from app.security import create_access_token

client = TestClient(app)
DISCOUNTED = 9_000_00


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)  # assigned to prop_a (beds a1, a2)
    world.ct_b_h = _h(world.caretaker_b, world.org)  # assigned to prop_b
    return world


def _request(w, headers=None, **body):
    body = {
        "bed_id": str(w.bed_a1),
        "resident_id": str(w.resident_a),
        "requested_rent_paise": DISCOUNTED,
        "reason": "Paying 6 months upfront",
    } | body
    return client.post("/api/v1/discount-requests", json=body, headers=headers or w.ct_a_h)


def _decide(w, request_id, decision="approved", headers=None, note=None):
    return client.post(
        f"/api/v1/discount-requests/{request_id}/decide",
        json={"decision": decision, "note": note},
        headers=headers or w.owner_h,
    )


def _check_in(w, user, rent, discount_request_id=None):
    with as_user(user, w.org) as cur:
        cur.execute(
            """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, rent_paise, check_in_date,
                                  discount_request_id)
               VALUES (%s, %s, %s, %s, 'monthly', %s, app.today_ist(), %s) RETURNING id""",
            (w.org, w.prop_a, w.resident_a, w.bed_a1, rent, discount_request_id),
        )
        return cur.fetchone()["id"]


def _http(exc: psycopg.Error) -> tuple[int, dict]:
    """What the API returns for this database error."""
    response = _db_error(None, exc)
    return response.status_code, json.loads(response.body)


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-23", "AC1")
def test_caretaker_creates_pending_request(w):
    r = _request(w)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["status"] == "pending"
    assert d["requested_by"] == str(w.caretaker_a) and d["requested_by_name"] == "Ravi"
    assert (d["bed_id"], d["bed_label"], d["property_name"]) == (str(w.bed_a1), "101-A", "Sunrise HSR")
    assert (d["resident_id"], d["resident_name"]) == (str(w.resident_a), "Anika Rao")
    assert d["decided_by"] is None and d["decided_at"] is None

    # Resident is optional: the request often comes before the resident exists.
    r = _request(w, resident_id=None, bed_id=str(w.bed_a2))
    assert r.status_code == 201 and r.json()["resident_id"] is None


@pytest.mark.ac("BE-23", "AC1")
def test_requested_by_and_status_are_forced_by_db(w):
    with as_user(w.caretaker_a, w.org) as cur:
        cur.execute(
            """INSERT INTO discount_requests (org_id, property_id, bed_id, requested_rent_paise, reason,
                                              requested_by, status)
               VALUES (%s, %s, %s, %s, 'forged', %s, 'approved') RETURNING requested_by, status""",
            (w.org, w.prop_a, w.bed_a1, DISCOUNTED, w.owner),
        )
        row = cur.fetchone()
    assert row["requested_by"] == w.caretaker_a and row["status"] == "pending"
    # And the API doesn't even accept those fields.
    assert _request(w, status="approved").status_code == 422
    assert _request(w, requested_by=str(w.owner)).status_code == 422


def test_create_validation_and_access(w):
    assert _request(w, reason="ok").status_code == 422  # min 3 after trimming
    assert _request(w, requested_rent_paise=0).status_code == 422
    assert _request(w, headers=w.ct_b_h).status_code == 404  # bed in a building they can't see
    assert _request(w, bed_id="00000000-0000-0000-0000-000000000000").status_code == 404


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-23", "AC2")
def test_caretaker_cannot_decide(w):
    req = _request(w).json()
    for decision in ("approved", "rejected"):
        r = _decide(w, req["id"], decision, headers=w.ct_a_h)
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert client.get("/api/v1/discount-requests?status=pending", headers=w.owner_h).json()[0]["status"] == "pending"


@pytest.mark.ac("BE-23", "AC2")
def test_db_blocks_caretaker_decision(w):
    req = _request(w).json()
    with raises_sqlstate("PC002"), as_user(w.caretaker_a, w.org) as cur:
        cur.execute("UPDATE discount_requests SET status = 'approved' WHERE id = %s", (req["id"],))


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-23", "AC3")
def test_approved_discount_allows_exactly_that_rent(w):
    req = _request(w).json()

    # Not approved yet -> blocked.
    with pytest.raises(psycopg.Error) as exc:
        _check_in(w, w.caretaker_a, DISCOUNTED, req["id"])
    assert _http(exc.value)[0] == 403

    r = _decide(w, req["id"], "approved", note="OK, 6 months upfront")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved" and r.json()["decided_by"] == str(w.owner)
    assert r.json()["decision_note"] == "OK, 6 months upfront" and r.json()["decided_at"] is not None

    # Any other rent with that approval -> 403.
    for rent in (DISCOUNTED - 1_00, 8_000_00):
        with pytest.raises(psycopg.Error) as exc:
            _check_in(w, w.caretaker_a, rent, req["id"])
        status, body = _http(exc.value)
        assert status == 403 and body["error"]["code"] == "forbidden"

    # Without the approval -> 403.
    with pytest.raises(psycopg.Error) as exc:
        _check_in(w, w.caretaker_a, DISCOUNTED)
    assert _http(exc.value)[0] == 403

    # Exactly the approved rent -> succeeds.
    stay = _check_in(w, w.caretaker_a, DISCOUNTED, req["id"])
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT rent_paise, discount_request_id FROM stays WHERE id = %s", (stay,))
        row = cur.fetchone()
    assert (row["rent_paise"], str(row["discount_request_id"])) == (DISCOUNTED, req["id"])


@pytest.mark.ac("BE-23", "AC3")
def test_rejected_discount_cannot_be_used(w):
    req = _request(w).json()
    assert _decide(w, req["id"], "rejected").json()["status"] == "rejected"
    with pytest.raises(psycopg.Error) as exc:
        _check_in(w, w.caretaker_a, DISCOUNTED, req["id"])
    assert _http(exc.value)[0] == 403


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-23", "AC4")
def test_approved_discount_works_for_one_stay_only(w):
    req = _request(w).json()
    _decide(w, req["id"])
    first = _check_in(w, w.caretaker_a, DISCOUNTED, req["id"])
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE stays SET status = 'vacated', actual_vacate_date = app.today_ist() WHERE id = %s", (first,))

    with pytest.raises(psycopg.Error) as exc:
        _check_in(w, w.caretaker_a, DISCOUNTED, req["id"])
    assert exc.value.sqlstate == "23505"
    status, body = _http(exc.value)
    assert status == 409
    assert body["error"] == {"code": "duplicate", "message": "This discount has already been used for another stay."}


# ---- AC5 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-23", "AC5")
def test_deciding_twice_is_409(w):
    req = _request(w).json()
    assert _decide(w, req["id"], "approved").status_code == 200
    for decision in ("rejected", "approved"):
        r = _decide(w, req["id"], decision)
        assert r.status_code == 409 and r.json()["error"]["code"] == "append_only"
    listed = client.get("/api/v1/discount-requests", headers=w.owner_h).json()
    assert next(d for d in listed if d["id"] == req["id"])["status"] == "approved"


def test_decide_unknown_request_is_404(w):
    assert _decide(w, "00000000-0000-0000-0000-000000000000").status_code == 404


# ---- AC6 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-23", "AC6")
def test_pending_list_shows_base_requested_and_difference(w):
    pending = _request(w).json()
    done = _request(w, bed_id=str(w.bed_a2), requested_rent_paise=9_500_00).json()
    _decide(w, done["id"], "rejected")

    r = client.get("/api/v1/discount-requests?status=pending", headers=w.owner_h)
    assert r.status_code == 200
    assert [d["id"] for d in r.json()] == [pending["id"]]
    d = r.json()[0]
    assert d["base_rent_paise"] == BASE_RENT
    assert d["requested_rent_paise"] == DISCOUNTED
    assert d["difference_paise"] == BASE_RENT - DISCOUNTED == 1_000_00
    assert (d["bed_label"], d["property_name"], d["requested_by_name"]) == ("101-A", "Sunrise HSR", "Ravi")
    assert d["reason"] == "Paying 6 months upfront" and d["created_at"]

    statuses = {d["id"]: d["status"] for d in client.get("/api/v1/discount-requests", headers=w.owner_h).json()}
    assert statuses == {pending["id"]: "pending", done["id"]: "rejected"}
    assert client.get("/api/v1/discount-requests?status=bogus", headers=w.owner_h).status_code == 422


def test_caretaker_lists_only_own_buildings(w):
    _request(w)
    assert len(client.get("/api/v1/discount-requests", headers=w.ct_a_h).json()) == 1
    assert client.get("/api/v1/discount-requests", headers=w.ct_b_h).json() == []
