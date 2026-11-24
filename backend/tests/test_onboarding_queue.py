"""BE-22: onboarding queue. Approve = resident + stay + joining invoices in one transaction; reject with a note."""

import json
from datetime import date, timedelta
from uuid import uuid4

import pytest
from conftest import BASE_RENT, World, api_client, as_user, rand_phone

from app import billing
from app.security import create_access_token

client = api_client()
DEPOSIT = 5_000_00
MAINTENANCE = 1_000_00
DAILY = 800_00  # world: property A's short-term daily rate


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


def submit(w: World, prop=None, **over) -> str:
    """A pending QR submission, through the same DB function the public route uses."""
    prop = prop or w.prop_a
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT qr_slug, exit_deduction_paise FROM properties WHERE id = %s", (prop,))
        p = cur.fetchone()
    payload = {
        "full_name": "Kiran M",
        "phone": rand_phone(),
        "email": "kiran@example.com",
        "permanent_address": "12 MG Road, Mysuru",
        "occupation": "working",
        "employer_or_college": "Infosys",
        "emergency_contact_name": "Lakshmi M",
        "emergency_contact_phone": "9876543210",
        "id_doc_type": "aadhaar",
        "id_doc_number": "1234 5678 9012",
        "id_doc_path": f"onboarding/{prop}/{uuid4()}.jpg",
        "selfie_path": f"onboarding/{prop}/{uuid4()}.jpg",
        "accepted_rules": True,
        "accepted_exit_deduction_paise": p["exit_deduction_paise"],
    } | over
    with as_user(None) as cur:
        cur.execute("SELECT api.public_submit_onboarding(%s, %s::jsonb) AS id", (p["qr_slug"], json.dumps(payload)))
        return str(cur.fetchone()["id"])


def today(w: World) -> date:
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT app.today_ist() AS d")
        return cur.fetchone()["d"]


@pytest.fixture
def w(world: World):
    with as_user(world.owner, world.org) as cur:
        cur.execute(
            "UPDATE properties SET security_deposit_paise = %s, maintenance_charge_paise = %s WHERE id = %s",
            (DEPOSIT, MAINTENANCE, world.prop_a),
        )
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)
    world.ct_b_h = _h(world.caretaker_b, world.org)
    world.req = submit(world)
    return world


def approve(w, headers, request_id=None, **over):
    body = {
        "bed_id": str(w.bed_a1),
        "stay_type": "monthly",
        "rent_paise": BASE_RENT,
        "deposit_paise": DEPOSIT,
        "maintenance_charge_paise": MAINTENANCE,
        "check_in_date": today(w).isoformat(),
    } | over
    return client.post(f"/api/v1/onboarding-requests/{request_id or w.req}/approve", json=body, headers=headers)


def invoices(w, stay_id) -> dict[str, dict]:
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "SELECT id, kind::text, amount_paise, due_date, period_start, period_end FROM invoices WHERE stay_id = %s",
            (stay_id,),
        )
        return {r["kind"]: r for r in cur.fetchall()}


def request_status(w, request_id=None) -> str:
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT status::text FROM onboarding_requests WHERE id = %s", (request_id or w.req,))
        return cur.fetchone()["status"]


def resident_count(w) -> int:
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT count(*) AS n FROM residents WHERE onboarding_request_id = %s", (w.req,))
        return cur.fetchone()["n"]


# ---- billing formulas ---------------------------------------------------------------------------------


@pytest.mark.ac("BE-22", "AC1", "AC2", "AC3")
def test_billing_formulas():
    assert billing.first_month_rent(10_500_00, date(2026, 11, 18)) == 4_550_00
    assert billing.first_month_rent(10_500_00, date(2026, 11, 1)) == 10_500_00
    assert billing.first_month_rent(10_000_00, date(2026, 2, 28)) == round(10_000 / 28) * 100  # 1 of 28 days
    assert billing.first_month_rent(9_999_00, date(2026, 12, 31)) == 323_00  # 322.55 -> 323
    assert billing.month_end(date(2028, 2, 3)) == date(2028, 2, 29)
    assert billing.short_term_amount(DAILY, date(2026, 11, 18), date(2026, 11, 21)) == 3 * DAILY
    assert billing.short_term_amount(DAILY, date(2026, 11, 18), date(2026, 11, 18)) == DAILY  # minimum 1 night


# ---- list + detail ----------------------------------------------------------------------------------


@pytest.mark.ac("BE-22", "AC8")
def test_list_and_detail_scoped_to_property(w):
    other = submit(w, prop=w.prop_b)
    r = client.get("/api/v1/onboarding-requests?status=pending", headers=w.ct_a_h)
    assert r.status_code == 200
    assert [x["id"] for x in r.json()] == [w.req]
    assert set(r.json()[0]) == {
        "id", "full_name", "phone", "occupation", "employer_or_college", "is_foreign_national", "created_at",
    }  # fmt: skip
    r = client.get(f"/api/v1/onboarding-requests?property_id={w.prop_b}", headers=w.owner_h)
    assert [x["id"] for x in r.json()] == [other]

    assert client.get(f"/api/v1/onboarding-requests/{w.req}", headers=w.ct_b_h).status_code == 404
    assert approve(w, w.ct_b_h).status_code == 404
    assert (
        client.post(f"/api/v1/onboarding-requests/{w.req}/reject", json={"note": "x"}, headers=w.ct_b_h).status_code
        == 404
    )
    assert request_status(w) == "pending"


@pytest.mark.ac("BE-22", "AC9")
def test_detail_has_signed_photo_urls_and_suggested(w):
    r = client.get(f"/api/v1/onboarding-requests/{w.req}", headers=w.ct_a_h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["full_name"] == "Kiran M" and d["id_doc_number"] == "1234 5678 9012" and d["status"] == "pending"
    assert d["property_name"] == "Sunrise HSR"
    for k in ("id_doc", "selfie"):
        assert d[f"{k}_path"] in d[f"{k}_url"] and "X-Amz-Signature" in d[f"{k}_url"]
    assert d["suggested"] == {
        "rent_paise": None,
        "deposit_paise": DEPOSIT,
        "maintenance_charge_paise": MAINTENANCE,
        "first_month_rent_paise": None,
    }

    s = client.get(f"/api/v1/onboarding-requests/{w.req}?bed_id={w.bed_a1}", headers=w.ct_a_h).json()["suggested"]
    assert s["rent_paise"] == BASE_RENT
    assert s["first_month_rent_paise"] == billing.first_month_rent(BASE_RENT, today(w))
    s = client.get(f"/api/v1/onboarding-requests/{w.req}?stay_type=short_term", headers=w.ct_a_h).json()["suggested"]
    assert s["rent_paise"] == DAILY and s["first_month_rent_paise"] is None


# ---- approve ----------------------------------------------------------------------------------------


@pytest.mark.ac("BE-22", "AC1")
def test_approve_creates_resident_stay_and_joining_invoices(w):
    cin = date(2026, 11, 18)
    r = approve(w, w.owner_h, rent_paise=10_500_00, check_in_date=cin.isoformat())
    assert r.status_code == 201, r.text
    out = r.json()
    assert len(out["invoice_ids"]) == 3
    assert request_status(w) == "approved"

    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT * FROM residents WHERE id = %s", (out["resident_id"],))
        res = cur.fetchone()
        cur.execute("SELECT * FROM onboarding_requests WHERE id = %s", (w.req,))
        req = cur.fetchone()
        cur.execute("SELECT * FROM stays WHERE id = %s", (out["stay_id"],))
        stay = cur.fetchone()
    assert str(res["onboarding_request_id"]) == w.req
    for f in ("full_name", "phone", "email", "id_doc_type", "id_doc_number", "id_doc_path", "selfie_path",
              "emergency_contact_phone", "permanent_address", "is_foreign_national"):  # fmt: skip
        assert res[f] == req[f], f
    assert req["reviewed_by"] == w.owner
    assert stay["status"] == ("active" if cin <= today(w) else "reserved")
    assert (stay["rent_paise"], stay["deposit_paise"], stay["bed_id"]) == (10_500_00, DEPOSIT, w.bed_a1)

    inv = invoices(w, out["stay_id"])
    assert {str(i["id"]) for i in inv.values()} == set(out["invoice_ids"])
    assert inv["deposit"]["amount_paise"] == DEPOSIT
    assert inv["maintenance_charge"]["amount_paise"] == MAINTENANCE
    assert inv["rent"]["amount_paise"] == 4_550_00
    assert (inv["rent"]["period_start"], inv["rent"]["period_end"]) == (cin, date(2026, 11, 30))
    assert all(i["due_date"] == cin for i in inv.values())


@pytest.mark.ac("BE-22", "AC2")
def test_check_in_on_the_first_bills_the_full_month(w):
    cin = date(2026, 12, 1)
    r = approve(w, w.owner_h, check_in_date=cin.isoformat())
    assert r.status_code == 201, r.text
    rent = invoices(w, r.json()["stay_id"])["rent"]
    assert rent["amount_paise"] == BASE_RENT
    assert (rent["period_start"], rent["period_end"], rent["due_date"]) == (cin, date(2026, 12, 31), cin)


@pytest.mark.ac("BE-22", "AC2")
def test_future_check_in_is_reserved(w):
    r = approve(w, w.owner_h, check_in_date=(today(w) + timedelta(days=3)).isoformat())
    assert r.status_code == 201
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT status::text FROM stays WHERE id = %s", (r.json()["stay_id"],))
        assert cur.fetchone()["status"] == "reserved"
        cur.execute("SELECT status::text FROM beds WHERE id = %s", (w.bed_a1,))
        assert cur.fetchone()["status"] == "reserved"


@pytest.mark.ac("BE-22", "AC3")
def test_short_term_approval_bills_nights_times_daily_rate(w):
    cin = today(w)
    r = approve(
        w, w.ct_a_h, stay_type="short_term", rent_paise=DAILY,
        check_in_date=cin.isoformat(), expected_vacate_date=(cin + timedelta(days=3)).isoformat(),
    )  # fmt: skip
    assert r.status_code == 201, r.text
    inv = invoices(w, r.json()["stay_id"])
    assert set(inv) == {"deposit", "maintenance_charge", "short_term"}
    assert inv["short_term"]["amount_paise"] == 3 * DAILY
    assert inv["short_term"]["due_date"] == cin

    # expected_vacate_date is required for a short stay
    r = approve(w, w.owner_h, request_id=submit(w), bed_id=str(w.bed_a2), stay_type="short_term", rent_paise=DAILY)
    assert r.status_code == 422


@pytest.mark.ac("BE-22", "AC4")
def test_caretaker_rent_below_floor_creates_nothing(w):
    r = approve(w, w.ct_a_h, rent_paise=BASE_RENT - 1_000_00)
    assert r.status_code == 403
    assert "discount" in r.json()["error"]["message"].lower()
    assert request_status(w) == "pending" and resident_count(w) == 0
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT count(*) AS n FROM stays WHERE bed_id = %s", (w.bed_a1,))
        assert cur.fetchone()["n"] == 0

    # With an owner-approved discount for this bed and amount, the same approval works.
    with as_user(w.caretaker_a, w.org) as cur:
        cur.execute(
            """INSERT INTO discount_requests (org_id, property_id, bed_id, requested_rent_paise, reason)
               VALUES (%s, %s, %s, %s, 'six months upfront') RETURNING id""",
            (w.org, w.prop_a, w.bed_a1, BASE_RENT - 1_000_00),
        )
        disc = cur.fetchone()["id"]
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE discount_requests SET status = 'approved' WHERE id = %s", (disc,))
    r = approve(w, w.ct_a_h, rent_paise=BASE_RENT - 1_000_00, discount_request_id=str(disc))
    assert r.status_code == 201, r.text


@pytest.mark.ac("BE-22", "AC5")
def test_deposit_floor_for_caretakers_only(w):
    r = approve(w, w.ct_a_h, deposit_paise=DEPOSIT - 1)
    assert r.status_code == 403
    assert "deposit" in r.json()["error"]["message"].lower()
    assert request_status(w) == "pending" and resident_count(w) == 0
    assert approve(w, w.ct_a_h, deposit_paise=DEPOSIT + 1_000_00).status_code == 201  # raising is fine

    r = approve(w, w.owner_h, request_id=submit(w), bed_id=str(w.bed_a2), deposit_paise=0)
    assert r.status_code == 201, r.text
    assert "deposit" not in invoices(w, r.json()["stay_id"])


@pytest.mark.ac("BE-22", "AC6")
def test_maintenance_charge_floor_for_caretakers_only(w):
    r = approve(w, w.ct_a_h, maintenance_charge_paise=MAINTENANCE - 100)
    assert r.status_code == 403
    assert "maintenance" in r.json()["error"]["message"].lower()
    assert request_status(w) == "pending" and resident_count(w) == 0

    r = approve(w, w.owner_h, maintenance_charge_paise=100_00)
    assert r.status_code == 201, r.text
    assert invoices(w, r.json()["stay_id"])["maintenance_charge"]["amount_paise"] == 100_00


def test_occupied_bed_is_409_and_nothing_created(w):
    assert approve(w, w.ct_a_h).status_code == 201
    w.req = submit(w)
    r = approve(w, w.ct_a_h)
    assert r.status_code == 409
    assert r.json()["error"]["message"] == "This bed already has an active or reserved stay."
    assert request_status(w) == "pending" and resident_count(w) == 0


def test_caretaker_backdated_check_in_is_403(w):
    r = approve(w, w.ct_a_h, check_in_date=(today(w) - timedelta(days=2)).isoformat())
    assert r.status_code == 403
    assert request_status(w) == "pending"


# ---- reject + review once ---------------------------------------------------------------------------


@pytest.mark.ac("BE-22", "AC7")
def test_reject_with_note_and_review_once(w):
    r = client.post(
        f"/api/v1/onboarding-requests/{w.req}/reject", json={"note": "ID photo unreadable"}, headers=w.ct_a_h
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected" and r.json()["review_note"] == "ID photo unreadable"
    assert r.json()["reviewed_by"] == str(w.caretaker_a)

    again = client.post(f"/api/v1/onboarding-requests/{w.req}/reject", json={"note": "again"}, headers=w.owner_h)
    assert again.status_code == 409
    assert approve(w, w.owner_h).status_code == 409
    assert resident_count(w) == 0

    approved = submit(w)
    assert approve(w, w.ct_a_h, request_id=approved).status_code == 201
    assert approve(w, w.owner_h, request_id=approved, bed_id=str(w.bed_a2)).status_code == 409
