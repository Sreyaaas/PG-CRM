"""BE-43: owner dashboard (P&L, occupancy, attention counts)."""

from dataclasses import dataclass
from datetime import date, timedelta

import pytest
from conftest import BASE_RENT, World, api_client, as_user, rand_phone, rand_utr
from psycopg.types.json import Jsonb
from test_onboarding_queue import submit

from app.security import create_access_token

client = api_client()
URL = "/api/v1/dashboard"


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)
    world.ct_b_h = _h(world.caretaker_b, world.org)
    return world


def _today(w) -> date:
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT app.today_ist() AS d")
        return cur.fetchone()["d"]


def _get(w, headers=None, **params):
    return client.get(URL, params=params, headers=headers or w.owner_h)


def _bed(w, prop, label: str, active=True) -> str:
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT id FROM rooms WHERE property_id = %s LIMIT 1", (prop,))
        room = cur.fetchone()
        if room is None:
            cur.execute(
                "INSERT INTO rooms (org_id, property_id, label, sharing) VALUES (%s, %s, 'G1', 4) RETURNING id",
                (w.org, prop),
            )
            room = cur.fetchone()
        cur.execute(
            """INSERT INTO beds (org_id, property_id, room_id, label, base_rent_paise, is_active)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
            (w.org, prop, room["id"], label, BASE_RENT, active),
        )
        return str(cur.fetchone()["id"])


def _resident(w, prop, name: str) -> str:
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "INSERT INTO residents (org_id, property_id, full_name, phone) VALUES (%s, %s, %s, %s) RETURNING id",
            (w.org, prop, name, rand_phone()),
        )
        return str(cur.fetchone()["id"])


def _stay(w, prop, bed, resident, status="active", check_in=None) -> str:
    """Owner-created (owners may backdate), then moved to the status through the owner's own updates."""
    today = _today(w)
    reserved = status == "reserved"
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, status, rent_paise,
                                  check_in_date)
               VALUES (%s, %s, %s, %s, 'monthly', %s, %s, %s) RETURNING id""",
            (
                w.org, prop, resident, bed, "reserved" if reserved else "active", BASE_RENT,
                check_in or (today + timedelta(days=5) if reserved else today - timedelta(days=60)),
            ),
        )  # fmt: skip
        return str(cur.fetchone()["id"])


def _notice(w, stay, vacate_on: date) -> None:
    with as_user(w.owner, w.org) as cur:  # owners may set any notice dates (audited)
        cur.execute(
            """UPDATE stays SET status = 'on_notice', notice_given_on = %s, expected_vacate_date = %s
                WHERE id = %s""",
            (vacate_on - timedelta(days=20), vacate_on, stay),
        )


def _move_out(w, stay, on: date) -> None:
    r = client.post(f"/api/v1/stays/{stay}/move-out", json={"actual_vacate_date": on.isoformat()}, headers=w.owner_h)
    assert r.status_code == 200, r.text


def _payment(w, amount_paise, method="upi", status="provisional", days_ago=0, prop=None, resident=None, utr=None):
    """Owner insert, so received_at can be backdated. Status changes go through the owner's allowed update."""
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """INSERT INTO payments (org_id, property_id, resident_id, amount_paise, method, utr_number, status,
                                     received_by, received_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now() - make_interval(days => %s)) RETURNING id""",
            (
                w.org, prop or w.prop_a, resident or w.resident_a, amount_paise, method,
                None if method == "cash" else (utr or rand_utr()),
                "recorded" if method == "cash" else "provisional", w.owner, days_ago,
            ),
        )  # fmt: skip
        pid = cur.fetchone()["id"]
        if status not in ("provisional", "recorded"):
            cur.execute("UPDATE payments SET status = %s WHERE id = %s", (status, pid))
        return str(pid)


def _statement_row(w, utr: str, amount_paise: int) -> None:
    """A statement line for this UTR that matched nothing (the payment is logged later)."""
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "INSERT INTO csv_imports (org_id, source, file_name) VALUES (%s, 'paytm_business', 's.csv') RETURNING id",
            (w.org,),
        )
        imp = cur.fetchone()["id"]
        cur.execute(
            """INSERT INTO csv_import_rows (org_id, import_id, utr_number, amount_paise, txn_at, raw, match)
               VALUES (%s, %s, %s, %s, now() - interval '6 days', %s, 'unmatched')""",
            (w.org, imp, utr, amount_paise, Jsonb({"utr": utr})),
        )


def _expense(w, amount_paise, prop=None, no_bill=False, as_owner=False) -> str:
    user = w.owner if as_owner else (w.caretaker_a if (prop or w.prop_a) == w.prop_a else w.caretaker_b)
    with as_user(user, w.org) as cur:
        cur.execute(
            """INSERT INTO expenses (org_id, property_id, category, amount_paise, expense_date, bill_mode, notes,
                                     proof_path, proof_captured_at, proof_lat, proof_lng, paid_from)
               VALUES (%s, %s, 'water_tanker', %s, app.today_ist(), %s, 'Two tankers, borewell dry', 'bills/x.jpg',
                       now(), 12.9116, 77.6474, %s)
               RETURNING id""",
            (
                w.org, prop or w.prop_a, amount_paise, "no_bill" if no_bill else "has_bill",
                "owner_direct" if as_owner else "caretaker_cash",
            ),
        )  # fmt: skip
        return str(cur.fetchone()["id"])


def _discount(w, bed, headers) -> str:
    r = client.post(
        "/api/v1/discount-requests",
        json={"bed_id": str(bed), "requested_rent_paise": BASE_RENT - 500_00, "reason": "Paying 6 months upfront"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


@dataclass
class Scenario:
    today: date
    expected_pnl: list[dict]
    expected_occupancy: list[dict]
    expected_attention: dict


@pytest.fixture
def scenario(w) -> Scenario:
    """Building A "Sunrise HSR" and building B "Lakeview BTM" with a little of everything."""
    today = _today(w)

    # ---- Beds and stays ----
    # A: 101-A on notice and 2 days past its date (overstaying), 101-B reserved, A-3 occupied, A-4 vacant,
    #    A-5 retired (inactive, not counted).
    overstay = _stay(w, w.prop_a, w.bed_a1, w.resident_a)
    _notice(w, overstay, today - timedelta(days=2))
    _stay(w, w.prop_a, w.bed_a2, _resident(w, w.prop_a, "Rahul K"), status="reserved")
    _stay(w, w.prop_a, _bed(w, w.prop_a, "A-3"), _resident(w, w.prop_a, "Divya S"))
    _bed(w, w.prop_a, "A-4")
    _bed(w, w.prop_a, "A-5", active=False)
    # B: B-1 on notice, leaving today (not overstaying yet), B-2 overstayed but has moved out (vacant),
    #    B-3 on notice, 10 days past its date (overstaying).
    leaving = _stay(w, w.prop_b, _bed(w, w.prop_b, "B-1"), _resident(w, w.prop_b, "Meera N"))
    _notice(w, leaving, today)
    gone = _stay(w, w.prop_b, _bed(w, w.prop_b, "B-2"), _resident(w, w.prop_b, "Arjun P"))
    _notice(w, gone, today - timedelta(days=5))
    _move_out(w, gone, today - timedelta(days=1))
    late = _stay(w, w.prop_b, _bed(w, w.prop_b, "B-3"), _resident(w, w.prop_b, "Farhan Q"))
    _notice(w, late, today - timedelta(days=10))

    # ---- Payments (building A unless stated) ----
    r = client.post(
        "/api/v1/payments",
        json={"resident_id": str(w.resident_a), "amount_paise": 20_000_00, "method": "cash"},
        headers=w.ct_a_h,
    )
    assert r.status_code == 201, r.text  # Ravi's cash in hand +20,000
    _payment(w, 9_000_00, status="verified", days_ago=2)
    _payment(w, 5_000_00, days_ago=5)  # provisional, never seen in a statement: counted
    _payment(w, 4_000_00, days_ago=1)  # provisional but too recent: not counted
    seen_utr = rand_utr()
    _statement_row(w, seen_utr, 3_000_00)
    _payment(w, 3_000_00, days_ago=5, utr=seen_utr)  # provisional but its UTR is in a statement: not counted
    _payment(w, 7_000_00, status="flagged", days_ago=4)
    _payment(w, 6_000_00, status="flagged", days_ago=6, prop=w.prop_b, resident=_resident(w, w.prop_b, "Zoya R"))

    # ---- Expenses (all today) ----
    _expense(w, 3_000_00)  # Ravi, with bill
    _expense(w, 2_400_00, no_bill=True)  # Ravi, no bill: flagged
    reviewed = _expense(w, 1_000_00, no_bill=True)  # Ravi, no bill, then reviewed by the owner
    r = client.post(f"/api/v1/expenses/{reviewed}/review", json={"note": "Checked"}, headers=w.owner_h)
    assert r.status_code == 200, r.text
    _expense(w, 500_00, prop=w.prop_b, no_bill=True)  # Suresh, no bill: flagged
    _expense(w, 1_500_00, prop=w.prop_b, as_owner=True)  # owner paid directly: not caretaker cash

    # ---- Cash handover: Ravi had 20,000 - 3,000 - 2,400 - 1,000 = 13,600; hands over 10,000 ----
    r = client.post(
        "/api/v1/cash/handovers", json={"caretaker_user_id": str(w.caretaker_a), "amount_paise": 10_000_00},
        headers=w.owner_h,
    )  # fmt: skip
    assert r.status_code == 201, r.text
    # Suresh: 0 - 500 = -500

    # ---- Onboarding: 2 pending (one per building), 1 rejected ----
    submit(w)
    submit(w, prop=w.prop_b)
    rejected = submit(w)
    r = client.post(f"/api/v1/onboarding-requests/{rejected}/reject", json={"note": "Duplicate"}, headers=w.owner_h)
    assert r.status_code == 200, r.text

    # ---- Discount requests: 2 pending, 1 approved ----
    _discount(w, w.bed_a1, w.ct_a_h)
    _discount(w, w.bed_a2, w.ct_a_h)
    approved = _discount(w, w.bed_a2, w.ct_a_h)
    r = client.post(f"/api/v1/discount-requests/{approved}/decide", json={"decision": "approved"}, headers=w.owner_h)
    assert r.status_code == 200, r.text

    return Scenario(
        today=today,
        expected_pnl=[
            {
                "property_id": str(w.prop_b),
                "property_name": "Lakeview BTM",
                "collected_verified_paise": 0,
                "collected_cash_paise": 0,
                "provisional_paise": 0,
                "flagged_paise": 6_000_00,
                "expenses_paise": 2_000_00,
                "net_paise": -2_000_00,
            },
            {
                "property_id": str(w.prop_a),
                "property_name": "Sunrise HSR",
                "collected_verified_paise": 9_000_00,
                "collected_cash_paise": 20_000_00,
                "provisional_paise": 12_000_00,
                "flagged_paise": 7_000_00,
                "expenses_paise": 6_400_00,
                "net_paise": 22_600_00,
            },
        ],
        expected_occupancy=[
            {
                "property_id": str(w.prop_b),
                "name": "Lakeview BTM",
                "beds_total": 3,
                "vacant": 1,
                "reserved": 0,
                "occupied": 0,
                "on_notice": 2,
            },
            {
                "property_id": str(w.prop_a),
                "name": "Sunrise HSR",
                "beds_total": 4,
                "vacant": 1,
                "reserved": 1,
                "occupied": 1,
                "on_notice": 1,
            },
        ],
        expected_attention={
            "pending_onboarding": 2,
            "pending_discounts": 2,
            "flagged_expenses_unreviewed": 2,
            "provisional_payments_older_than_3_days": 1,
            "flagged_payments": 2,
            "cash_in_hand_total_paise": 3_600_00 - 500_00,
            "overstaying_residents": 2,
        },
    )


def _period(s: Scenario) -> dict:
    return {"from": (s.today - timedelta(days=30)).isoformat(), "to": s.today.isoformat()}


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-43", "AC1")
def test_caretaker_gets_403(w):
    for headers in (w.ct_a_h, w.ct_b_h):
        r = _get(w, headers=headers)
        assert r.status_code == 403, r.text
        assert r.json()["error"]["code"] == "forbidden"
    assert _get(w).status_code == 200


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-43", "AC2")
def test_known_scenario_numbers(w, scenario: Scenario):
    r = _get(w, **_period(scenario))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["pnl"] == scenario.expected_pnl
    assert d["occupancy"] == scenario.expected_occupancy
    assert d["attention"] == scenario.expected_attention


@pytest.mark.ac("BE-43", "AC2")
def test_period_filters_pnl_and_defaults_to_this_month_ist(w, scenario: Scenario):
    first = scenario.today.replace(day=1)
    last = (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    default = _get(w).json()
    assert default == _get(w, **{"from": first.isoformat(), "to": last.isoformat()}).json()

    # Only today: the 20,000 cash and today's expenses. Older payments drop out; counts don't depend on the period.
    only_today = _get(w, **{"from": scenario.today.isoformat(), "to": scenario.today.isoformat()}).json()
    a = next(p for p in only_today["pnl"] if p["property_name"] == "Sunrise HSR")
    assert (a["collected_cash_paise"], a["collected_verified_paise"], a["provisional_paise"], a["flagged_paise"]) == (
        20_000_00,
        0,
        0,
        0,
    )
    assert a["net_paise"] == 20_000_00 - 6_400_00
    assert only_today["attention"] == scenario.expected_attention
    assert only_today["occupancy"] == scenario.expected_occupancy

    r = _get(w, **{"from": scenario.today.isoformat(), "to": (scenario.today - timedelta(days=1)).isoformat()})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid"


@pytest.mark.ac("BE-43", "AC2")
def test_empty_org_is_all_zeros(w):
    d = _get(w).json()
    assert [(p["property_name"], p["net_paise"]) for p in d["pnl"]] == [("Lakeview BTM", 0), ("Sunrise HSR", 0)]
    assert [(o["name"], o["beds_total"], o["vacant"]) for o in d["occupancy"]] == [
        ("Lakeview BTM", 0, 0),
        ("Sunrise HSR", 2, 2),
    ]
    assert set(d["attention"].values()) == {0}


# ---- AC3 --------------------------------------------------------------------------------------------


def _list(w, path: str, **params) -> list:
    r = client.get(f"/api/v1{path}", params=params, headers=w.owner_h)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.ac("BE-43", "AC3")
def test_each_count_equals_the_list_it_links_to(w, scenario: Scenario):
    attention = _get(w).json()["attention"]
    assert attention["pending_onboarding"] == len(_list(w, "/onboarding-requests", status="pending"))
    assert attention["pending_discounts"] == len(_list(w, "/discount-requests", status="pending"))
    assert attention["flagged_expenses_unreviewed"] == len(_list(w, "/expenses", flagged="true", voided="false"))
    assert attention["provisional_payments_older_than_3_days"] == len(
        _list(w, "/reconciliation/unverified-payments", older_than_days=3)
    )
    assert attention["flagged_payments"] == len(_list(w, "/payments", status="flagged", voided="false"))
    assert attention["cash_in_hand_total_paise"] == sum(b["in_hand_paise"] for b in _list(w, "/cash/balances"))
    # No list endpoint for overstaying residents yet: compare with the equivalent query.
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """SELECT count(DISTINCT resident_id) AS n FROM stays
                WHERE status = 'on_notice' AND expected_vacate_date < app.today_ist() AND actual_vacate_date IS NULL"""
        )
        assert attention["overstaying_residents"] == cur.fetchone()["n"]
    # And the scenario really exercises every count (none of them is trivially 0 = 0).
    assert all(v != 0 for v in attention.values())


@pytest.mark.ac("BE-43", "AC3")
def test_counts_follow_the_lists_when_items_are_handled(w, scenario: Scenario):
    """Approve / review / reconcile items and the counts drop exactly as the lists shrink."""
    for d in _list(w, "/discount-requests", status="pending"):
        client.post(f"/api/v1/discount-requests/{d['id']}/decide", json={"decision": "rejected"}, headers=w.owner_h)
    for e in _list(w, "/expenses", flagged="true", voided="false"):
        client.post(f"/api/v1/expenses/{e['id']}/review", json={}, headers=w.owner_h)
    old = _list(w, "/reconciliation/unverified-payments", older_than_days=3)
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE payments SET status = 'verified' WHERE id = %s", (old[0]["id"],))
    attention = _get(w).json()["attention"]
    assert attention["pending_discounts"] == len(_list(w, "/discount-requests", status="pending")) == 0
    assert attention["flagged_expenses_unreviewed"] == len(_list(w, "/expenses", flagged="true", voided="false")) == 0
    assert attention["provisional_payments_older_than_3_days"] == 0
    assert attention["provisional_payments_older_than_3_days"] == len(
        _list(w, "/reconciliation/unverified-payments", older_than_days=3)
    )


@pytest.mark.ac("BE-43", "AC3")
def test_counts_still_equal_the_lists_after_voids(w, scenario: Scenario):
    """BE-44 voids: a void payment or expense needs no attention, so the counts drop, and they still equal the
    lists they link to (`voided=false`). The lists keep void rows by default and `voided=true` finds them."""
    before = _get(w).json()["attention"]
    flagged = _list(w, "/payments", status="flagged", voided="false")[0]
    r = client.post(f"/api/v1/payments/{flagged['id']}/void", json={"reason": "Duplicate entry"}, headers=w.owner_h)
    assert r.status_code == 200, r.text
    old = _list(w, "/reconciliation/unverified-payments", older_than_days=3)[0]
    r = client.post(f"/api/v1/payments/{old['id']}/void", json={"reason": "Never paid"}, headers=w.owner_h)
    assert r.status_code == 200, r.text
    expense = _list(w, "/expenses", flagged="true", voided="false")[0]
    r = client.post(f"/api/v1/expenses/{expense['id']}/void", json={"reason": "Fake bill"}, headers=w.owner_h)
    assert r.status_code == 200, r.text

    attention = _get(w).json()["attention"]
    assert attention["flagged_payments"] == len(_list(w, "/payments", status="flagged", voided="false"))
    assert attention["provisional_payments_older_than_3_days"] == len(
        _list(w, "/reconciliation/unverified-payments", older_than_days=3)
    )
    assert attention["flagged_expenses_unreviewed"] == len(_list(w, "/expenses", flagged="true", voided="false"))
    assert attention["cash_in_hand_total_paise"] == sum(b["in_hand_paise"] for b in _list(w, "/cash/balances"))
    assert attention["flagged_payments"] == before["flagged_payments"] - 1
    assert attention["flagged_expenses_unreviewed"] == before["flagged_expenses_unreviewed"] - 1

    assert flagged["id"] in {p["id"] for p in _list(w, "/payments", status="flagged")}  # still in the ledger
    assert [p["id"] for p in _list(w, "/payments", status="flagged", voided="true")] == [flagged["id"]]
    assert [e["id"] for e in _list(w, "/expenses", flagged="true", voided="true")] == [expense["id"]]


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-43", "AC4")
def test_overstaying_counts_only_on_notice_stays_past_their_date(w):
    today = _today(w)

    def count() -> int:
        return _get(w).json()["attention"]["overstaying_residents"]

    stay = _stay(w, w.prop_a, w.bed_a1, w.resident_a)
    assert count() == 0  # active, no notice
    _notice(w, stay, today)
    assert count() == 0  # last day is today: not over yet
    _notice(w, stay, today - timedelta(days=1))
    assert count() == 1  # yesterday was the last day and they are still here
    other = _stay(w, w.prop_a, w.bed_a2, _resident(w, w.prop_a, "Rahul K"))
    _notice(w, other, today - timedelta(days=30))
    assert count() == 2
    _move_out(w, other, today)
    assert count() == 1  # moved out: no longer overstaying
    r = client.post(f"/api/v1/stays/{stay}/withdraw-notice", headers=w.owner_h)
    assert r.status_code == 200, r.text
    assert count() == 0  # stays on, no longer on notice

    # A short-term stay past its expected date but never put on notice is not "on notice": not counted.
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, status, rent_paise,
                                  check_in_date, expected_vacate_date)
               VALUES (%s, %s, %s, %s, 'short_term', 'active', 800_00, %s, %s)""",
            (
                w.org, w.prop_a, _resident(w, w.prop_a, "Guest"), _bed(w, w.prop_a, "A-9"),
                today - timedelta(days=5), today - timedelta(days=1),
            ),
        )  # fmt: skip
    assert count() == 0
