"""BE-21: POST /public/join/{qr_slug}, the write-only onboarding intake.

Object storage is replaced by a set of "uploaded" keys (`storage.object_exists` is patched), so these tests run
without S3. The real HEAD request is covered by test_uploads.py.
"""

from uuid import uuid4

import pytest
from conftest import World, api_client, as_user, rand_phone

from app import storage

uploaded: set[str] = set()


@pytest.fixture(autouse=True)
def fake_storage(monkeypatch):
    monkeypatch.setattr(storage, "object_exists", lambda key: (key in uploaded, None))


@pytest.fixture
def w(world: World):
    with as_user(world.owner, world.org) as cur:
        cur.execute("SELECT qr_slug FROM properties WHERE id = %s", (world.prop_a,))
        world.slug = cur.fetchone()["qr_slug"]
    return world


def _upload(property_id, ext="jpg") -> str:
    key = f"onboarding/{property_id}/{uuid4()}.{ext}"
    uploaded.add(key)
    return key


def _payload(w, **over) -> dict:
    return {
        "full_name": "Kiran M",
        "phone": rand_phone(),
        "email": "kiran@example.com",
        "date_of_birth": "2001-04-12",
        "permanent_address": "12 MG Road, Mysuru",
        "occupation": "working",
        "employer_or_college": "Infosys",
        "emergency_contact_name": "Lakshmi M",
        "emergency_contact_phone": "9876543210",
        "id_doc_type": "aadhaar",
        "id_doc_number": "1234 5678 9012",
        "id_doc_path": _upload(w.prop_a),
        "selfie_path": _upload(w.prop_a),
        "is_foreign_national": False,
        "accepted_rules": True,
        "accepted_exit_deduction_paise": 2_000_00,  # world: property A's exit deduction
    } | over


def _submit(w, client=None, slug=None, **over):
    return (client or api_client()).post(f"/api/v1/public/join/{slug or w.slug}", json=_payload(w, **over))


@pytest.mark.ac("BE-21", "AC1", "AC7")
def test_valid_submission_creates_pending_request_for_that_caretaker(w):
    body = _payload(w)
    r = api_client().post(f"/api/v1/public/join/{w.slug}", json=body)
    assert r.status_code == 201, r.text
    data = r.json()
    assert list(data) == ["request_id"]  # AC7: nothing personal echoed back
    for value in (body["full_name"], body["phone"], body["id_doc_number"], body["email"], body["id_doc_path"]):
        assert value not in r.text

    with as_user(w.caretaker_a, w.org) as cur:
        cur.execute(
            "SELECT status, phone, property_id, submitted_ip FROM onboarding_requests WHERE id = %s",
            (data["request_id"],),
        )
        row = cur.fetchone()
    assert row["status"] == "pending" and row["phone"] == body["phone"] and row["property_id"] == w.prop_a
    assert row["submitted_ip"] is not None
    with as_user(w.caretaker_b, w.org) as cur:  # other building's caretaker can't see it
        cur.execute("SELECT 1 FROM onboarding_requests WHERE id = %s", (data["request_id"],))
        assert cur.fetchone() is None


@pytest.mark.ac("BE-21", "AC2")
def test_unknown_slug_is_422_not_active(w):
    r = _submit(w, slug="no-such-slug")
    assert r.status_code == 422
    assert r.json()["error"]["message"] == "This QR code is not active"


@pytest.mark.ac("BE-21", "AC3")
def test_stale_exit_deduction_is_422(w):
    r = _submit(w, accepted_exit_deduction_paise=1_500_00)
    assert r.status_code == 422
    assert "exit deduction" in r.json()["error"]["message"].lower()


@pytest.mark.ac("BE-21", "AC4")
@pytest.mark.parametrize("missing", ["passport_number", "visa_number"])
def test_foreign_national_needs_passport_and_visa(w, missing):
    docs = {"passport_number": "Z1234567", "visa_number": "V998877", "visa_expiry": "2027-06-30"}
    docs.pop(missing)
    r = _submit(w, is_foreign_national=True, **docs)
    assert r.status_code == 422
    assert r.json()["error"]["message"] == "Foreign nationals must give their passport and visa numbers."
    # Blank counts as missing.
    r = _submit(w, is_foreign_national=True, **docs, **{missing: "  "})
    assert r.status_code == 422

    ok = _submit(w, is_foreign_national=True, passport_number="Z1234567", visa_number="V998877")
    assert ok.status_code == 201, ok.text


@pytest.mark.ac("BE-21", "AC5")
def test_photo_from_another_property_or_not_uploaded_is_422(w):
    other = _upload(w.prop_b)
    assert _submit(w, id_doc_path=other).status_code == 422
    assert _submit(w, selfie_path=other).status_code == 422
    # Right prefix, but never uploaded
    missing = f"onboarding/{w.prop_a}/{uuid4()}.jpg"
    r = _submit(w, selfie_path=missing)
    assert r.status_code == 422 and "upload" in r.json()["error"]["message"].lower()
    # Path tricks
    sneaky = f"onboarding/{w.prop_a}/../{w.prop_b}/x.jpg"
    uploaded.add(sneaky)
    assert _submit(w, id_doc_path=sneaky).status_code == 422
    with as_user(w.caretaker_a, w.org) as cur:
        cur.execute("SELECT count(*) AS n FROM onboarding_requests")
        assert cur.fetchone()["n"] == 0


@pytest.mark.ac("BE-21", "AC6")
def test_second_submission_from_same_phone_while_pending_is_422(w):
    phone = rand_phone()
    assert _submit(w, phone=phone).status_code == 201
    r = _submit(w, phone=phone)
    assert r.status_code == 422
    assert "already waiting for approval" in r.json()["error"]["message"]


@pytest.mark.ac("BE-21", "AC8")
def test_sixth_submission_from_one_ip_in_an_hour_is_429(w):
    client = api_client()  # one random IP for all six
    for _ in range(5):
        assert _submit(w, client=client).status_code == 201
    r = _submit(w, client=client)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited" and "Retry-After" in r.headers
    assert _submit(w).status_code == 201  # another IP is unaffected


@pytest.mark.ac("BE-21", "AC8")
def test_forwarded_for_is_used_only_when_configured(w, monkeypatch):
    from app.config import get_settings

    client = api_client()
    spoofed = {"X-Forwarded-For": f"10.9.{uuid4().int % 250}.1"}
    for _ in range(5):
        r = client.post(f"/api/v1/public/join/{w.slug}", json=_payload(w), headers=spoofed)
        assert r.status_code == 201
    # Off by default: changing the header doesn't escape the per-IP limit.
    other = {"X-Forwarded-For": "10.250.250.250"}
    assert client.post(f"/api/v1/public/join/{w.slug}", json=_payload(w), headers=other).status_code == 429

    # Behind our own proxy, the last X-Forwarded-For entry is the client.
    monkeypatch.setattr(get_settings(), "trust_forwarded_for", True)
    via_proxy = {"X-Forwarded-For": f"1.2.3.4, 10.{uuid4().int % 250}.{uuid4().int % 250}.7"}
    r = client.post(f"/api/v1/public/join/{w.slug}", json=_payload(w), headers=via_proxy)
    assert r.status_code == 201
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT host(submitted_ip) AS ip FROM onboarding_requests WHERE id = %s", (r.json()["request_id"],))
        assert cur.fetchone()["ip"] == via_proxy["X-Forwarded-For"].split(", ")[1]


def test_accepted_rules_must_be_true(w):
    assert _submit(w, accepted_rules=False).status_code == 422
