"""BE-41: caretaker cash balances and owner handovers."""

import pytest
from conftest import World, api_client, as_user

from app.security import create_access_token

client = api_client()


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)  # Ravi, building A
    world.ct_b_h = _h(world.caretaker_b, world.org)  # Suresh, building B
    return world


def _cash(w, amount_paise: int) -> str:
    r = client.post(
        "/api/v1/payments",
        json={"resident_id": str(w.resident_a), "amount_paise": amount_paise, "method": "cash"},
        headers=w.ct_a_h,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _cash_expense(w, amount_paise: int, category="groceries") -> str:
    with as_user(w.caretaker_a, w.org) as cur:
        cur.execute(
            """INSERT INTO expenses (org_id, property_id, category, amount_paise, expense_date, bill_mode,
                                     proof_path, paid_from, created_by)
               VALUES (%s, %s, %s, %s, app.today_ist(), 'has_bill', 'bills/x.jpg', 'caretaker_cash', %s)
               RETURNING id""",
            (w.org, w.prop_a, category, amount_paise, w.caretaker_a),
        )
        return str(cur.fetchone()["id"])


def _handover(w, amount_paise: int, caretaker=None, headers=None, **extra):
    body = {"caretaker_user_id": str(caretaker or w.caretaker_a), "amount_paise": amount_paise} | extra
    return client.post("/api/v1/cash/handovers", json=body, headers=headers or w.owner_h)


def _balances(w, headers=None) -> dict[str, dict]:
    r = client.get("/api/v1/cash/balances", headers=headers or w.owner_h)
    assert r.status_code == 200, r.text
    return {b["user_id"]: b for b in r.json()}


def _ledger(w, caretaker=None, headers=None):
    params = {"caretaker_user_id": str(caretaker)} if caretaker else {}
    return client.get("/api/v1/cash/ledger", params=params, headers=headers or w.owner_h)


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-41", "AC1")
def test_collected_minus_spent_minus_handed_over(w):
    _cash(w, 80_000_00)
    _cash_expense(w, 3_000_00)
    r = _handover(w, 70_000_00, notes="Collected at the office")
    assert r.status_code == 201, r.text
    h = r.json()
    assert (h["in_hand_paise"], h["warning"], h["caretaker_name"], h["recorded_by_name"]) == (
        700000,
        None,
        "Ravi",
        "Owner",
    )
    assert h["recorded_by"] == str(w.owner) and h["notes"] == "Collected at the office"

    ravi = _balances(w)[str(w.caretaker_a)]
    assert ravi == {
        "user_id": str(w.caretaker_a),
        "full_name": "Ravi",
        "collected_paise": 80_000_00,
        "spent_paise": 3_000_00,
        "handed_over_paise": 70_000_00,
        "in_hand_paise": 700000,
    }
    assert _balances(w)[str(w.caretaker_b)]["in_hand_paise"] == 0


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-41", "AC2")
def test_caretaker_sees_only_their_own_and_cannot_record_handovers(w):
    _cash(w, 5_000_00)
    assert _handover(w, 1_000_00).status_code == 201
    assert _handover(w, 2_000_00, caretaker=w.caretaker_b).status_code == 201

    assert list(_balances(w, w.ct_a_h)) == [str(w.caretaker_a)]
    assert list(_balances(w, w.ct_b_h)) == [str(w.caretaker_b)]

    r = _handover(w, 4_000_00, headers=w.ct_a_h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert _balances(w)[str(w.caretaker_a)]["in_hand_paise"] == 4_000_00

    mine = client.get("/api/v1/cash/handovers", headers=w.ct_a_h).json()
    assert [x["amount_paise"] for x in mine] == [1_000_00]
    asked_for_b = client.get(
        "/api/v1/cash/handovers", params={"caretaker_user_id": str(w.caretaker_b)}, headers=w.ct_a_h
    ).json()
    assert asked_for_b == []
    assert len(client.get("/api/v1/cash/handovers", headers=w.owner_h).json()) == 2
    only_b = client.get("/api/v1/cash/handovers", params={"caretaker_user_id": str(w.caretaker_b)}, headers=w.owner_h)
    assert [x["caretaker_name"] for x in only_b.json()] == ["Suresh"]

    assert _ledger(w, w.caretaker_b, w.ct_a_h).status_code == 404
    assert _ledger(w, headers=w.ct_a_h).json()["user_id"] == str(w.caretaker_a)  # defaults to the caller


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-41", "AC3")
def test_ledger_in_order_with_running_balance(w):
    _cash(w, 80_000_00)
    _cash_expense(w, 3_000_00, category="water_tanker")
    _handover(w, 70_000_00, notes="Week 1")
    _cash(w, 9_000_00)

    r = _ledger(w, w.caretaker_a)
    assert r.status_code == 200, r.text
    ledger = r.json()
    rows = [(e["type"], e["description"], e["amount_paise"], e["balance_paise"]) for e in ledger["entries"]]
    assert rows == [
        ("payment", "Cash from Anika Rao", 80_000_00, 80_000_00),
        ("expense", "Water tanker", -3_000_00, 77_000_00),
        ("handover", "Handed over to the owner", -70_000_00, 7_000_00),
        ("payment", "Cash from Anika Rao", 9_000_00, 16_000_00),
    ]
    assert ledger["entries"][0]["property_name"] == "Sunrise HSR" and ledger["entries"][2]["notes"] == "Week 1"
    times = [e["entry_at"] for e in ledger["entries"]]
    assert times == sorted(times)
    assert ledger["in_hand_paise"] == _balances(w)[str(w.caretaker_a)]["in_hand_paise"] == 16_000_00
    assert _ledger(w, headers=w.ct_a_h).json() == ledger  # Ravi sees the same ledger


@pytest.mark.ac("BE-41", "AC3")
def test_ledger_still_adds_up_after_the_caretaker_changes_building(w):
    _cash(w, 6_000_00)  # collected in building A
    r = client.patch(
        f"/api/v1/staff/{w.caretaker_a}", json={"assigned_property_ids": [str(w.prop_b)]}, headers=w.owner_h
    )
    assert r.status_code == 200, r.text
    ledger = _ledger(w, headers=w.ct_a_h).json()
    assert [e["amount_paise"] for e in ledger["entries"]] == [6_000_00]
    assert ledger["in_hand_paise"] == _balances(w, w.ct_a_h)[str(w.caretaker_a)]["in_hand_paise"] == 6_000_00


def test_ledger_of_someone_who_is_not_a_caretaker_is_404(w):
    assert _ledger(w).status_code == 404  # the owner has no cash ledger
    assert _ledger(w, "00000000-0000-0000-0000-000000000000").status_code == 404


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-41", "AC4")
def test_voided_cash_payment_and_expense_drop_out(w):
    keep = _cash(w, 10_000_00)
    twice = _cash(w, 10_000_00)
    expense = _cash_expense(w, 1_000_00)
    assert _balances(w)[str(w.caretaker_a)]["in_hand_paise"] == 19_000_00

    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE payments SET voided_at = now(), void_reason = 'Logged twice' WHERE id = %s", (twice,))
    ravi = _balances(w)[str(w.caretaker_a)]
    assert (ravi["collected_paise"], ravi["in_hand_paise"]) == (10_000_00, 9_000_00)

    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE expenses SET voided_at = now(), void_reason = 'Wrong entry' WHERE id = %s", (expense,))
    assert _balances(w)[str(w.caretaker_a)]["in_hand_paise"] == 10_000_00

    entries = _ledger(w, w.caretaker_a).json()["entries"]
    voided = {e["id"]: e for e in entries if e["voided"]}
    assert set(voided) == {twice, expense}
    assert [e["balance_paise"] for e in entries] == [10_000_00, 10_000_00, 10_000_00]
    assert next(e for e in entries if e["id"] == keep)["voided"] is False


# ---- AC5 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-41", "AC5")
def test_handover_larger_than_balance_succeeds_with_a_warning(w):
    _cash(w, 5_000_00)
    r = _handover(w, 15_000_00, notes="Settling last month's advance")
    assert r.status_code == 201, r.text
    assert r.json()["in_hand_paise"] == -10_000_00
    assert r.json()["warning"] == "This is ₹10,000 more than Ravi had in hand (₹5,000). Recorded anyway."
    assert _balances(w)[str(w.caretaker_a)]["in_hand_paise"] == -10_000_00


# ---- Validation -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [{"amount_paise": 0}, {"amount_paise": -100}, {"recorded_by": "x"}, {"handed_over_at": "2026-01-01T00:00:00Z"}],
)
def test_bad_handover_bodies_are_422(w, body):
    r = client.post(
        "/api/v1/cash/handovers",
        json={"caretaker_user_id": str(w.caretaker_a), "amount_paise": 100} | body,
        headers=w.owner_h,
    )
    assert r.status_code == 422


def test_handover_from_someone_who_is_not_a_caretaker_is_422(w):
    r = _handover(w, 1_000_00, caretaker=w.owner)
    assert r.status_code == 422
    assert r.json()["error"]["message"] == "Handover must be from a caretaker of this organization"
