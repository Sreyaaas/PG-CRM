"""BE-50: exit settlement (preview + owner-only, once-only settlement after move-out)."""

import json
from datetime import timedelta
from urllib.parse import unquote
from uuid import uuid4

import pytest
from conftest import BASE_RENT, World, api_client, as_user, raises_sqlstate, rand_phone, rand_utr

from app.config import get_settings
from app.security import create_access_token

client = api_client()


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)
    world.ct_b_h = _h(world.caretaker_b, world.org)
    with as_user(world.owner, world.org) as cur:
        cur.execute("SELECT app.today_ist() AS d")
        world.today = cur.fetchone()["d"]
    return world


def _stay(w, resident=None, vacated=True) -> str:
    """Owner-created monthly stay that checked in 60 days ago (moved out yesterday unless `vacated=False`)."""
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, status, rent_paise,
                                  check_in_date)
               VALUES (%s, %s, %s, %s, 'monthly', 'active', %s, %s) RETURNING id""",
            (w.org, w.prop_a, resident or w.resident_a, w.bed_a1, BASE_RENT, w.today - timedelta(days=60)),
        )
        stay = str(cur.fetchone()["id"])
    if vacated:
        _move_out(w, stay)
    return stay


def _move_out(w, stay):
    r = client.post(
        f"/api/v1/stays/{stay}/move-out",
        json={"actual_vacate_date": (w.today - timedelta(days=1)).isoformat()},
        headers=w.owner_h,
    )
    assert r.status_code == 200, r.text


def _invoice(w, stay, kind, amount, resident=None) -> str:
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """INSERT INTO invoices (org_id, property_id, resident_id, stay_id, kind, amount_paise, due_date)
               VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (w.org, w.prop_a, resident or w.resident_a, stay, kind, amount, w.today - timedelta(days=30)),
        )
        return str(cur.fetchone()["id"])


def _pay(w, amount, invoice=None, resident=None) -> str:
    body = {"resident_id": str(resident or w.resident_a), "amount_paise": amount, "method": "cash"}
    r = client.post("/api/v1/payments", json=body | ({"invoice_id": invoice} if invoice else {}), headers=w.owner_h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _preview(w, stay, headers=None):
    return client.get(f"/api/v1/stays/{stay}/settlement-preview", headers=headers or w.owner_h)


def _settle(w, stay, headers=None, **body):
    return client.post(f"/api/v1/stays/{stay}/settlement", json=body, headers=headers or w.owner_h)


def _standard(w) -> str:
    """₹10,000 deposit paid, one unpaid ₹6,000 month; the property's exit deduction is ₹2,000 (conftest)."""
    stay = _stay(w)
    _pay(w, 10_000_00, invoice=_invoice(w, stay, "deposit", 10_000_00))
    _invoice(w, stay, "rent", 6_000_00)
    return stay


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-50", "AC1")
def test_preview_deposit_minus_exit_deduction_minus_dues(w):
    stay = _standard(w)
    for headers in (w.owner_h, w.ct_a_h):
        r = _preview(w, stay, headers)
        assert r.status_code == 200, r.text
        assert r.json() == {
            "deposit_held_paise": 10_000_00,
            "exit_deduction_paise": 2_000_00,
            "pending_dues_paise": 6_000_00,
            "suggested_net_refund_paise": 2_000_00,
        }
    assert _preview(w, stay, w.ct_b_h).status_code == 404  # other building (RLS)


@pytest.mark.ac("BE-50", "AC1")
def test_preview_counts_only_what_is_really_paid_and_owed(w):
    stay = _standard(w)
    rent2 = _invoice(w, stay, "rent", 6_000_00)
    _pay(w, 6_000_00, invoice=rent2)  # paid month: not pending
    one_off = _invoice(w, None, "other", 1_000_00)  # one-off charge (no stay): pending
    _pay(w, 400_00)  # unlinked payment covers dues
    v = _pay(w, 5_000_00)
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE payments SET voided_at = now(), void_reason = 'Wrong entry' WHERE id = %s", (v,))
        cur.execute("UPDATE invoices SET voided_at = now(), void_reason = 'Mistake' WHERE id = %s", (one_off,))
    _invoice(w, None, "other", 1_000_00)
    p = _preview(w, stay).json()
    assert (p["deposit_held_paise"], p["pending_dues_paise"]) == (10_000_00, 6_600_00)
    assert p["suggested_net_refund_paise"] == 10_000_00 - 2_000_00 - 6_600_00

    # More owed than the deposit covers: negative, shown not blocked.
    _invoice(w, stay, "rent", 9_000_00)
    assert _preview(w, stay).json()["suggested_net_refund_paise"] == 10_000_00 - 2_000_00 - 15_600_00
    r = _settle(w, stay)
    assert r.status_code == 201 and r.json()["net_refund_paise"] == -7_600_00


# ---- AC2 --------------------------------------------------------------------------------------------


def _onboarded_stay(w) -> str:
    """A resident who accepted the property's ₹2,000 exit deduction on the QR form, approved and moved out."""
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT qr_slug FROM properties WHERE id = %s", (w.prop_a,))
        slug = cur.fetchone()["qr_slug"]
    payload = {
        "full_name": "Kiran M",
        "phone": rand_phone(),
        "permanent_address": "12 MG Road, Mysuru",
        "occupation": "working",
        "employer_or_college": "Infosys",
        "emergency_contact_name": "Lakshmi M",
        "emergency_contact_phone": "9876543210",
        "id_doc_type": "aadhaar",
        "id_doc_number": "1234 5678 9012",
        "id_doc_path": f"onboarding/{w.prop_a}/{uuid4()}.jpg",
        "selfie_path": f"onboarding/{w.prop_a}/{uuid4()}.jpg",
        "accepted_rules": True,
        "accepted_exit_deduction_paise": 2_000_00,
    }
    with as_user(None) as cur:
        cur.execute("SELECT api.public_submit_onboarding(%s, %s::jsonb) AS id", (slug, json.dumps(payload)))
        req = cur.fetchone()["id"]
    r = client.post(
        f"/api/v1/onboarding-requests/{req}/approve",
        json={
            "bed_id": str(w.bed_a2),
            "stay_type": "monthly",
            "rent_paise": BASE_RENT,
            "deposit_paise": 0,
            "maintenance_charge_paise": 0,
            "check_in_date": w.today.isoformat(),
        },
        headers=w.owner_h,
    )
    assert r.status_code in (200, 201), r.text
    stay = r.json()["stay_id"]
    r = client.post(
        f"/api/v1/stays/{stay}/move-out", json={"actual_vacate_date": w.today.isoformat()}, headers=w.owner_h
    )
    assert r.status_code == 200, r.text
    return stay


@pytest.mark.ac("BE-50", "AC2")
def test_exit_deduction_from_acceptance_else_property(w):
    onboarded = _onboarded_stay(w)
    walk_in = _stay(w)  # resident_a was added by hand: no onboarding acceptance
    with as_user(w.owner, w.org) as cur:  # the owner raises the property's deduction later
        cur.execute("UPDATE properties SET exit_deduction_paise = 3_500_00 WHERE id = %s", (w.prop_a,))
    assert _preview(w, onboarded).json()["exit_deduction_paise"] == 2_000_00  # what they accepted on Day 1
    assert _preview(w, walk_in).json()["exit_deduction_paise"] == 3_500_00  # fallback: the property value
    r = _settle(w, onboarded)
    assert r.status_code == 201, r.text
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT exit_deduction_paise FROM exit_settlements WHERE id = %s", (r.json()["id"],))
        assert cur.fetchone()["exit_deduction_paise"] == 2_000_00


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-50", "AC3")
def test_settle_before_move_out_twice_and_as_caretaker(w):
    stay = _stay(w, vacated=False)
    _pay(w, 10_000_00, invoice=_invoice(w, stay, "deposit", 10_000_00))
    r = _settle(w, stay)
    assert r.status_code == 422 and "vacated" in r.json()["error"]["message"]

    _move_out(w, stay)
    r = _settle(w, stay, headers=w.ct_a_h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"

    r = _settle(w, stay, refund_method="upi", refund_utr=rand_utr())
    assert r.status_code == 201, r.text
    assert r.json()["net_refund_paise"] == 8_000_00
    r = _settle(w, stay)
    assert r.status_code == 409
    assert _settle(w, str(uuid4())).status_code == 404


@pytest.mark.ac("BE-50", "AC3")
def test_database_enforces_settlement_rules(w, admin):
    """Even straight into the database: caretakers can't settle, active stays can't be settled, and a settlement
    can't be changed or settled twice."""
    stay = _stay(w, vacated=False)
    cols = "org_id, property_id, stay_id, resident_id, deposit_paise"
    vals = (w.org, w.prop_a, stay, w.resident_a, 10_000_00)
    with raises_sqlstate("PC003"), as_user(w.owner, w.org) as cur:
        cur.execute(f"INSERT INTO exit_settlements ({cols}) VALUES (%s, %s, %s, %s, %s)", vals)
    _move_out(w, stay)
    with raises_sqlstate("42501", "PC002"), as_user(w.caretaker_a, w.org) as cur:
        cur.execute(f"INSERT INTO exit_settlements ({cols}) VALUES (%s, %s, %s, %s, %s)", vals)
    with as_user(w.owner, w.org) as cur:
        cur.execute(f"INSERT INTO exit_settlements ({cols}) VALUES (%s, %s, %s, %s, %s) RETURNING id", vals)
        sid = cur.fetchone()["id"]
    with raises_sqlstate("23505"), as_user(w.owner, w.org) as cur:
        cur.execute(f"INSERT INTO exit_settlements ({cols}) VALUES (%s, %s, %s, %s, %s)", vals)
    with raises_sqlstate("PC001"):
        admin.execute("UPDATE exit_settlements SET deposit_paise = 0 WHERE id = %s", (sid,))


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-50", "AC4")
def test_other_deductions_need_a_note(w):
    stay = _standard(w)
    for body in ({"other_deductions_paise": 500_00}, {"other_deductions_paise": 500_00, "other_deductions_note": " "}):
        r = _settle(w, stay, **body)
        assert r.status_code == 422, body
    assert _settle(w, stay, refund_utr="12345").status_code == 422
    r = _settle(w, stay, other_deductions_paise=500_00, other_deductions_note="Broken cupboard door")
    assert r.status_code == 201, r.text
    assert r.json()["net_refund_paise"] == 1_500_00


# ---- AC5 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-50", "AC5")
def test_settlement_link_returns_exit_settlement_document(w):
    stay = _standard(w)
    utr = rand_utr()
    s = _settle(
        w, stay, other_deductions_paise=500_00, other_deductions_note="Lost key", refund_method="upi", refund_utr=utr
    ).json()
    base = get_settings().public_app_url.rstrip("/")
    assert s["settlement_url"] == f"{base}/receipt/{s['public_token']}" and len(s["public_token"]) == 64
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT phone FROM residents WHERE id = %s", (w.resident_a,))
        phone = cur.fetchone()["phone"]
    assert s["whatsapp_url"].startswith(f"https://wa.me/91{phone}?text=")
    assert unquote(s["whatsapp_url"].split("?text=", 1)[1]) == (
        f"Hi Anika, your deposit settlement for Sunrise HSR: {s['settlement_url']}"
    )

    r = client.get(f"/api/v1/public/documents/{s['public_token']}")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["type"] == "exit_settlement" and doc["resident_name"] == "Anika Rao"
    assert (doc["deposit_paise"], doc["exit_deduction_paise"], doc["pending_dues_paise"]) == (
        10_000_00,
        2_000_00,
        6_000_00,
    )
    assert (doc["other_deductions_paise"], doc["other_deductions_note"], doc["net_refund_paise"]) == (
        500_00,
        "Lost key",
        1_500_00,
    )
    assert (doc["refund_method"], doc["refund_utr"]) == ("upi", utr)
    assert doc["net_refund_paise"] == s["net_refund_paise"] and phone not in r.text
