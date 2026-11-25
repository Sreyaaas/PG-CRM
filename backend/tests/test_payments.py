"""BE-31: log a payment (cash / UPI with UTR)."""

from urllib.parse import unquote

import pytest
from conftest import World, api_client, as_user, raises_sqlstate, rand_utr

from app.config import get_settings
from app.security import create_access_token

client = api_client()


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)  # assigned to prop_a (resident_a lives there)
    world.ct_b_h = _h(world.caretaker_b, world.org)
    return world


def _pay(w, headers=None, **body):
    body = {"resident_id": str(w.resident_a), "amount_paise": 6_000_00, "method": "cash"} | body
    return client.post("/api/v1/payments", json=body, headers=headers or w.ct_a_h)


def _invoice(w, resident=None, **cols) -> str:
    values = {
        "org_id": w.org,
        "property_id": w.prop_a,
        "resident_id": resident or w.resident_a,
        "kind": "deposit",
        "amount_paise": 5_000_00,
    } | cols
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            f"INSERT INTO invoices ({', '.join(values)}, due_date) "
            f"VALUES ({', '.join(['%s'] * len(values))}, app.today_ist()) RETURNING id",
            list(values.values()),
        )
        return cur.fetchone()["id"]


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-31", "AC1")
def test_cash_payment_is_recorded_and_attributed_to_the_caller(w):
    r = _pay(w, notes="June rent, counted twice")
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["status"] == "recorded" and p["method"] == "cash" and p["utr_number"] is None
    assert p["received_by"] == str(w.caretaker_a) and p["received_by_name"] == "Ravi"
    assert (p["amount_paise"], p["resident_name"], p["notes"]) == (6_000_00, "Anika Rao", "June rent, counted twice")
    assert client.get(f"/api/v1/payments/{p['id']}", headers=w.owner_h).json() == p


@pytest.mark.ac("BE-31", "AC1")
def test_client_cannot_set_status_receiver_or_time(w):
    for extra in ({"status": "verified"}, {"received_by": str(w.owner)}, {"received_at": "2026-01-01T00:00:00Z"}):
        assert _pay(w, **extra).status_code == 422, extra
    with as_user(w.caretaker_a, w.org) as cur:  # even straight into the database
        cur.execute(
            """INSERT INTO payments (org_id, property_id, resident_id, amount_paise, method, status, received_by,
                                     received_at)
               VALUES (%s, %s, %s, 100000, 'cash', 'verified', %s, now() - interval '10 days')
               RETURNING status::text, received_by, received_at > now() - interval '1 minute' AS just_now""",
            (w.org, w.prop_a, w.resident_a, w.owner),
        )
        row = cur.fetchone()
    assert row == {"status": "recorded", "received_by": w.caretaker_a, "just_now": True}


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-31", "AC2")
@pytest.mark.parametrize("method", ["upi", "bank_transfer"])
def test_upi_or_bank_payment_with_utr_is_provisional(w, method):
    utr = rand_utr()
    r = _pay(w, method=method, utr_number=utr)
    assert r.status_code == 201, r.text
    assert (r.json()["status"], r.json()["utr_number"], r.json()["method"]) == ("provisional", utr, method)


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-31", "AC3")
def test_duplicate_utr_is_409(w):
    utr = rand_utr()
    assert _pay(w, method="upi", utr_number=utr).status_code == 201
    for again in ({"method": "upi"}, {"method": "bank_transfer", "amount_paise": 1_00}):
        r = _pay(w, headers=w.owner_h, utr_number=utr, **again)
        assert r.status_code == 409
        assert r.json()["error"] == {
            "code": "duplicate",
            "message": "This UTR has already been used for another payment.",
        }
    spaced = f"{utr[:4]} {utr[4:8]} {utr[8:]}"
    assert _pay(w, method="upi", utr_number=spaced).status_code == 409  # same UTR, typed differently


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-31", "AC4")
@pytest.mark.parametrize(
    "body",
    [
        {"method": "cash", "utr_number": "123456789012"},
        {"method": "upi"},
        {"method": "upi", "utr_number": "   "},
        {"method": "bank_transfer"},
        {"method": "upi", "utr_number": "12345678901"},  # 11 digits
        {"method": "upi", "utr_number": "1234567890123"},  # 13 digits
        {"method": "upi", "utr_number": "12345678901A"},
        {"method": "cheque"},
        {"amount_paise": 0},
    ],
)
def test_bad_method_utr_combinations_are_422(w, body):
    r = _pay(w, **body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation", body


# ---- AC5 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-31", "AC5")
def test_utr_with_spaces_is_normalised(w):
    utr = rand_utr()
    r = _pay(w, method="upi", utr_number=f" {utr[:4]} {utr[4:8]}  {utr[8:]} ")
    assert r.status_code == 201, r.text
    assert r.json()["utr_number"] == utr
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT utr_number FROM payments WHERE id = %s", (r.json()["id"],))
        assert cur.fetchone()["utr_number"] == utr


# ---- AC6 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-31", "AC6")
def test_response_has_receipt_and_whatsapp_links(w):
    p = _pay(w, method="upi", utr_number=rand_utr(), amount_paise=10_500_00).json()
    base = get_settings().public_app_url.rstrip("/")
    assert p["receipt_url"] == f"{base}/receipt/{p['public_token']}" and len(p["public_token"]) == 64
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT phone FROM residents WHERE id = %s", (w.resident_a,))
        phone = cur.fetchone()["phone"]
    assert p["whatsapp_url"].startswith(f"https://wa.me/91{phone}?text=")
    text = unquote(p["whatsapp_url"].split("?text=", 1)[1])
    assert text == f"Hi Anika, received ₹10,500 (UPI) for Sunrise HSR. Receipt: {p['receipt_url']}"
    listed = client.get("/api/v1/payments", headers=w.owner_h).json()
    assert next(x for x in listed if x["id"] == p["id"])["whatsapp_url"] == p["whatsapp_url"]


# ---- AC7 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-31", "AC7")
def test_paying_another_residents_invoice_is_422(w):
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "INSERT INTO residents (org_id, property_id, full_name, phone) VALUES (%s, %s, 'Other', '9000000001') "
            "RETURNING id",
            (w.org, w.prop_a),
        )
        other = cur.fetchone()["id"]
    theirs = _invoice(w, resident=other)
    r = _pay(w, invoice_id=str(theirs))
    assert r.status_code == 422 and r.json()["error"]["message"] == "Invoice belongs to a different resident"

    mine = _invoice(w)
    r = _pay(w, invoice_id=str(mine))
    assert r.status_code == 201 and r.json()["invoice_id"] == str(mine)


def test_void_invoice_cannot_be_paid(w):
    inv = _invoice(w)
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE invoices SET voided_at = now(), void_reason = 'Duplicate' WHERE id = %s", (inv,))
    r = _pay(w, invoice_id=str(inv))
    assert r.status_code == 422 and r.json()["error"]["message"] == "Cannot pay a void invoice"


def test_access_and_filters(w):
    assert _pay(w, headers=w.ct_b_h).status_code == 404  # resident of a building they can't see
    cash = _pay(w).json()
    upi = _pay(w, method="upi", utr_number=rand_utr()).json()
    by_status = {
        p["id"] for p in client.get("/api/v1/payments", params={"status": "provisional"}, headers=w.owner_h).json()
    }
    assert upi["id"] in by_status and cash["id"] not in by_status
    by_method = {p["id"] for p in client.get("/api/v1/payments", params={"method": "cash"}, headers=w.ct_a_h).json()}
    assert cash["id"] in by_method and upi["id"] not in by_method
    assert client.get("/api/v1/payments", headers=w.ct_b_h).json() == []
    assert client.get(f"/api/v1/payments/{cash['id']}", headers=w.ct_b_h).status_code == 404


def test_payment_reduces_dues(w):
    _invoice(w, amount_paise=8_000_00)
    before = {d["resident_id"]: d for d in client.get("/api/v1/dues", headers=w.owner_h).json()}[str(w.resident_a)]
    _pay(w, amount_paise=3_000_00)
    after = {d["resident_id"]: d for d in client.get("/api/v1/dues", headers=w.owner_h).json()}[str(w.resident_a)]
    assert before["outstanding_paise"] - after["outstanding_paise"] == 3_000_00


def test_caretaker_cannot_verify_or_edit_payments(w):
    p = _pay(w, method="upi", utr_number=rand_utr()).json()
    with raises_sqlstate("PC002", "42501"), as_user(w.caretaker_a, w.org) as cur:
        cur.execute("UPDATE payments SET status = 'verified' WHERE id = %s", (p["id"],))
