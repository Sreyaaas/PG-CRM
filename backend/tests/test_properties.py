"""BE-10: properties create / read / update, billing settings migration, public join info."""

import pytest
from conftest import as_user, raises_sqlstate, rand_phone
from fastapi.testclient import TestClient

from app.main import app
from app.security import hash_password

client = TestClient(app)
PASSWORD = "s3cret-pass"

FULL = {
    "name": "Sunrise HSR",
    "address": "12, 5th Cross, Sector 2",
    "locality": "HSR",
    "short_term_daily_rate_paise": 800_00,
    "exit_deduction_paise": 2_000_00,
    "house_rules": "Gate closes 11 PM.",
    "fallback_upi_id": "sunrise@okicici",
    "bank_details": "HDFC 50100012345678 IFSC HDFC0001234",
    "is_active": True,
    "rent_due_day": 7,
    "security_deposit_paise": 10_000_00,
    "maintenance_charge_paise": 1_500_00,
    "notice_deadline_day": 10,
}


def _login(phone: str) -> dict:
    r = client.post("/api/v1/auth/login", json={"phone": phone, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def org() -> dict:
    """An owner with two properties, and a caretaker assigned to the first one only."""
    phone = rand_phone()
    r = client.post(
        "/api/v1/auth/signup",
        json={"phone": phone, "full_name": "Meera", "password": PASSWORD, "organization_name": "Meera PGs"},
    )
    assert r.status_code == 201, r.text
    org_id = r.json()["me"]["memberships"][0]["org_id"]
    owner = {"Authorization": f"Bearer {r.json()['access_token']}", "X-Org-Id": org_id}

    a = client.post("/api/v1/properties", json={"name": "A"}, headers=owner).json()
    b = client.post("/api/v1/properties", json={"name": "B"}, headers=owner).json()

    ct_phone = rand_phone()
    with as_user(r.json()["me"]["id"], org_id) as cur:
        cur.execute(
            "SELECT api.add_staff_member(%s, 'Ravi', %s, 'caretaker', %s)",
            (ct_phone, hash_password(PASSWORD), [a["id"]]),
        )
    caretaker = _login(ct_phone) | {"X-Org-Id": org_id}
    return {"owner": owner, "caretaker": caretaker, "a": a, "b": b}


@pytest.mark.ac("BE-10", "AC1")
def test_owner_creates_property_with_every_field(org):
    r = client.post("/api/v1/properties", json=FULL, headers=org["owner"])
    assert r.status_code == 201, r.text
    p = r.json()
    for key, value in FULL.items():
        assert p[key] == value, key
    assert len(p["qr_slug"]) == 12
    assert p["upi_vpa"] is None and p["upi_payee_name"] is None and p["upi_mcc"] is None

    got = client.get(f"/api/v1/properties/{p['id']}", headers=org["owner"])
    assert got.status_code == 200 and got.json() == p


@pytest.mark.ac("BE-10", "AC1")
def test_create_rejects_read_only_fields_and_blank_name(org):
    r = client.post("/api/v1/properties", json={"name": "X", "qr_slug": "mine"}, headers=org["owner"])
    assert r.status_code == 422
    r = client.post("/api/v1/properties", json={"name": "   "}, headers=org["owner"])
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation"


@pytest.mark.ac("BE-10", "AC2")
def test_owner_patch_changes_only_fields_sent(org):
    created = client.post("/api/v1/properties", json=FULL, headers=org["owner"]).json()
    r = client.patch(
        f"/api/v1/properties/{created['id']}",
        json={"locality": "HSR Layout", "house_rules": None, "security_deposit_paise": 12_000_00},
        headers=org["owner"],
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    changed = {"locality": "HSR Layout", "house_rules": None, "security_deposit_paise": 12_000_00}
    for key, value in created.items():
        if key == "updated_at":
            continue
        assert updated[key] == changed.get(key, value), key
    assert updated["qr_slug"] == created["qr_slug"]

    # An empty patch changes nothing; null for a NOT NULL setting is rejected.
    assert client.patch(f"/api/v1/properties/{created['id']}", json={}, headers=org["owner"]).json() == updated
    r = client.patch(f"/api/v1/properties/{created['id']}", json={"rent_due_day": None}, headers=org["owner"])
    assert r.status_code == 422


@pytest.mark.ac("BE-10", "AC2")
def test_owner_deactivates_instead_of_delete(org):
    pid = org["b"]["id"]
    r = client.patch(f"/api/v1/properties/{pid}", json={"is_active": False}, headers=org["owner"])
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert client.delete(f"/api/v1/properties/{pid}", headers=org["owner"]).status_code == 405


@pytest.mark.ac("BE-10", "AC3")
def test_caretaker_cannot_create_or_update(org):
    r = client.post("/api/v1/properties", json={"name": "Mine"}, headers=org["caretaker"])
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    for pid in (org["a"]["id"], org["b"]["id"]):
        r = client.patch(f"/api/v1/properties/{pid}", json={"name": "Hacked"}, headers=org["caretaker"])
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert client.get(f"/api/v1/properties/{org['a']['id']}", headers=org["owner"]).json()["name"] == "A"


@pytest.mark.ac("BE-10", "AC3")
def test_caretaker_insert_and_update_blocked_by_rls_too(world):
    """The DB is the real guard, not the Python check."""
    with raises_sqlstate("42501"), as_user(world.caretaker_a, world.org) as cur:
        cur.execute("INSERT INTO properties (org_id, name) VALUES (%s, 'Mine')", (world.org,))
    with as_user(world.caretaker_a, world.org) as cur:
        cur.execute("UPDATE properties SET name = 'Hacked' WHERE id = %s", (world.prop_a,))
        assert cur.rowcount == 0


@pytest.mark.ac("BE-10", "AC4")
def test_caretaker_get_unassigned_property_is_404(org):
    r = client.get(f"/api/v1/properties/{org['b']['id']}", headers=org["caretaker"])
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    r = client.get(f"/api/v1/properties/{org['a']['id']}", headers=org["caretaker"])
    assert r.status_code == 200 and r.json()["name"] == "A"


@pytest.mark.ac("BE-10", "AC5")
@pytest.mark.parametrize("field", ["rent_due_day", "notice_deadline_day"])
@pytest.mark.parametrize("value", [0, 29, -1])
def test_day_settings_outside_1_to_28_are_422(org, field, value):
    r = client.post("/api/v1/properties", json={"name": "X", field: value}, headers=org["owner"])
    assert r.status_code == 422
    r = client.patch(f"/api/v1/properties/{org['a']['id']}", json={field: value}, headers=org["owner"])
    assert r.status_code == 422


@pytest.mark.ac("BE-10", "AC5")
def test_day_settings_default_to_5_and_are_independent(org):
    assert org["a"]["rent_due_day"] == 5 and org["a"]["notice_deadline_day"] == 5
    pid = org["a"]["id"]
    r = client.patch(f"/api/v1/properties/{pid}", json={"rent_due_day": 28}, headers=org["owner"])
    assert r.json()["rent_due_day"] == 28 and r.json()["notice_deadline_day"] == 5
    r = client.patch(f"/api/v1/properties/{pid}", json={"notice_deadline_day": 1}, headers=org["owner"])
    assert r.json()["rent_due_day"] == 28 and r.json()["notice_deadline_day"] == 1


@pytest.mark.ac("BE-10", "AC5")
def test_db_rejects_day_settings_outside_1_to_28(world):
    for col in ("rent_due_day", "notice_deadline_day"):
        with raises_sqlstate("23514"), as_user(world.owner, world.org) as cur:
            cur.execute(f"UPDATE properties SET {col} = 29 WHERE id = %s", (world.prop_a,))


@pytest.mark.ac("BE-10", "AC6")
def test_migration_drops_billing_day_and_adds_maintenance_charge(admin):
    cols = admin.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'stays' AND column_name = 'billing_day'"
    ).fetchall()
    assert cols == []
    kinds = admin.execute("SELECT unnest(enum_range(NULL::invoice_kind))::text AS k").fetchall()
    assert "maintenance_charge" in {r["k"] for r in kinds}


@pytest.mark.ac("BE-10", "AC7")
def test_public_join_info_shows_charges_and_notice_rule(org):
    created = client.post("/api/v1/properties", json=FULL, headers=org["owner"]).json()
    r = client.get(f"/api/v1/public/join/{created['qr_slug']}")
    assert r.status_code == 200, r.text
    info = r.json()
    assert info["rent_due_day"] == 7
    assert info["security_deposit_paise"] == 10_000_00
    assert info["maintenance_charge_paise"] == 1_500_00
    assert info["notice_deadline_day"] == 10
    # Public route never leaks owner bank details.
    assert "bank_details" not in info
