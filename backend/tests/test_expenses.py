"""BE-42: expenses (has bill / no bill), owner review. Threat #6 + lease rent hidden from caretakers."""

import time
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
from conftest import World, api_client, as_user, raises_sqlstate

from app import storage
from app.routers import expenses as expenses_router
from app.security import create_access_token

JPEG = b"\xff\xd8\xff\xe0" + b"2" * 1024
client = api_client()


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    storage.ensure_bucket()
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)  # assigned to prop_a
    world.ct_b_h = _h(world.caretaker_b, world.org)  # assigned to prop_b
    return world


def _upload(w, headers=None, prop=None, kind="expense_proof") -> str:
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
    t = r.json()
    assert httpx.put(t["upload_url"], content=JPEG, headers={"Content-Type": "image/jpeg"}).status_code == 200
    return t["object_key"]


def _today() -> date:
    return (datetime.now(UTC) + timedelta(hours=5, minutes=30)).date()  # IST, like app.today_ist()


def _body(w, **overrides) -> dict:
    body = {
        "property_id": str(w.prop_a),
        "category": "groceries",
        "amount_paise": 1_250_00,
        "expense_date": _today().isoformat(),
        "vendor_name": "Sri Lakshmi Stores",
        "bill_mode": "has_bill",
        "paid_from": "caretaker_cash",
    } | overrides
    if "proof_path" not in body:
        body["proof_path"] = _upload(w)
    return body


def _no_bill(w, **overrides) -> dict:
    return _body(
        w,
        **{
            "category": "water_tanker",
            "amount_paise": 2_400_00,
            "quantity": 2,
            "unit": "tanker",
            "bill_mode": "no_bill",
            "notes": "Two tankers, borewell dry since Monday",
            "proof_captured_at": datetime.now(UTC).isoformat(),
            "proof_lat": 12.9116,
            "proof_lng": 77.6474,
        }
        | overrides,
    )


def _create(w, body, headers=None):
    return client.post("/api/v1/expenses", json=body, headers=headers or w.ct_a_h)


def _list(w, headers=None, **params):
    r = client.get("/api/v1/expenses", params=params, headers=headers or w.owner_h)
    assert r.status_code == 200, r.text
    return r.json()


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-42", "AC1")
def test_has_bill_expense_is_created_by_the_caller(w):
    body = _body(w)
    r = _create(w, body)
    assert r.status_code == 201, r.text
    e = r.json()
    assert e["created_by"] == str(w.caretaker_a)
    assert (e["category"], e["amount_paise"], e["bill_mode"], e["paid_from"]) == (
        "groceries",
        125000,
        "has_bill",
        "caretaker_cash",
    )
    assert e["flagged_for_review"] is False and e["owner_only"] is False and e["proof_path"] == body["proof_path"]

    # The API won't take created_by at all...
    assert _create(w, _body(w, created_by=str(w.owner))).status_code == 422


@pytest.mark.ac("BE-42", "AC1")
def test_db_forces_created_by_to_the_caller(w):
    key = _upload(w)
    with as_user(w.caretaker_a, w.org) as cur:
        cur.execute(
            """INSERT INTO expenses (org_id, property_id, category, amount_paise, expense_date, bill_mode, proof_path,
                                     paid_from, created_by)
               VALUES (%s, %s, 'groceries', 100, app.today_ist(), 'has_bill', %s, 'caretaker_cash', %s)
               RETURNING created_by""",
            (w.org, w.prop_a, key, w.owner),
        )
        assert cur.fetchone()["created_by"] == w.caretaker_a


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-42", "AC2")
def test_no_bill_needs_note_and_gps(w):
    for missing in (
        {"proof_lat": None},
        {"proof_lng": None},
        {"proof_captured_at": None},
        {"notes": None},
        {"notes": "ok"},  # under 5 characters
    ):
        r = _create(w, _no_bill(w, **missing))
        assert r.status_code == 422, missing
        assert r.json()["error"]["code"] == "invalid"


@pytest.mark.ac("BE-42", "AC2")
def test_valid_no_bill_is_saved_and_flagged(w):
    r = _create(w, _no_bill(w))
    assert r.status_code == 201, r.text
    e = r.json()
    assert e["flagged_for_review"] is True
    assert (e["quantity"], e["unit"]) == (2.0, "tanker")
    assert (e["proof_lat"], e["proof_lng"]) == (12.9116, 77.6474)
    assert [x["id"] for x in _list(w, flagged="true")] == [e["id"]]

    # An owner's own no-bill expense isn't flagged for themselves to review.
    r = _create(w, _no_bill(w, paid_from="owner_direct", proof_path=_upload(w, headers=w.owner_h)), headers=w.owner_h)
    assert r.status_code == 201 and r.json()["flagged_for_review"] is False


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-42", "AC3")
def test_no_bill_photo_uploaded_too_long_ago_is_422(w, monkeypatch):
    # The storage clock decides. A 1-second window stands in for 15 minutes, so the test doesn't wait 15 minutes.
    monkeypatch.setattr(expenses_router, "LIVE_PHOTO_WINDOW", timedelta(seconds=1))
    key = _upload(w)
    time.sleep(2.5)
    r = _create(w, _no_bill(w, proof_path=key))  # the client claims "captured just now"
    assert r.status_code == 422
    assert r.json()["error"]["message"] == "No-bill photo must be taken and uploaded within the last 15 minutes."
    # The same old photo is fine for a has-bill expense (gallery uploads are allowed there).
    assert _create(w, _body(w, proof_path=key)).status_code == 201


@pytest.mark.ac("BE-42", "AC3")
def test_no_bill_photo_never_uploaded_is_422(w):
    key = f"org/{w.org}/{w.prop_a}/expense_proof/00000000-0000-4000-8000-000000000000.jpg"
    r = _create(w, _no_bill(w, proof_path=key))
    assert r.status_code == 422 and "uploaded" in r.json()["error"]["message"]


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-42", "AC4")
def test_proof_key_outside_the_expense_folder_is_422(w):
    real = _upload(w)
    name = real.rsplit("/", 1)[1]
    for bad in (
        _upload(w, headers=w.owner_h, prop=w.prop_b),  # another building
        _upload(w, kind="kyc_id"),  # another kind, same building
        f"onboarding/{w.prop_a}/{name}",
        f"org/{w.org}/{w.prop_a}/expense_proof/../kyc_id/{name}",
        real + ".jpg",
    ):
        for mode in (_body, _no_bill):
            r = _create(w, mode(w, proof_path=bad))
            assert r.status_code == 422, (mode.__name__, bad)
            assert r.json()["error"]["code"] == "invalid"


# ---- AC5 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-42", "AC5")
def test_caretaker_cannot_log_or_see_lease_rent(w):
    r = _create(w, _body(w, category="lease_rent", amount_paise=1_50_000_00))
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"

    lease = _create(
        w,
        _body(w, category="lease_rent", paid_from="owner_direct", proof_path=_upload(w, headers=w.owner_h)),
        headers=w.owner_h,
    )
    assert lease.status_code == 201 and lease.json()["owner_only"] is True
    groceries = _create(w, _body(w)).json()

    owner_ids = {e["id"] for e in _list(w)}
    assert {lease.json()["id"], groceries["id"]} <= owner_ids
    caretaker = _list(w, headers=w.ct_a_h)
    assert lease.json()["id"] not in {e["id"] for e in caretaker}
    assert all(e["category"] != "lease_rent" for e in caretaker)
    assert _list(w, headers=w.ct_a_h, category="lease_rent") == []


@pytest.mark.ac("BE-42", "AC5")
def test_caretaker_of_other_building_sees_nothing(w):
    _create(w, _body(w))
    assert _list(w, headers=w.ct_b_h) == []
    r = _create(w, _body(w, proof_path=_upload(w)), headers=w.ct_b_h)  # building A isn't theirs
    assert r.status_code == 404


# ---- AC6 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-42", "AC6")
def test_caretaker_owner_direct_or_old_date_is_403(w):
    r = _create(w, _body(w, paid_from="owner_direct"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    r = _create(w, _body(w, expense_date=(_today() - timedelta(days=4)).isoformat()))
    assert r.status_code == 403
    assert _create(w, _body(w, expense_date=(_today() - timedelta(days=3)).isoformat())).status_code == 201
    # The owner can record older expenses paid directly.
    old = _body(w, expense_date=(_today() - timedelta(days=20)).isoformat(), paid_from="owner_direct")
    old["proof_path"] = _upload(w, headers=w.owner_h)
    assert _create(w, old, headers=w.owner_h).status_code == 201


# ---- AC7 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-42", "AC7")
def test_owner_review_sets_reviewed_at_and_clears_flag(w):
    e = _create(w, _no_bill(w)).json()
    assert e["flagged_for_review"] is True

    r = client.post(f"/api/v1/expenses/{e['id']}/review", json={"note": "Checked"}, headers=w.ct_a_h)
    assert r.status_code == 403

    r = client.post(f"/api/v1/expenses/{e['id']}/review", json={"note": "Tanker vendor confirmed"}, headers=w.owner_h)
    assert r.status_code == 200, r.text
    reviewed = r.json()
    assert reviewed["flagged_for_review"] is False and reviewed["reviewed_at"] is not None
    assert reviewed["reviewed_by"] == str(w.owner) and reviewed["review_note"] == "Tanker vendor confirmed"
    assert _list(w, flagged="true") == []
    missing = client.post("/api/v1/expenses/00000000-0000-0000-0000-000000000000/review", json={}, headers=w.owner_h)
    assert missing.status_code == 404


def test_expense_details_are_immutable_even_for_the_owner(w):
    e = _create(w, _body(w)).json()
    with raises_sqlstate("PC001"), as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE expenses SET amount_paise = 1 WHERE id = %s", (e["id"],))


def test_list_filters(w):
    a = _create(w, _body(w, category="gas_lpg")).json()
    b = _create(w, _body(w, expense_date=(_today() - timedelta(days=2)).isoformat())).json()
    _create(
        w,
        _body(w, property_id=str(w.prop_b), paid_from="owner_direct", proof_path=_upload(w, w.owner_h, w.prop_b)),
        headers=w.owner_h,
    )
    assert [e["id"] for e in _list(w, property_id=str(w.prop_a), category="gas_lpg")] == [a["id"]]
    yesterday = (_today() - timedelta(days=1)).isoformat()
    assert [e["id"] for e in _list(w, property_id=str(w.prop_a), to=yesterday)] == [b["id"]]
    assert {e["id"] for e in _list(w, property_id=str(w.prop_a), **{"from": _today().isoformat()})} == {a["id"]}
