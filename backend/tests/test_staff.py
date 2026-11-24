"""BE-13: staff management (add caretakers, assign buildings, deactivate)."""

import pytest
from conftest import as_user, rand_phone
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
PASSWORD = "s3cret-pass"


def _signup(org_name: str = "Meera PGs") -> dict:
    phone = rand_phone()
    r = client.post(
        "/api/v1/auth/signup",
        json={"phone": phone, "full_name": "Meera", "password": PASSWORD, "organization_name": org_name},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    org_id = body["me"]["memberships"][0]["org_id"]
    return {
        "phone": phone,
        "user_id": body["me"]["id"],
        "org_id": org_id,
        "h": {"Authorization": f"Bearer {body['access_token']}", "X-Org-Id": org_id},
    }


def _login(phone: str, org_id: str, password: str = PASSWORD):
    r = client.post("/api/v1/auth/login", json={"phone": phone, "password": password})
    if r.status_code != 200:
        return r
    return {"Authorization": f"Bearer {r.json()['access_token']}", "X-Org-Id": org_id}


@pytest.fixture
def owner() -> dict:
    o = _signup()
    o["a"] = client.post("/api/v1/properties", json={"name": "A"}, headers=o["h"]).json()["id"]
    o["b"] = client.post("/api/v1/properties", json={"name": "B"}, headers=o["h"]).json()["id"]
    return o


def _add(owner: dict, phone: str | None = None, **body):
    body = {
        "phone": phone or rand_phone(),
        "full_name": "Ravi",
        "password": "ravi-pass-1",
        "role": "caretaker",
        "property_ids": [owner["a"]],
    } | body
    return client.post("/api/v1/staff", json=body, headers=owner["h"])


def _names(headers) -> list[str]:
    r = client.get("/api/v1/properties", headers=headers)
    assert r.status_code == 200, r.text
    return [p["name"] for p in r.json()]


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-13", "AC1")
def test_added_caretaker_sees_only_assigned_property(owner):
    phone = rand_phone()
    r = _add(owner, phone)
    assert r.status_code == 201, r.text
    member = r.json()
    assert member["full_name"] == "Ravi" and member["phone"] == phone and member["role"] == "caretaker"
    assert member["assigned_property_ids"] == [owner["a"]] and member["is_active"] is True
    assert member["existing_account"] is False
    assert "password" not in str(member) and "hash" not in str(member)

    ct = _login(phone, owner["org_id"], "ravi-pass-1")
    assert _names(ct) == ["A"]

    staff = client.get("/api/v1/staff", headers=owner["h"]).json()
    assert {(s["user_id"], s["role"]) for s in staff} == {(owner["user_id"], "owner"), (member["user_id"], "caretaker")}
    assert all(set(s) == {"user_id", "full_name", "phone", "role", "assigned_property_ids", "is_active"} for s in staff)


def test_staff_endpoints_are_owner_only_and_validate_properties(owner):
    phone = rand_phone()
    _add(owner, phone)
    ct = _login(phone, owner["org_id"], "ravi-pass-1")
    assert client.get("/api/v1/staff", headers=ct).status_code == 403
    assert _add({**owner, "h": ct}).status_code == 403

    other = _signup("Other PGs")
    foreign = client.post("/api/v1/properties", json={"name": "Theirs"}, headers=other["h"]).json()["id"]
    assert _add(owner, property_ids=[foreign]).status_code == 422
    member = _add(owner).json()
    r = client.patch(
        f"/api/v1/staff/{member['user_id']}", json={"assigned_property_ids": [foreign]}, headers=owner["h"]
    )
    assert r.status_code == 422
    assert (
        client.patch(f"/api/v1/staff/{other['user_id']}", json={"is_active": False}, headers=owner["h"]).status_code
        == 404
    )


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-13", "AC2")
def test_reassignment_applies_on_next_request_without_new_login(owner):
    phone = rand_phone()
    member = _add(owner, phone).json()
    ct = _login(phone, owner["org_id"], "ravi-pass-1")
    assert _names(ct) == ["A"]

    r = client.patch(
        f"/api/v1/staff/{member['user_id']}", json={"assigned_property_ids": [owner["b"]]}, headers=owner["h"]
    )
    assert r.status_code == 200 and r.json()["assigned_property_ids"] == [owner["b"]]
    assert _names(ct) == ["B"]  # same token
    assert client.get(f"/api/v1/properties/{owner['a']}", headers=ct).status_code == 404

    r = client.patch(
        f"/api/v1/staff/{member['user_id']}",
        json={"assigned_property_ids": [owner["a"], owner["b"], owner["a"]]},
        headers=owner["h"],
    )
    assert r.json()["assigned_property_ids"] == [owner["a"], owner["b"]]
    assert _names(ct) == ["A", "B"]


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-13", "AC3")
def test_existing_account_gets_membership_and_keeps_password(owner):
    # Ravi already works for another owner, with his own password.
    first = _signup("Other PGs")
    first["a"] = client.post("/api/v1/properties", json={"name": "Elsewhere"}, headers=first["h"]).json()["id"]
    phone = rand_phone()
    _add(first, phone, full_name="Ravi Kumar", password="ravi-own-pass")

    r = _add(owner, phone, full_name="Typed By Owner", password="owner-chosen-pass")
    assert r.status_code == 201, r.text
    assert r.json()["existing_account"] is True
    assert r.json()["full_name"] == "Ravi Kumar"  # their account, unchanged

    assert _login(phone, owner["org_id"], "owner-chosen-pass").status_code == 401
    ct = _login(phone, owner["org_id"], "ravi-own-pass")
    assert _names(ct) == ["A"]
    me = client.get("/api/v1/me", headers=ct).json()
    assert {m["org_id"] for m in me["memberships"]} == {owner["org_id"], first["org_id"]}


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-13", "AC4")
def test_adding_existing_member_is_409(owner):
    phone = rand_phone()
    assert _add(owner, phone).status_code == 201
    r = _add(owner, phone, property_ids=[owner["b"]])
    assert r.status_code == 409
    assert r.json()["error"] == {"code": "duplicate", "message": "Already a member of this organization."}
    assert _add(owner, owner["phone"], role="owner").status_code == 409  # the owner themself


# ---- AC5 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-13", "AC5")
def test_owner_cannot_patch_own_membership(owner):
    for body in ({"is_active": False}, {"role": "caretaker"}, {"assigned_property_ids": []}):
        r = client.patch(f"/api/v1/staff/{owner['user_id']}", json=body, headers=owner["h"])
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert _names(owner["h"]) == ["A", "B"]


@pytest.mark.ac("BE-13", "AC5")
def test_db_blocks_owner_updating_own_membership(owner):
    with as_user(owner["user_id"], owner["org_id"]) as cur:
        cur.execute("UPDATE organization_members SET is_active = false WHERE user_id = %s", (owner["user_id"],))
        assert cur.rowcount == 0


def test_owner_can_promote_another_member(owner):
    member = _add(owner).json()
    r = client.patch(f"/api/v1/staff/{member['user_id']}", json={"role": "owner"}, headers=owner["h"])
    assert r.status_code == 200 and r.json()["role"] == "owner"


# ---- AC6 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-13", "AC6")
def test_deactivated_caretaker_gets_403_everywhere(owner):
    phone = rand_phone()
    member = _add(owner, phone).json()
    ct = _login(phone, owner["org_id"], "ravi-pass-1")
    assert _names(ct) == ["A"]

    r = client.patch(f"/api/v1/staff/{member['user_id']}", json={"is_active": False}, headers=owner["h"])
    assert r.status_code == 200 and r.json()["is_active"] is False

    a = owner["a"]
    calls = [
        ("GET", "/api/v1/properties", None),
        ("GET", f"/api/v1/properties/{a}", None),
        ("PATCH", f"/api/v1/properties/{a}", {"name": "X"}),
        ("POST", "/api/v1/properties", {"name": "X"}),
        ("POST", f"/api/v1/properties/{a}/upi-from-qr", {"qr_text": "upi://pay?pa=x@ybl"}),
        ("GET", f"/api/v1/properties/{a}/bed-board", None),
        ("POST", f"/api/v1/properties/{a}/rooms", {"label": "1", "sharing": 1, "is_ac": False, "base_rent_paise": 1}),
        ("GET", "/api/v1/staff", None),
    ]
    for method, url, body in calls:
        r = client.request(method, url, json=body, headers=ct)
        assert r.status_code == 403, (method, url, r.status_code)
        assert r.json()["error"]["code"] == "forbidden"

    # Reactivating restores access, still without a new login.
    client.patch(f"/api/v1/staff/{member['user_id']}", json={"is_active": True}, headers=owner["h"])
    assert _names(ct) == ["A"]
