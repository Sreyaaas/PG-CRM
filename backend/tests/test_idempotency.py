"""BE-32: Idempotency-Key on POST /payments, POST /expenses and POST /cash/handovers."""

import threading
import time
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from conftest import World, api_client, as_user

from app import idempotency, storage
from app.routers import payments as payments_router
from app.schemas import PaymentCreate
from app.security import create_access_token

JPEG = b"\xff\xd8\xff\xe0" + b"3" * 1024
client = api_client()


def _h(user, org, key=None) -> dict:
    h = {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}
    return h | ({"Idempotency-Key": str(key)} if key else {})


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)
    return world


def _payment_body(w, **over) -> dict:
    return {"resident_id": str(w.resident_a), "amount_paise": 10_000_00, "method": "cash"} | over


def _pay(w, key=None, user=None, **over) -> httpx.Response:
    return client.post("/api/v1/payments", json=_payment_body(w, **over), headers=_h(user or w.caretaker_a, w.org, key))


def _payment_count(w) -> int:
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT count(*) AS n FROM payments WHERE resident_id = %s", (w.resident_a,))
        return cur.fetchone()["n"]


def _expense_body(w) -> dict:
    r = client.post(
        "/api/v1/uploads",
        json={"kind": "expense_proof", "property_id": str(w.prop_a), "content_type": "image/jpeg", "size_bytes": 1028},
        headers=w.ct_a_h,
    )
    assert r.status_code == 200, r.text
    t = r.json()
    assert httpx.put(t["upload_url"], content=JPEG, headers={"Content-Type": "image/jpeg"}).status_code == 200
    today = (datetime.now(UTC) + timedelta(hours=5, minutes=30)).date()
    return {
        "property_id": str(w.prop_a),
        "category": "groceries",
        "amount_paise": 1_250_00,
        "expense_date": today.isoformat(),
        "bill_mode": "has_bill",
        "paid_from": "caretaker_cash",
        "proof_path": t["object_key"],
    }


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-32", "AC1")
def test_payment_retry_with_the_same_key_returns_the_first_response(w):
    key = uuid.uuid4()
    first = _pay(w, key, notes="June rent")
    assert first.status_code == 201, first.text
    again = _pay(w, key, notes="June rent")
    assert again.status_code == 201
    assert again.json() == first.json()
    assert _payment_count(w) == 1


@pytest.mark.ac("BE-32", "AC1")
def test_expense_retry_with_the_same_key_returns_the_first_response(w):
    storage.ensure_bucket()
    key, body = uuid.uuid4(), _expense_body(w)
    first = client.post("/api/v1/expenses", json=body, headers=_h(w.caretaker_a, w.org, key))
    assert first.status_code == 201, first.text
    again = client.post("/api/v1/expenses", json=body, headers=_h(w.caretaker_a, w.org, key))
    assert (again.status_code, again.json()) == (201, first.json())
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT count(*) AS n FROM expenses WHERE property_id = %s", (w.prop_a,))
        assert cur.fetchone()["n"] == 1


@pytest.mark.ac("BE-32", "AC1")
def test_handover_retry_with_the_same_key_returns_the_first_response(w):
    _pay(w)  # Ravi holds ₹10,000
    key = uuid.uuid4()
    body = {"caretaker_user_id": str(w.caretaker_a), "amount_paise": 4_000_00}
    first = client.post("/api/v1/cash/handovers", json=body, headers=_h(w.owner, w.org, key))
    assert first.status_code == 201, first.text
    assert first.json()["in_hand_paise"] == 6_000_00
    again = client.post("/api/v1/cash/handovers", json=body, headers=_h(w.owner, w.org, key))
    assert (again.status_code, again.json()) == (201, first.json())  # still "₹6,000 left", not ₹2,000
    assert len(client.get("/api/v1/cash/handovers", headers=w.owner_h).json()) == 1


@pytest.mark.ac("BE-32", "AC1")
def test_keys_are_per_user_and_failed_requests_store_nothing(w):
    key = uuid.uuid4()
    missing = _pay(w, key, resident_id="00000000-0000-0000-0000-000000000000")
    assert missing.status_code == 404
    assert _pay(w, key).status_code == 201  # the failure didn't keep the key: the corrected retry goes through
    owner = _pay(w, key, user=w.owner)  # the same key from someone else is their own key
    assert owner.status_code == 201 and owner.json()["received_by"] == str(w.owner)
    assert _payment_count(w) == 2


def test_keys_older_than_7_days_are_ignored(w, admin):
    key = uuid.uuid4()
    first = _pay(w, key)
    admin.execute(
        "UPDATE idempotency_keys SET created_at = now() - interval '8 days' WHERE user_id = %s AND key = %s",
        (w.caretaker_a, str(key)),
    )
    again = _pay(w, key)
    assert again.status_code == 201 and again.json()["id"] != first.json()["id"]
    assert _payment_count(w) == 2


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-32", "AC2")
def test_same_key_with_a_different_body_is_422(w):
    key = uuid.uuid4()
    assert _pay(w, key).status_code == 201
    r = _pay(w, key, amount_paise=9_000_00)
    assert r.status_code == 422
    assert r.json() == {"error": {"code": "invalid", "message": "Idempotency-Key reused with a different request"}}
    assert _payment_count(w) == 1


@pytest.mark.ac("BE-32", "AC2")
def test_body_hash_is_canonical(w):
    a = PaymentCreate.model_validate(_payment_body(w, method="upi", utr_number="1234 5678 9012"))
    b = PaymentCreate.model_validate(
        {"utr_number": "123456789012", "method": "upi", "amount_paise": 10_000_00, "resident_id": str(w.resident_a)}
    )
    assert idempotency.hash_body(a) == idempotency.hash_body(b)  # key order, spacing and defaults don't matter
    c = PaymentCreate.model_validate(_payment_body(w, amount_paise=10_000_01))
    assert idempotency.hash_body(a) != idempotency.hash_body(c)


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-32", "AC3")
def test_concurrent_requests_with_the_same_key_record_one_payment(w):
    key, n = uuid.uuid4(), 6
    barrier, results = threading.Barrier(n), [None] * n

    def tap(i):
        c = api_client()
        barrier.wait()
        results[i] = c.post("/api/v1/payments", json=_payment_body(w), headers=_h(w.caretaker_a, w.org, key))

    threads = [threading.Thread(target=tap, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert [r.status_code for r in results] == [201] * n
    assert len({r.json()["id"] for r in results}) == 1
    assert _payment_count(w) == 1


@pytest.mark.ac("BE-32", "AC3")
def test_a_retry_waits_for_the_first_request_to_commit(w):
    """Deterministic version: the first request is held open mid-transaction; the retry must block, then replay."""
    key = uuid.uuid4()
    body = PaymentCreate.model_validate(_payment_body(w))
    request_hash = idempotency.hash_body(body)
    retry: dict = {}

    def send_retry():
        retry["r"] = api_client().post("/api/v1/payments", json=_payment_body(w), headers=_h(w.caretaker_a, w.org, key))

    with as_user(w.caretaker_a, w.org) as cur:
        assert idempotency.replay(cur, key, request_hash) is None  # takes the key's lock
        t = threading.Thread(target=send_retry)
        t.start()
        time.sleep(1.0)
        assert t.is_alive(), "the retry should be waiting for the first request"
        cur.execute(
            """INSERT INTO payments (org_id, property_id, resident_id, amount_paise, method)
               VALUES (%s, %s, %s, %s, 'cash') RETURNING id""",
            (w.org, w.prop_a, w.resident_a, body.amount_paise),
        )
        payment = payments_router._one(cur, cur.fetchone()["id"])
        idempotency.save(cur, key, request_hash, 201, payment)
    t.join(timeout=30)
    assert retry["r"].status_code == 201
    assert retry["r"].json() == payment.model_dump(mode="json")  # the first request's response, replayed
    assert _payment_count(w) == 1


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-32", "AC4")
def test_without_the_header_every_request_is_recorded(w):
    first, second = _pay(w), _pay(w)
    assert (first.status_code, second.status_code) == (201, 201)
    assert first.json()["id"] != second.json()["id"]
    assert _payment_count(w) == 2
    with as_user(w.caretaker_a, w.org) as cur:
        cur.execute("SELECT count(*) AS n FROM idempotency_keys")
        assert cur.fetchone()["n"] == 0


def test_key_must_be_a_uuid(w):
    r = client.post("/api/v1/payments", json=_payment_body(w), headers=w.ct_a_h | {"Idempotency-Key": "tap-tap"})
    assert r.status_code == 422
    assert _payment_count(w) == 0


@pytest.mark.parametrize("path", ["/api/v1/payments", "/api/v1/expenses", "/api/v1/cash/handovers"])
def test_browser_preflight_allows_idempotency_key(path):
    """The PWA sends Idempotency-Key from the browser; without it in the CORS allowlist the preflight fails and
    every payment/expense/handover save from the frontend is blocked."""

    origin = "http://localhost:5173"
    r = api_client().options(
        path,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type,x-org-id,idempotency-key",
        },
    )
    assert r.status_code == 200, r.text
    assert "idempotency-key" in r.headers.get("access-control-allow-headers", "").lower()
