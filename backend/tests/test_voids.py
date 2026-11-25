"""BE-44: owner voids (invoice / payment / expense), payment verify / flag, and the audit log viewer."""

from datetime import UTC, datetime, timedelta

import pytest
from conftest import World, api_client, as_user, rand_phone, rand_utr

from app.security import create_access_token

client = api_client()


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)  # Ravi, building A (resident_a lives there)
    return world


def _pay(w, method="cash", amount_paise=6_000_00) -> str:
    body = {"resident_id": str(w.resident_a), "amount_paise": amount_paise, "method": method}
    if method != "cash":
        body["utr_number"] = rand_utr()
    r = client.post("/api/v1/payments", json=body, headers=w.ct_a_h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _invoice(w) -> str:
    r = client.post(
        "/api/v1/invoices",
        json={"resident_id": str(w.resident_a), "amount_paise": 500_00, "due_date": _today(), "notes": "Key lost"},
        headers=w.owner_h,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _expense(w, amount_paise=1_000_00) -> str:
    with as_user(w.caretaker_a, w.org) as cur:
        cur.execute(
            """INSERT INTO expenses (org_id, property_id, category, amount_paise, expense_date, bill_mode,
                                     proof_path, paid_from, created_by)
               VALUES (%s, %s, 'groceries', %s, app.today_ist(), 'has_bill', 'bills/x.jpg', 'caretaker_cash', %s)
               RETURNING id""",
            (w.org, w.prop_a, amount_paise, w.caretaker_a),
        )
        return str(cur.fetchone()["id"])


def _today(days=0) -> str:
    return ((datetime.now(UTC) + timedelta(hours=5, minutes=30)).date() + timedelta(days=days)).isoformat()


def _voided_by(w, table: str, row_id: str):
    with as_user(w.owner, w.org) as cur:
        cur.execute(f"SELECT voided_by, voided_at, void_reason FROM {table} WHERE id = %s", (row_id,))
        return cur.fetchone()


def _in_hand(w) -> int:
    r = client.get("/api/v1/cash/balances", headers=w.owner_h)
    assert r.status_code == 200, r.text
    return next(b for b in r.json() if b["user_id"] == str(w.caretaker_a))["in_hand_paise"]


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-44", "AC1")
@pytest.mark.parametrize("kind", ["invoices", "payments", "expenses"])
def test_void_with_reason_once_only(w, kind):
    row_id = {"invoices": _invoice, "payments": _pay, "expenses": _expense}[kind](w)
    url = f"/api/v1/{kind}/{row_id}/void"

    r = client.post(url, json={"reason": "  Entered twice  "}, headers=w.owner_h)
    assert r.status_code == 200, r.text
    assert r.json()["void_reason"] == "Entered twice" and r.json()["voided_at"] is not None
    row = _voided_by(w, kind, row_id)
    assert row["voided_by"] == w.owner and row["void_reason"] == "Entered twice"

    again = client.post(url, json={"reason": "Changed my mind"}, headers=w.owner_h)
    assert again.status_code == 409 and again.json()["error"]["code"] == "append_only"
    assert _voided_by(w, kind, row_id) == row  # the first void stands


@pytest.mark.ac("BE-44", "AC1")
@pytest.mark.parametrize("kind", ["invoices", "payments", "expenses"])
@pytest.mark.parametrize("body", [{}, {"reason": ""}, {"reason": " ab "}, {"reason": None}])
def test_void_without_a_reason_is_422(w, kind, body):
    row_id = {"invoices": _invoice, "payments": _pay, "expenses": _expense}[kind](w)
    r = client.post(f"/api/v1/{kind}/{row_id}/void", json=body, headers=w.owner_h)
    assert r.status_code == 422, r.text
    assert _voided_by(w, kind, row_id)["voided_by"] is None


@pytest.mark.parametrize("kind", ["invoices", "payments", "expenses"])
def test_only_the_owner_voids(w, kind):
    row_id = {"invoices": _invoice, "payments": _pay, "expenses": _expense}[kind](w)
    r = client.post(f"/api/v1/{kind}/{row_id}/void", json={"reason": "Not mine"}, headers=w.ct_a_h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert _voided_by(w, kind, row_id)["voided_by"] is None


@pytest.mark.parametrize("kind", ["invoices", "payments", "expenses"])
def test_void_unknown_id_is_404(w, kind):
    r = client.post(
        f"/api/v1/{kind}/00000000-0000-0000-0000-000000000000/void", json={"reason": "Typo"}, headers=w.owner_h
    )
    assert r.status_code == 404


def test_void_invoice_drops_it_from_dues(w):
    invoice = _invoice(w)
    owing = client.get("/api/v1/dues", headers=w.owner_h).json()
    assert [d["outstanding_paise"] for d in owing if d["resident_id"] == str(w.resident_a)] == [500_00]
    assert client.post(f"/api/v1/invoices/{invoice}/void", json={"reason": "Wrong"}, headers=w.owner_h).is_success
    owing = client.get("/api/v1/dues", headers=w.owner_h).json()
    assert [d for d in owing if d["resident_id"] == str(w.resident_a)] == []


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-44", "AC2")
def test_voiding_cash_lowers_the_caretakers_cash_in_hand(w):
    _pay(w, amount_paise=10_000_00)
    twice = _pay(w, amount_paise=10_000_00)
    expense = _expense(w, 1_000_00)
    assert _in_hand(w) == 19_000_00

    r = client.post(f"/api/v1/payments/{twice}/void", json={"reason": "Logged twice"}, headers=w.owner_h)
    assert r.status_code == 200, r.text
    assert _in_hand(w) == 9_000_00

    r = client.post(f"/api/v1/expenses/{expense}/void", json={"reason": "Not bought"}, headers=w.owner_h)
    assert r.status_code == 200, r.text
    assert _in_hand(w) == 10_000_00


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-44", "AC3")
def test_owner_verifies_upi_but_not_cash(w):
    upi = _pay(w, "upi")
    r = client.post(f"/api/v1/payments/{upi}/verify", headers=w.owner_h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "verified" and r.json()["verified_at"] is not None
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT verified_by FROM payments WHERE id = %s", (upi,))
        assert cur.fetchone()["verified_by"] == w.owner

    cash = _pay(w, "cash")
    r = client.post(f"/api/v1/payments/{cash}/verify", headers=w.owner_h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid"
    assert client.get(f"/api/v1/payments/{cash}", headers=w.owner_h).json()["status"] == "recorded"


@pytest.mark.ac("BE-44", "AC3")
def test_caretaker_cannot_verify_and_void_payments_stay_void(w):
    upi = _pay(w, "upi")
    assert client.post(f"/api/v1/payments/{upi}/verify", headers=w.ct_a_h).status_code == 403
    assert client.get(f"/api/v1/payments/{upi}", headers=w.owner_h).json()["status"] == "provisional"

    assert client.post(f"/api/v1/payments/{upi}/void", json={"reason": "Fake"}, headers=w.owner_h).is_success
    assert client.post(f"/api/v1/payments/{upi}/verify", headers=w.owner_h).status_code == 409
    assert (
        client.post("/api/v1/payments/00000000-0000-0000-0000-000000000000/verify", headers=w.owner_h).status_code
        == 404
    )


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-44", "AC4")
def test_flag_sets_flagged_with_the_reason(w):
    upi = _pay(w, "upi")
    r = client.post(f"/api/v1/payments/{upi}/flag", json={"reason": "Not in the bank app"}, headers=w.owner_h)
    assert r.status_code == 200, r.text
    assert (r.json()["status"], r.json()["flag_reason"]) == ("flagged", "Not in the bank app")
    assert client.get(f"/api/v1/payments/{upi}", headers=w.owner_h).json()["status"] == "flagged"

    # The owner can still verify it later (the money turned up); the reason stays as history.
    r = client.post(f"/api/v1/payments/{upi}/verify", headers=w.owner_h)
    assert (r.json()["status"], r.json()["flag_reason"]) == ("verified", "Not in the bank app")


@pytest.mark.ac("BE-44", "AC4")
def test_flag_needs_a_reason_the_owner_and_a_non_cash_payment(w):
    upi = _pay(w, "upi")
    assert client.post(f"/api/v1/payments/{upi}/flag", json={}, headers=w.owner_h).status_code == 422
    assert client.post(f"/api/v1/payments/{upi}/flag", json={"reason": "x"}, headers=w.owner_h).status_code == 422
    r = client.post(f"/api/v1/payments/{upi}/flag", json={"reason": "Looks fake"}, headers=w.ct_a_h)
    assert r.status_code == 403
    cash = _pay(w, "cash")
    assert client.post(f"/api/v1/payments/{cash}/flag", json={"reason": "Short"}, headers=w.owner_h).status_code == 422
    for pid in (upi, cash):
        p = client.get(f"/api/v1/payments/{pid}", headers=w.owner_h).json()
        assert p["status"] in ("provisional", "recorded") and p["flag_reason"] is None


# ---- AC5 --------------------------------------------------------------------------------------------


def _audit(w, headers=None, **params):
    return client.get("/api/v1/audit-logs", params=params, headers=headers or w.owner_h)


@pytest.mark.ac("BE-44", "AC5")
def test_audit_log_shows_who_did_what_newest_first(w):
    payment = _pay(w, "upi")
    assert client.post(f"/api/v1/payments/{payment}/void", json={"reason": "Fake UTR"}, headers=w.owner_h).is_success

    r = _audit(w, entity_type="payments", entity_id=payment)
    assert r.status_code == 200, r.text
    page = r.json()
    rows = [(e["action"], e["actor_id"], e["actor_name"]) for e in page["items"]]
    assert rows == [("update", str(w.owner), "Owner"), ("insert", str(w.caretaker_a), "Ravi")]
    void, created = page["items"]
    assert void["old_value"]["voided_at"] is None and void["new_value"]["void_reason"] == "Fake UTR"
    assert created["old_value"] is None and created["new_value"]["amount_paise"] == 6_000_00
    assert void["id"] > created["id"] and page["next_cursor"] is None


@pytest.mark.ac("BE-44", "AC5")
def test_audit_log_filters(w):
    payment = _pay(w, "cash")
    expense = _expense(w)
    assert client.post(f"/api/v1/expenses/{expense}/void", json={"reason": "Wrong"}, headers=w.owner_h).is_success

    def ids(**params):
        r = _audit(w, **params)
        assert r.status_code == 200, r.text
        return [(e["entity_type"], e["entity_id"], e["action"]) for e in r.json()["items"]]

    assert ids(entity_type="expenses") == [("expenses", expense, "update"), ("expenses", expense, "insert")]
    assert ids(entity_id=payment) == [("payments", payment, "insert")]
    by_ravi = ids(actor_id=str(w.caretaker_a))
    assert ("payments", payment, "insert") in by_ravi and ("expenses", expense, "insert") in by_ravi
    assert ("expenses", expense, "update") not in by_ravi  # the owner voided it
    assert ("expenses", expense, "update") in ids(actor_id=str(w.owner), entity_type="expenses")
    assert ids(entity_id=payment, **{"from": _today(), "to": _today()}) == [("payments", payment, "insert")]
    assert ids(entity_id=payment, **{"from": _today(1)}) == []
    assert ids(entity_id=payment, to=_today(-1)) == []


@pytest.mark.ac("BE-44", "AC5")
def test_audit_log_cursor_pagination(w):
    for _ in range(4):
        _pay(w)
    every = [e["id"] for e in _audit(w, entity_type="payments", limit=200).json()["items"]]
    assert len(every) == 4 and every == sorted(every, reverse=True)

    seen, cursor = [], None
    while True:
        params = {"entity_type": "payments", "limit": 3} | ({"cursor": cursor} if cursor else {})
        page = _audit(w, **params).json()
        seen += [e["id"] for e in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
        assert cursor == page["items"][-1]["id"]
    assert seen == every
    assert _audit(w, limit=0).status_code == 422 and _audit(w, limit=201).status_code == 422


@pytest.mark.ac("BE-44", "AC5")
def test_audit_log_is_owner_only_and_per_org(w):
    payment = _pay(w)
    r = _audit(w, headers=w.ct_a_h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"

    with as_user(None) as cur:  # another owner sees only their own organization's log
        cur.execute("SELECT * FROM api.signup_owner(%s, 'Other', 'x', 'Other PGs')", (rand_phone(),))
        other = cur.fetchone()
    r = _audit(w, headers=_h(other["user_id"], other["org_id"]), entity_id=payment)
    assert r.status_code == 200 and r.json()["items"] == []
    assert _audit(w, headers=_h(other["user_id"], w.org)).status_code == 403  # not a member
