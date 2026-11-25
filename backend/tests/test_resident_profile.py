"""BE-25: resident profile fields (food preference, vehicle, emergency contact relation, police verification)."""

import httpx
import pytest
from conftest import World, api_client, as_user, raises_sqlstate, rand_phone
from test_onboarding_queue import DEPOSIT, MAINTENANCE, approve, submit

from app import storage
from app.security import create_access_token

client = api_client()
JPEG = b"\xff\xd8\xff\xe0" + b"5" * 512


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    storage.ensure_bucket()
    with as_user(world.owner, world.org) as cur:
        cur.execute(
            "UPDATE properties SET security_deposit_paise = %s, maintenance_charge_paise = %s WHERE id = %s "
            "RETURNING qr_slug, exit_deduction_paise",
            (DEPOSIT, MAINTENANCE, world.prop_a),
        )
        p = cur.fetchone()
    world.slug, world.exit_deduction = p["qr_slug"], p["exit_deduction_paise"]
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)  # assigned to prop_a
    world.ct_b_h = _h(world.caretaker_b, world.org)  # assigned to prop_b
    return world


def _upload(w, c, kind: str) -> str:
    r = c.post(
        f"/api/v1/public/join/{w.slug}/uploads",
        json={"kind": kind, "content_type": "image/jpeg", "size_bytes": len(JPEG)},
    )
    assert r.status_code == 200, r.text
    assert httpx.put(r.json()["upload_url"], content=JPEG, headers={"Content-Type": "image/jpeg"}).status_code == 200
    return r.json()["object_key"]


def _form(w, c, **extra) -> dict:
    return {
        "full_name": "Kiran M",
        "phone": rand_phone(),
        "permanent_address": "12 MG Road, Mysuru",
        "occupation": "working",
        "emergency_contact_name": "Lakshmi M",
        "emergency_contact_phone": "9876543210",
        "id_doc_type": "aadhaar",
        "id_doc_number": "1234 5678 9012",
        "id_doc_path": _upload(w, c, "kyc_id"),
        "selfie_path": _upload(w, c, "selfie"),
        "accepted_rules": True,
        "accepted_exit_deduction_paise": w.exit_deduction,
    } | extra


def _resident(w, headers=None) -> dict:
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT id FROM residents WHERE onboarding_request_id = %s", (w.req,))
        rid = cur.fetchone()["id"]
    r = client.get(f"/api/v1/residents/{rid}", headers=headers or w.owner_h)
    assert r.status_code == 200, r.text
    return r.json()


def _approved_resident(w, **fields) -> dict:
    w.req = submit(w, **fields)
    assert approve(w, w.owner_h).status_code == 201
    return _resident(w)


def _patch(w, rid, headers=None, **body):
    return client.patch(f"/api/v1/residents/{rid}/profile", json=body, headers=headers or w.ct_a_h)


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-25", "AC1")
def test_join_form_fields_are_saved_and_copied_to_the_resident(w):
    c = api_client()  # own IP for the public rate limits
    form = _form(w, c, food_preference="veg", vehicle_number="  KA01AB1234 ", emergency_contact_relation="Mother")
    r = c.post(f"/api/v1/public/join/{w.slug}", json=form)
    assert r.status_code == 201, r.text
    w.req = r.json()["request_id"]

    # The caretaker sees them while reviewing the request...
    detail = client.get(f"/api/v1/onboarding-requests/{w.req}", headers=w.ct_a_h)
    assert detail.status_code == 200, detail.text
    d = detail.json()
    assert (d["food_preference"], d["vehicle_number"], d["emergency_contact_relation"]) == (
        "veg",
        "KA01AB1234",
        "Mother",
    )

    # ...and approval copies them to the resident.
    assert approve(w, w.ct_a_h).status_code == 201, approve
    res = _resident(w)
    assert (res["food_preference"], res["vehicle_number"], res["emergency_contact_relation"]) == (
        "veg",
        "KA01AB1234",
        "Mother",
    )


@pytest.mark.ac("BE-25", "AC1")
def test_new_form_fields_are_optional_and_validated(w):
    c = api_client()
    for bad in ({"food_preference": "vegan"}, {"vehicle_number": "X" * 21}, {"emergency_contact_relation": "R" * 41}):
        r = c.post(f"/api/v1/public/join/{w.slug}", json=_form(w, c) | bad)
        assert r.status_code == 422, bad
    # Left out or blank: saved as nothing.
    r = c.post(f"/api/v1/public/join/{w.slug}", json=_form(w, c, vehicle_number="", emergency_contact_relation=""))
    assert r.status_code == 201, r.text
    w.req = r.json()["request_id"]
    assert approve(w, w.owner_h).status_code == 201
    res = _resident(w)
    assert (res["food_preference"], res["vehicle_number"], res["emergency_contact_relation"]) == (None, None, None)


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-25", "AC2")
def test_owner_and_property_caretaker_update_profile(w):
    res = _approved_resident(w, food_preference="egg")
    r = _patch(
        w,
        res["id"],
        vehicle_number="KA05MJ7788",
        police_verification_status="submitted",
        police_verification_date="2026-11-20",
    )
    assert r.status_code == 200, r.text
    after = r.json()
    assert (after["vehicle_number"], after["police_verification_status"], after["police_verification_date"]) == (
        "KA05MJ7788",
        "submitted",
        "2026-11-20",
    )
    assert after["food_preference"] == "egg"  # not sent, not changed
    assert after["full_name"] == res["full_name"] and after["current_stay"]["id"] == res["current_stay"]["id"]

    r = _patch(
        w,
        res["id"],
        headers=w.owner_h,
        police_verification_status="verified",
        police_verification_date="2026-11-24",
        food_preference=None,
    )
    assert r.status_code == 200 and r.json()["police_verification_status"] == "verified"
    assert r.json()["food_preference"] is None and r.json()["vehicle_number"] == "KA05MJ7788"


@pytest.mark.ac("BE-25", "AC2")
def test_caretaker_of_another_property_gets_404(w):
    res = _approved_resident(w)
    r = _patch(w, res["id"], headers=w.ct_b_h, vehicle_number="KA01ZZ0001")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert client.get(f"/api/v1/residents/{res['id']}", headers=w.ct_b_h).status_code == 404
    assert _resident(w)["vehicle_number"] is None
    unknown = _patch(w, "00000000-0000-0000-0000-000000000000", headers=w.owner_h, vehicle_number="X")
    assert unknown.status_code == 404


def test_profile_patch_rejects_other_fields(w):
    res = _approved_resident(w)
    for body in ({"phone": "9999999999"}, {"id_doc_number": "X"}, {"police_verification_status": None}):
        assert _patch(w, res["id"], headers=w.owner_h, **body).status_code == 422, body


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-25", "AC3")
@pytest.mark.parametrize("status", ["submitted", "verified"])
def test_police_status_needs_a_date(w, status):
    res = _approved_resident(w)
    r = _patch(w, res["id"], police_verification_status=status)
    assert r.status_code == 422
    assert r.json()["error"]["message"] == "Give the date the police verification was submitted or completed."
    assert _resident(w)["police_verification_status"] == "pending"


@pytest.mark.ac("BE-25", "AC3")
def test_db_enforces_police_date(w):
    res = _approved_resident(w)
    with raises_sqlstate("23514"), as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE residents SET police_verification_status = 'verified' WHERE id = %s", (res["id"],))
    # A date saved earlier counts; clearing it while verified does not.
    assert _patch(w, res["id"], police_verification_status="submitted", police_verification_date="2026-11-21").json()
    assert _patch(w, res["id"], police_verification_status="verified").status_code == 200
    assert _patch(w, res["id"], police_verification_date=None).status_code == 422


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-25", "AC4")
def test_get_resident_returns_new_fields_and_starts_pending(w):
    res = _approved_resident(
        w, food_preference="non_veg", vehicle_number="KA03HQ4521", emergency_contact_relation="Brother"
    )
    assert res["police_verification_status"] == "pending" and res["police_verification_date"] is None
    assert (res["food_preference"], res["vehicle_number"], res["emergency_contact_relation"]) == (
        "non_veg",
        "KA03HQ4521",
        "Brother",
    )
    assert _resident(w, headers=w.ct_a_h)["police_verification_status"] == "pending"  # caretaker of A sees it too
