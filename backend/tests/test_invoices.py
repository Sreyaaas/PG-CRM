"""BE-30: invoices (monthly generation), dues and the resident ledger.

Dates are relative to today (IST) so the tests hold on any day: "this month" is the current calendar month.
"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from conftest import BASE_RENT, World, api_client, as_user, rand_phone, rand_utr

from app import billing
from app.security import create_access_token

client = api_client()
IST = ZoneInfo("Asia/Kolkata")


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


def _today(w) -> date:
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT app.today_ist() AS d")
        return cur.fetchone()["d"]


def _add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)
    world.ct_b_h = _h(world.caretaker_b, world.org)
    world.today = _today(world)
    world.this_month = billing.month_start(world.today)
    return world


def _stay(w, check_in: date, rent=BASE_RENT, bed=None, resident=None, **cols) -> str:
    values = {
        "org_id": w.org,
        "property_id": w.prop_a,
        "resident_id": resident or w.resident_a,
        "bed_id": bed or w.bed_a1,
        "stay_type": "monthly",
        "rent_paise": rent,
        "check_in_date": check_in,
    } | cols
    with as_user(w.owner, w.org) as cur:  # owners may backdate
        cur.execute(
            f"INSERT INTO stays ({', '.join(values)}) VALUES ({', '.join(['%s'] * len(values))}) RETURNING id",
            list(values.values()),
        )
        return cur.fetchone()["id"]


def _resident(w, name="Arjun S") -> str:
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "INSERT INTO residents (org_id, property_id, full_name, phone) VALUES (%s, %s, %s, %s) RETURNING id",
            (w.org, w.prop_a, name, rand_phone()),
        )
        return cur.fetchone()["id"]


def _generate(w, month: date, headers=None, **body):
    r = client.post(
        "/api/v1/invoices/generate-due", json={"month": f"{month:%Y-%m}"} | body, headers=headers or w.owner_h
    )
    assert r.status_code == 200, r.text
    return r.json()["created"]


def _rent_invoices(w, stay) -> list[dict]:
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """SELECT period_start, period_end, amount_paise, due_date, invoice_no, created_by FROM invoices
                WHERE stay_id = %s AND kind = 'rent' AND voided_at IS NULL ORDER BY period_start""",
            (stay,),
        )
        return cur.fetchall()


def _pay(w, resident, amount, when: date, method="cash"):
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """INSERT INTO payments (org_id, property_id, resident_id, amount_paise, method, utr_number, received_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (
                w.org,
                w.prop_a,
                resident,
                amount,
                method,
                None if method == "cash" else rand_utr(),
                datetime.combine(when, time(11, 0), IST),
            ),
        )
        return cur.fetchone()["id"]


def _one_off(w, resident, amount, due: date, headers=None, notes="Broken chair"):
    return client.post(
        "/api/v1/invoices",
        json={"resident_id": str(resident), "amount_paise": amount, "due_date": due.isoformat(), "notes": notes},
        headers=headers or w.owner_h,
    )


def _dues(w, headers=None, **params) -> dict[str, dict]:
    r = client.get("/api/v1/dues", params=params, headers=headers or w.owner_h)
    assert r.status_code == 200, r.text
    return {d["resident_id"]: d for d in r.json()}


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-30", "AC1")
def test_first_month_rent():
    assert billing.first_month_rent(10_500_00, date(2026, 11, 18)) == 4_550_00  # 13 of 30 days
    assert billing.first_month_rent(10_500_00, date(2026, 11, 1)) == 10_500_00  # the 1st: full month
    rent = 10_000_00
    assert billing.first_month_rent(rent, date(2027, 1, 31)) == billing.round_to_rupee(rent, 31) == 323_00
    assert billing.first_month_rent(rent, date(2028, 2, 29)) == billing.round_to_rupee(rent, 29) == 345_00  # leap


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-30", "AC2")
def test_generate_two_months_then_rerun_creates_nothing(w):
    m0 = _add_months(w.this_month, -1)  # checked in on the 18th of last month
    stay = _stay(w, m0.replace(day=18))
    assert _generate(w, m0) == 0  # the check-in month is the pro-rata invoice's job (BE-22)

    m1, m2 = _add_months(m0, 1), _add_months(m0, 2)
    assert _generate(w, m1) == 1
    assert _generate(w, m2) == 1
    assert _generate(w, m1) == 0 and _generate(w, m2) == 0  # safe to re-run

    rows = _rent_invoices(w, stay)
    assert [(r["period_start"], r["period_end"], r["amount_paise"], r["due_date"]) for r in rows] == [
        (m1, billing.month_end(m1), BASE_RENT, m1.replace(day=5)),
        (m2, billing.month_end(m2), BASE_RENT, m2.replace(day=5)),
    ]
    assert all(r["invoice_no"].startswith("INV-") for r in rows)


@pytest.mark.ac("BE-30", "AC2")
def test_generate_defaults_to_this_month_and_respects_access(w):
    stay = _stay(w, _add_months(w.this_month, -2))
    r = client.post("/api/v1/invoices/generate-due", json={}, headers=w.ct_b_h)  # building B's caretaker
    assert r.status_code == 200 and r.json() == {"month": f"{w.this_month:%Y-%m}", "created": 0}
    r = client.post("/api/v1/invoices/generate-due", json={"property_id": str(w.prop_a)}, headers=w.ct_a_h)
    assert r.json() == {"month": f"{w.this_month:%Y-%m}", "created": 1}
    assert _rent_invoices(w, stay)[0]["created_by"] == w.caretaker_a
    bad = client.post("/api/v1/invoices/generate-due", json={"month": "2026-13"}, headers=w.owner_h)
    assert bad.status_code == 422


def test_short_term_and_vacated_stays_are_not_billed(w):
    last = _add_months(w.this_month, -1)
    _stay(w, last, stay_type="short_term", expected_vacate_date=last + timedelta(days=3))
    other = _stay(w, _add_months(w.this_month, -3), bed=w.bed_a2, resident=_resident(w))
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "UPDATE stays SET status = 'vacated', actual_vacate_date = %s WHERE id = %s",
            (_add_months(w.this_month, -1) - timedelta(days=1), other),
        )
    assert _generate(w, w.this_month) == 0


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-30", "AC3")
def test_rent_due_day_sets_the_due_date(w):
    stay = _stay(w, _add_months(w.this_month, -1))
    client.patch(f"/api/v1/properties/{w.prop_a}", json={"rent_due_day": 10}, headers=w.owner_h)
    nxt = _add_months(w.this_month, 1)
    assert _generate(w, nxt) == 1
    assert _rent_invoices(w, stay)[-1]["due_date"] == nxt.replace(day=10)


# ---- AC4 / AC5 --------------------------------------------------------------------------------------


def _give_notice(w, stay, notice_day: int) -> date:
    notice = w.this_month.replace(day=notice_day)
    last_day = billing.notice_last_day(notice, 5)  # property deadline: the 5th (default)
    with as_user(w.owner, w.org) as cur:  # the owner may set any notice date
        cur.execute(
            "UPDATE stays SET status = 'on_notice', notice_given_on = %s, expected_vacate_date = %s WHERE id = %s",
            (notice, last_day, stay),
        )
    return last_day


@pytest.mark.ac("BE-30", "AC4")
def test_notice_by_the_deadline_skips_next_month(w):
    stay = _stay(w, _add_months(w.this_month, -2))
    assert _give_notice(w, stay, 5) == billing.month_end(w.this_month)
    assert _generate(w, _add_months(w.this_month, 1)) == 0  # leaves at the end of this month


@pytest.mark.ac("BE-30", "AC4")
def test_notice_after_the_deadline_bills_one_more_full_month(w):
    stay = _stay(w, _add_months(w.this_month, -2))
    nxt = _add_months(w.this_month, 1)
    assert _give_notice(w, stay, 6) == billing.month_end(nxt)
    assert _generate(w, nxt) == 1  # the full next month
    assert _rent_invoices(w, stay)[-1]["amount_paise"] == BASE_RENT
    assert _generate(w, _add_months(w.this_month, 2)) == 0  # nothing after it


@pytest.mark.ac("BE-30", "AC5")
def test_overstay_is_billed_once_the_month_has_started(w):
    stay = _stay(w, _add_months(w.this_month, -3))
    last_day = _add_months(w.this_month, 0) - timedelta(days=1)  # their last day was the end of last month
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "UPDATE stays SET status = 'on_notice', notice_given_on = %s, expected_vacate_date = %s WHERE id = %s",
            (_add_months(w.this_month, -1).replace(day=3), last_day, stay),
        )
    assert _generate(w, w.this_month) == 1  # still here: billed as normal
    assert _rent_invoices(w, stay)[-1]["period_start"] == w.this_month


# ---- AC6 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-30", "AC6")
def test_days_overdue_counts_from_the_day_after_due(w):
    on_time = _resident(w, "Due Today")
    late = _resident(w, "Due Yesterday")
    assert _one_off(w, on_time, 6_000_00, w.today).status_code == 201
    assert _one_off(w, late, 6_000_00, w.today - timedelta(days=1)).status_code == 201
    d = _dues(w)
    assert (d[str(on_time)]["days_overdue"], d[str(on_time)]["oldest_due_date"]) == (0, w.today.isoformat())
    assert d[str(late)]["days_overdue"] == 1
    assert d[str(late)]["outstanding_paise"] == 6_000_00 and d[str(late)]["phone"]
    assert list(d)[0] == str(late)  # most overdue first


@pytest.mark.ac("BE-30", "AC6")
def test_void_invoices_and_payments_reduce_dues(w):
    r = _resident(w, "Partly Paid")
    old = _one_off(w, r, 5_000_00, w.today - timedelta(days=20)).json()
    _one_off(w, r, 3_000_00, w.today - timedelta(days=5))
    assert _dues(w)[str(r)]["outstanding_paise"] == 8_000_00

    _pay(w, r, 5_000_00, w.today)  # covers the oldest invoice first
    d = _dues(w)[str(r)]
    assert d["outstanding_paise"] == 3_000_00 and d["days_overdue"] == 5

    voided = _resident(w, "Voided Only")
    v = _one_off(w, voided, 2_000_00, w.today - timedelta(days=9)).json()
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "UPDATE invoices SET voided_at = now(), void_reason = 'Charged by mistake' WHERE id = %s", (v["id"],)
        )
    assert str(voided) not in _dues(w)
    assert old["invoice_no"].startswith("INV-")


def test_dues_property_filter_and_caretaker_scope(w):
    r = _resident(w, "Building A")
    _one_off(w, r, 1_000_00, w.today)
    assert str(r) in _dues(w, property_id=str(w.prop_a))
    assert str(r) not in _dues(w, property_id=str(w.prop_b))
    assert str(r) in _dues(w, headers=w.ct_a_h)
    assert str(r) not in _dues(w, headers=w.ct_b_h)


# ---- AC7 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-30", "AC7")
def test_ledger_in_date_order_with_running_balance(w):
    r = _resident(w, "Ledger Person")
    base = w.today - timedelta(days=40)
    _one_off(w, r, 4_000_00, base, notes="Key replacement")
    _pay(w, r, 1_500_00, base + timedelta(days=3))
    v = _one_off(w, r, 9_999_00, base + timedelta(days=4)).json()
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE invoices SET voided_at = now(), void_reason = 'Wrong resident' WHERE id = %s", (v["id"],))
    _one_off(w, r, 2_000_00, base + timedelta(days=10), notes="Late fee")
    _pay(w, r, 500_00, base + timedelta(days=12), method="upi")

    res = client.get(f"/api/v1/residents/{r}/ledger", headers=w.owner_h)
    assert res.status_code == 200, res.text
    led = res.json()
    rows = [(e["type"], e["amount_paise"], e["voided"], e["balance_paise"]) for e in led["entries"]]
    assert rows == [
        ("invoice", 4_000_00, False, 4_000_00),
        ("payment", -1_500_00, False, 2_500_00),
        ("invoice", 9_999_00, True, 2_500_00),  # listed, not counted
        ("invoice", 2_000_00, False, 4_500_00),
        ("payment", -500_00, False, 4_000_00),
    ]
    assert [e["entry_date"] for e in led["entries"]] == sorted(e["entry_date"] for e in led["entries"])
    assert led["outstanding_paise"] == 4_000_00 == _dues(w)[str(r)]["outstanding_paise"]
    assert led["entries"][0]["description"] == "Key replacement"
    assert led["entries"][1]["description"] == "Payment (Cash)" and led["entries"][4]["reference"].startswith("upi")
    assert client.get(f"/api/v1/residents/{r}/ledger", headers=w.ct_b_h).status_code == 404


def test_ledger_describes_rent_months(w):
    stay = _stay(w, _add_months(w.this_month, -1))
    _generate(w, w.this_month)
    led = client.get(f"/api/v1/residents/{w.resident_a}/ledger", headers=w.owner_h).json()
    assert led["entries"][-1]["description"] == f"Rent, {w.this_month:%B %Y}"
    assert _rent_invoices(w, stay)


# ---- AC8 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-30", "AC8")
def test_caretaker_one_off_invoice_is_403(w):
    r = _one_off(w, w.resident_a, 1_000_00, w.today, headers=w.ct_a_h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    ok = _one_off(w, w.resident_a, 1_000_00, w.today)
    assert ok.status_code == 201 and ok.json()["kind"] == "other" and ok.json()["created_by"] == str(w.owner)
    assert _one_off(w, w.resident_a, 1_000_00, w.today, notes="x").status_code == 422
    missing = _one_off(w, "00000000-0000-0000-0000-000000000000", 1_000_00, w.today)
    assert missing.status_code == 404
