"""BE-35: wa.me message templates (receipt, reminder, invoice, settlement) and ₹ formatting."""

import re
from datetime import date, timedelta
from urllib.parse import unquote

import pytest
from conftest import World, api_client, as_user, rand_phone

from app import whatsapp
from app.config import get_settings
from app.money import format_inr
from app.security import create_access_token

client = api_client()
TOKEN = "a" * 64
WA = re.compile(r"^https://wa\.me/91[0-9]{10}\?text=[A-Za-z0-9%._~-]+$")  # quote(safe=''): nothing else survives


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


def _base() -> str:
    return get_settings().public_app_url.rstrip("/")


def _text(url: str) -> str:
    return unquote(url.split("?text=", 1)[1])


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)
    with as_user(world.owner, world.org) as cur:
        cur.execute("SELECT app.today_ist() AS d")
        world.today = cur.fetchone()["d"]
    return world


def _resident(w, name: str) -> tuple[str, str]:
    phone = rand_phone()
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "INSERT INTO residents (org_id, property_id, full_name, phone) VALUES (%s, %s, %s, %s) RETURNING id",
            (w.org, w.prop_a, name, phone),
        )
        return str(cur.fetchone()["id"]), phone


def _one_off(w, resident, amount, due: date) -> dict:
    r = client.post(
        "/api/v1/invoices",
        json={"resident_id": resident, "amount_paise": amount, "due_date": due.isoformat(), "notes": "Late fee"},
        headers=w.owner_h,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _token(invoice_id: str, w) -> str:
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT public_token FROM invoices WHERE id = %s", (invoice_id,))
        return cur.fetchone()["public_token"]


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-35", "AC1")
def test_format_inr_indian_grouping():
    assert format_inr(0) == "₹0"
    assert format_inr(99) == "₹0.99"
    assert format_inr(100000) == "₹1,000"
    assert format_inr(10500000) == "₹1,05,000"
    assert format_inr(1_23_45_678_00) == "₹1,23,45,678"
    assert format_inr(1_050_50) == "₹1,050.50"
    assert format_inr(-2_000_00) == "-₹2,000"


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-35", "AC2")
def test_each_template_produces_the_documented_text():
    url = f"{_base()}/receipt/{TOKEN}"
    assert set(whatsapp.TEMPLATES) == {"receipt", "reminder", "invoice", "settlement"}
    assert (
        whatsapp.receipt_text(
            full_name="Anika Rao", amount_paise=10_500_00, method="upi", property_name="Sunrise HSR", token=TOKEN
        )
        == f"Hi Anika, received ₹10,500 (UPI) for Sunrise HSR. Receipt: {url}"
    )
    assert (
        whatsapp.reminder_text(
            full_name="Rahul Kumar Singh",
            outstanding_paise=1_05_000_00,
            property_name="Sunrise HSR",
            due_date=date(2026, 12, 5),
            token=TOKEN,
        )
        == f"Hi Rahul, rent of ₹1,05,000 for Sunrise HSR was due on 5 Dec 2026. Pay here: {url}"
    )
    assert (
        whatsapp.invoice_text(
            full_name="Anika Rao",
            invoice_no="INV-000123",
            amount_paise=6_000_00,
            due_date=date(2027, 1, 10),
            token=TOKEN,
        )
        == f"Hi Anika, your rent invoice INV-000123 of ₹6,000 is due on 10 Jan 2027: {url}"
    )
    assert (
        whatsapp.settlement_text(full_name="  Anika Rao ", property_name="Sunrise HSR", token=TOKEN)
        == f"Hi Anika, your deposit settlement for Sunrise HSR: {url}"
    )


@pytest.mark.ac("BE-35", "AC2", "AC3")
def test_one_off_invoice_returns_invoice_message(w):
    resident, phone = _resident(w, "Meera Iyer")
    due = w.today + timedelta(days=7)
    inv = _one_off(w, resident, 1_500_50, due)
    url = f"{_base()}/receipt/{_token(inv['id'], w)}"
    assert inv["invoice_url"] == url
    assert inv["whatsapp_url"].startswith(f"https://wa.me/91{phone}?text=") and WA.match(inv["whatsapp_url"])
    assert _text(inv["whatsapp_url"]) == (
        f"Hi Meera, your rent invoice {inv['invoice_no']} of ₹1,500.50 is due on {whatsapp.format_date(due)}: {url}"
    )


@pytest.mark.ac("BE-35", "AC2", "AC3")
def test_dues_and_ledger_return_the_reminder(w):
    resident, phone = _resident(w, "Kiran Rao")
    old = _one_off(w, resident, 5_000_00, w.today - timedelta(days=20))
    newer = _one_off(w, resident, 3_000_00, w.today - timedelta(days=5))
    with as_user(w.owner, w.org) as cur:  # covers the oldest invoice: the reminder points at the newer one
        cur.execute(
            """INSERT INTO payments (org_id, property_id, resident_id, amount_paise, method)
               VALUES (%s, %s, %s, 5_000_00, 'cash')""",
            (w.org, w.prop_a, resident),
        )
    expected = (
        f"Hi Kiran, rent of ₹3,000 for Sunrise HSR was due on {whatsapp.format_date(w.today - timedelta(days=5))}. "
        f"Pay here: {_base()}/receipt/{_token(newer['id'], w)}"
    )
    assert old["id"] != newer["id"]
    for headers in (w.owner_h, w.ct_a_h):
        rows = client.get("/api/v1/dues", headers=headers).json()
        row = next(d for d in rows if d["resident_id"] == resident)
        assert row["whatsapp_url"].startswith(f"https://wa.me/91{phone}?text=") and WA.match(row["whatsapp_url"])
        assert _text(row["whatsapp_url"]) == expected

    ledger = client.get(f"/api/v1/residents/{resident}/ledger", headers=w.owner_h).json()
    assert _text(ledger["whatsapp_url"]) == expected

    settled, _ = _resident(w, "Nothing Owed")
    assert client.get(f"/api/v1/residents/{settled}/ledger", headers=w.owner_h).json()["whatsapp_url"] is None


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-35", "AC3")
def test_links_are_wa_me_with_91_and_url_encoded_text():
    text = "Hi Anika, received ₹10,500 (UPI) for Sri Sai PG & Co. Receipt: https://x.in/receipt/abc?y=1#z"
    link = whatsapp.wa_link("9876543210", text)
    assert link.startswith("https://wa.me/919876543210?text=Hi%20Anika%2C%20received%20%E2%82%B910%2C500")
    assert WA.match(link) and "&" not in link.split("?text=", 1)[1] and "#" not in link
    assert _text(link) == text
