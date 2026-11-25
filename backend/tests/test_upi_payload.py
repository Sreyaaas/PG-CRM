"""BE-33: dynamic UPI payload (upi://pay?...) for what is still due on an invoice."""

from urllib.parse import parse_qsl

import pytest
from conftest import World, api_client, as_user, rand_utr

from app.security import create_access_token
from app.upi import build_upi_uri, rupees

client = api_client()
VPA = "paytmqr2810050501011abcdxyz@paytm"
SAMPLE = {"upi_vpa": VPA, "upi_payee_name": "Sri Sai PG", "upi_mcc": "7011"}
FORBIDDEN = ("sign", "tr", "mode", "orgid")


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)
    world.ct_b_h = _h(world.caretaker_b, world.org)
    _set_upi(world, **SAMPLE)
    return world


def _set_upi(w, **cols):
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "UPDATE properties SET upi_vpa = %(upi_vpa)s, upi_payee_name = %(upi_payee_name)s, upi_mcc = %(upi_mcc)s "
            "WHERE id = %(id)s",
            {"upi_vpa": None, "upi_payee_name": None, "upi_mcc": None} | cols | {"id": w.prop_a},
        )


def _invoice(w, amount=10_500_00) -> dict:
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """INSERT INTO invoices (org_id, property_id, resident_id, kind, amount_paise, due_date)
               VALUES (%s, %s, %s, 'rent', %s, app.today_ist()) RETURNING id, invoice_no""",
            (w.org, w.prop_a, w.resident_a, amount),
        )
        return cur.fetchone()


def _pay(w, invoice_id, amount, method="upi"):
    r = client.post(
        "/api/v1/payments",
        json={
            "resident_id": str(w.resident_a),
            "invoice_id": str(invoice_id),
            "amount_paise": amount,
            "method": method,
            "utr_number": rand_utr() if method != "cash" else None,
        },
        headers=w.owner_h,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _upi(w, invoice_id, headers=None):
    return client.get(f"/api/v1/invoices/{invoice_id}/upi", headers=headers or w.ct_a_h)


def _params(uri: str) -> dict:
    assert uri.startswith("upi://pay?")
    return dict(parse_qsl(uri.split("?", 1)[1]))


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-33", "AC1")
def test_sample_payload_is_exact():
    assert (
        build_upi_uri(SAMPLE, 10_500_00, "INV-000001")
        == f"upi://pay?pa={VPA}&pn=Sri%20Sai%20PG&mc=7011&am=10500.00&tn=INV-000001&cu=INR"
    )
    assert [rupees(p) for p in (1, 99, 100, 10_500_05, 1_05_000_00)] == [
        "0.01",
        "0.99",
        "1.00",
        "10500.05",
        "105000.00",
    ]
    assert len(_params(build_upi_uri(SAMPLE, 100, "N" * 80))["tn"]) == 50  # note capped at 50 chars


@pytest.mark.ac("BE-33", "AC1")
def test_endpoint_returns_the_invoice_payload(w):
    inv = _invoice(w)
    r = _upi(w, inv["id"])
    assert r.status_code == 200, r.text
    assert r.json() == {
        "upi_uri": f"upi://pay?pa={VPA}&pn=Sri%20Sai%20PG&mc=7011&am=10500.00&tn={inv['invoice_no']}&cu=INR",
        "amount_paise": 10_500_00,
    }
    assert _upi(w, inv["id"], headers=w.owner_h).json() == r.json()
    assert _upi(w, inv["id"], headers=w.ct_b_h).status_code == 404  # other building: invisible (RLS)
    assert _upi(w, "00000000-0000-0000-0000-000000000000").status_code == 404


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-33", "AC2")
def test_uri_never_carries_signed_qr_fields(w):
    # Even if the stored payee name were to contain them, they stay inside the encoded pn value.
    for prop in (SAMPLE, SAMPLE | {"upi_payee_name": "PG&sign=abc&tr=1&mode=02&orgid=9"}):
        uri = build_upi_uri(prop, 7_777_77, "INV-000042&tr=x")
        params = _params(uri)
        assert set(params) <= {"pa", "pn", "mc", "am", "tn", "cu"}
        for key in FORBIDDEN:
            assert f"&{key}=" not in uri and f"?{key}=" not in uri
    uri = _upi(w, _invoice(w)["id"]).json()["upi_uri"]
    assert all(f"{key}=" not in uri for key in FORBIDDEN)


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-33", "AC3")
def test_missing_mcc_is_omitted_and_missing_vpa_gives_null(w):
    assert (
        build_upi_uri(SAMPLE | {"upi_mcc": None}, 500_00, "INV-000007")
        == f"upi://pay?pa={VPA}&pn=Sri%20Sai%20PG&am=500.00&tn=INV-000007&cu=INR"
    )
    assert build_upi_uri(SAMPLE | {"upi_vpa": None}, 500_00, "INV-000007") is None

    inv = _invoice(w)
    _set_upi(w, upi_vpa=VPA, upi_payee_name="Sri Sai PG")
    assert "mc=" not in _upi(w, inv["id"]).json()["upi_uri"]
    _set_upi(w)
    assert _upi(w, inv["id"]).json() == {"upi_uri": None, "amount_paise": 10_500_00}


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-33", "AC4")
def test_partial_payment_leaves_the_remaining_amount(w):
    inv = _invoice(w)
    _pay(w, inv["id"], 4_000_00)
    body = _upi(w, inv["id"]).json()
    assert body["amount_paise"] == 6_500_00 and _params(body["upi_uri"])["am"] == "6500.00"

    other = _invoice(w, 2_000_00)  # payments against other invoices don't count
    _pay(w, other["id"], 2_000_00, method="cash")
    assert _upi(w, inv["id"]).json()["amount_paise"] == 6_500_00

    voided = _pay(w, inv["id"], 1_000_00)
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE payments SET voided_at = now(), void_reason = 'Wrong entry' WHERE id = %s", (voided["id"],))
    assert _upi(w, inv["id"]).json()["amount_paise"] == 6_500_00  # void payments don't count

    _pay(w, inv["id"], 6_500_00)
    assert _upi(w, inv["id"]).json() == {"upi_uri": None, "amount_paise": 0}  # fully paid: nothing to scan
