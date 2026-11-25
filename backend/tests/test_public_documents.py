"""BE-34: GET /public/documents/{token}: one receipt, invoice or exit settlement, no sign-in."""

from datetime import timedelta

import pytest
from conftest import BASE_RENT, World, api_client, as_user, rand_ip, rand_utr

from app import ratelimit
from app.security import create_access_token

client = api_client()
VPA = "srisai@okaxis"
PRIVATE = ("phone", "email", "aadhaar", "kyc", "id_doc", "selfie", "address", "emergency", "date_of_birth")


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    with as_user(world.owner, world.org) as cur:
        cur.execute(
            """UPDATE properties SET upi_vpa = %s, upi_payee_name = 'Sri Sai PG', upi_mcc = '7011',
                      fallback_upi_id = 'srisai@ybl', bank_details = 'HDFC 0000123 IFSC HDFC0001'
                WHERE id = %s""",
            (VPA, world.prop_a),
        )
        cur.execute("UPDATE residents SET email = 'anika@example.com' WHERE id = %s", (world.resident_a,))
        cur.execute("SELECT app.today_ist() AS d")
        world.today = cur.fetchone()["d"]
    return world


def _get(token: str):
    return client.get(f"/api/v1/public/documents/{token}")


def _invoice(w, amount=10_500_00) -> dict:
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """INSERT INTO invoices (org_id, property_id, resident_id, kind, amount_paise, due_date, period_start,
                                     period_end)
               VALUES (%s, %s, %s, 'rent', %s, app.today_ist(), date_trunc('month', app.today_ist())::date,
                       (date_trunc('month', app.today_ist()) + interval '1 month - 1 day')::date)
               RETURNING id, invoice_no, public_token""",
            (w.org, w.prop_a, w.resident_a, amount),
        )
        return cur.fetchone()


def _pay(w, **body) -> dict:
    body = {
        "resident_id": str(w.resident_a),
        "amount_paise": 4_000_00,
        "method": "upi",
        "utr_number": rand_utr(),
    } | body
    r = client.post("/api/v1/payments", json=body, headers=w.owner_h)
    assert r.status_code == 201, r.text
    return r.json()


def _assert_nothing_private(doc: dict):
    keys = " ".join(doc).lower()
    assert all(p not in keys for p in PRIVATE), doc
    assert "anika@example.com" not in str(doc)


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-34", "AC1")
def test_payment_receipt_fields_and_nothing_private(w):
    inv = _invoice(w)
    p = _pay(w, invoice_id=str(inv["id"]))
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT phone FROM residents WHERE id = %s", (w.resident_a,))
        phone = cur.fetchone()["phone"]

    res = _get(p["public_token"])
    assert res.status_code == 200, res.text
    doc = res.json()
    assert set(doc) == {
        "type", "receipt_no", "amount_paise", "method", "utr_number", "status", "received_at", "resident_name",
        "property_name", "invoice_no", "period_start", "period_end",
    }  # fmt: skip
    assert doc["type"] == "payment_receipt" and doc["receipt_no"] == p["id"][:8]
    assert (doc["amount_paise"], doc["method"], doc["status"]) == (4_000_00, "upi", "provisional")
    assert doc["utr_number"] == p["utr_number"]
    assert (doc["resident_name"], doc["property_name"]) == ("Anika Rao", "Sunrise HSR")
    assert doc["invoice_no"] == inv["invoice_no"] and doc["period_start"] and doc["period_end"]
    assert phone not in res.text
    _assert_nothing_private(doc)


@pytest.mark.ac("BE-34", "AC1")
def test_void_payment_receipt_says_void(w):
    p = _pay(w)
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE payments SET voided_at = now(), void_reason = 'Wrong entry' WHERE id = %s", (p["id"],))
    assert _get(p["public_token"]).json()["status"] == "void"


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-34", "AC2")
def test_invoice_has_upi_uri_for_the_amount_still_due(w):
    inv = _invoice(w)
    doc = _get(inv["public_token"]).json()
    assert doc["type"] == "invoice" and doc["invoice_no"] == inv["invoice_no"] and doc["kind"] == "rent"
    assert (doc["amount_paise"], doc["paid_paise"], doc["outstanding_paise"]) == (10_500_00, 0, 10_500_00)
    assert doc["upi_uri"] == f"upi://pay?pa={VPA}&pn=Sri%20Sai%20PG&mc=7011&am=10500.00&tn={inv['invoice_no']}&cu=INR"
    assert (doc["fallback_upi_id"], doc["bank_details"]) == ("srisai@ybl", "HDFC 0000123 IFSC HDFC0001")
    assert doc["status"] is None and doc["resident_name"] == "Anika Rao"
    _assert_nothing_private(doc)

    _pay(w, invoice_id=str(inv["id"]), method="cash", utr_number=None)
    doc = _get(inv["public_token"]).json()
    assert (doc["paid_paise"], doc["outstanding_paise"]) == (4_000_00, 6_500_00)
    assert "&am=6500.00&" in doc["upi_uri"]


@pytest.mark.ac("BE-34", "AC2")
def test_invoice_without_vpa_or_voided_has_no_upi_uri(w):
    inv = _invoice(w)
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE properties SET upi_vpa = NULL WHERE id = %s", (w.prop_a,))
    doc = _get(inv["public_token"]).json()
    assert doc["upi_uri"] is None and doc["outstanding_paise"] == 10_500_00 and doc["fallback_upi_id"]
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE invoices SET voided_at = now(), void_reason = 'Mistake' WHERE id = %s", (inv["id"],))
    doc = _get(inv["public_token"]).json()
    assert (doc["status"], doc["outstanding_paise"], doc["upi_uri"]) == ("void", 0, None)


# ---- AC3 --------------------------------------------------------------------------------------------


def _settlement(w) -> str:
    """A vacated stay for resident_a with its settlement; returns the settlement's public token."""
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, status, rent_paise,
                                  check_in_date)
               VALUES (%s, %s, %s, %s, 'monthly', 'active', %s, %s) RETURNING id""",
            (w.org, w.prop_a, w.resident_a, w.bed_a1, BASE_RENT, w.today - timedelta(days=90)),
        )
        stay = cur.fetchone()["id"]
        cur.execute(
            "UPDATE stays SET status = 'vacated', actual_vacate_date = %s WHERE id = %s",
            (w.today - timedelta(days=1), stay),
        )
        cur.execute(
            """INSERT INTO exit_settlements (org_id, property_id, stay_id, resident_id, deposit_paise,
                                             exit_deduction_paise, other_deductions_paise, other_deductions_note,
                                             pending_dues_paise, refund_method, refund_utr)
               VALUES (%s, %s, %s, %s, 10_000_00, 2_000_00, 500_00, 'Broken lamp', 6_000_00, 'upi', %s)
               RETURNING public_token""",
            (w.org, w.prop_a, stay, w.resident_a, rand_utr()),
        )
        return cur.fetchone()["public_token"]


@pytest.mark.ac("BE-34", "AC3")
def test_exit_settlement_fields(w):
    doc = _get(_settlement(w)).json()
    assert set(doc) == {
        "type", "resident_name", "property_name", "check_in_date", "vacate_date", "deposit_paise",
        "exit_deduction_paise", "other_deductions_paise", "other_deductions_note", "pending_dues_paise",
        "net_refund_paise", "refund_method", "refund_utr", "settled_at",
    }  # fmt: skip
    assert doc["type"] == "exit_settlement" and doc["resident_name"] == "Anika Rao"
    assert doc["check_in_date"] == (w.today - timedelta(days=90)).isoformat()
    assert doc["vacate_date"] == (w.today - timedelta(days=1)).isoformat()
    assert (doc["deposit_paise"], doc["exit_deduction_paise"], doc["other_deductions_paise"]) == (
        10_000_00,
        2_000_00,
        500_00,
    )
    assert (doc["pending_dues_paise"], doc["net_refund_paise"]) == (6_000_00, 1_500_00)
    assert doc["other_deductions_note"] == "Broken lamp" and doc["settled_at"]
    assert doc["refund_method"] == "upi" and len(doc["refund_utr"]) == 12
    _assert_nothing_private(doc)


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-34", "AC4")
def test_unknown_or_malformed_token_is_404(w):
    for token in ("0" * 64, "abc", "x" * 65, "a" * 63, "%27%20OR%201%3D1--"):
        r = _get(token)
        assert r.status_code == 404, (token, r.text)
        assert r.json()["error"]["code"] == "not_found"


# ---- AC5 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-34", "AC5")
def test_no_store_and_noindex_headers(w):
    for r in (_get(_pay(w)["public_token"]), _get(_invoice(w)["public_token"]), _get(_settlement(w)), _get("0" * 64)):
        assert r.headers["cache-control"] == "no-store", r.status_code
        assert r.headers["x-robots-tag"] == "noindex", r.status_code


def test_rate_limited_per_ip(w, monkeypatch):
    monkeypatch.setattr(ratelimit, "PUBLIC_DOCUMENTS_IP", ratelimit.Limit(f"documents-test:{rand_ip()}", 3, 60))
    token = _invoice(w)["public_token"]
    assert [_get(token).status_code for _ in range(4)] == [200, 200, 200, 429]
