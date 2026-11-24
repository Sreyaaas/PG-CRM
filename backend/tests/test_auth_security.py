"""BE-51: rate limits, sessions (refresh / logout / logout-all), change password, log redaction, headers."""

import io
import json
import logging

import pytest
from conftest import api_client, rand_phone

from app.logs import JsonFormatter, logger, redact
from app.monitoring import scrub_event

client = api_client()
PASSWORD = "s3cret-pass"


def _signup(c=client) -> dict:
    phone = rand_phone()
    r = c.post(
        "/api/v1/auth/signup",
        json={"phone": phone, "full_name": "Meera", "password": PASSWORD, "organization_name": "Meera PGs"},
    )
    assert r.status_code == 201, r.text
    return {"phone": phone, **r.json()}


def _login(phone: str, password: str = PASSWORD, c=client):
    return c.post("/api/v1/auth/login", json={"phone": phone, "password": password})


def _refresh(token: str, c=client):
    return c.post("/api/v1/auth/refresh", json={"refresh_token": token})


def _auth(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


# ---- AC1: login rate limit ---------------------------------------------------------------------------


@pytest.mark.ac("BE-51", "AC1")
def test_five_failed_logins_lock_the_phone_even_with_right_password():
    user = _signup()
    for _ in range(5):
        assert _login(user["phone"], "wrong-pass").status_code == 401
    r = _login(user["phone"])
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited"
    assert int(r.headers["Retry-After"]) == 15 * 60
    # Another phone from the same IP is unaffected.
    assert _login(_signup()["phone"]).status_code == 200


@pytest.mark.ac("BE-51", "AC1")
def test_twenty_failures_from_one_ip_lock_that_ip():
    c = api_client()  # fresh IP
    owner = _signup(c)
    for _ in range(20):
        assert _login(rand_phone(), "wrong-pass", c=c).status_code == 401
    assert _login(owner["phone"], c=c).status_code == 429
    assert _login(owner["phone"]).status_code == 200  # other IP


@pytest.mark.ac("BE-51", "AC1")
def test_rate_limit_store_keeps_no_phone_numbers(admin):
    phone = rand_phone()
    _login(phone, "wrong-pass")
    rows = admin.execute("SELECT bucket FROM rate_limit_events ORDER BY id DESC LIMIT 5").fetchall()
    assert rows and all(phone not in r["bucket"] for r in rows)


# ---- AC2: refresh rotation and reuse detection --------------------------------------------------------


@pytest.mark.ac("BE-51", "AC2")
def test_refresh_rotates_and_reuse_revokes_the_session():
    first = _signup()
    assert first["expires_in"] == 15 * 60 and first["refresh_expires_in"] == 30 * 24 * 3600

    r = _refresh(first["refresh_token"])
    assert r.status_code == 200, r.text
    second = r.json()
    assert second["refresh_token"] != first["refresh_token"]
    assert client.get("/api/v1/me", headers=_auth(second)).json()["phone"] == first["phone"]

    third = _refresh(second["refresh_token"]).json()

    # Someone replays an old token: refused, and the whole session (including the newest token) dies.
    r = _refresh(first["refresh_token"])
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthenticated"
    assert _refresh(third["refresh_token"]).status_code == 401

    # A separate login is a separate session and still works.
    assert _refresh(_login(first["phone"]).json()["refresh_token"]).status_code == 200


@pytest.mark.ac("BE-51", "AC2")
def test_refresh_tokens_are_stored_hashed(admin):
    user = _signup()
    stored = admin.execute(
        "SELECT token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.phone = %s", (user["phone"],)
    ).fetchall()
    assert len(stored) == 1 and stored[0]["token_hash"] != user["refresh_token"]
    assert len(stored[0]["token_hash"]) == 64


def test_garbage_refresh_token_is_401():
    assert _refresh("not-a-real-token").status_code == 401


# ---- AC3: logout and logout-all -----------------------------------------------------------------------


@pytest.mark.ac("BE-51", "AC3")
def test_logout_revokes_the_session():
    user = _signup()
    other = _login(user["phone"]).json()
    r = client.post("/api/v1/auth/logout", json={"refresh_token": user["refresh_token"]})
    assert r.status_code == 204
    assert _refresh(user["refresh_token"]).status_code == 401
    assert _refresh(other["refresh_token"]).status_code == 200  # other device untouched


@pytest.mark.ac("BE-51", "AC3")
def test_logout_all_revokes_every_session():
    user = _signup()
    sessions = [user] + [_login(user["phone"]).json() for _ in range(2)]
    r = client.post("/api/v1/auth/logout-all", headers=_auth(sessions[1]))
    assert r.status_code == 204
    for s in sessions:
        assert _refresh(s["refresh_token"]).status_code == 401
    assert client.post("/api/v1/auth/logout-all").status_code == 401  # needs to be signed in


# ---- AC4: change password ------------------------------------------------------------------------------


@pytest.mark.ac("BE-51", "AC4")
def test_change_password_requires_current_and_revokes_other_sessions():
    user = _signup()
    other = _login(user["phone"]).json()
    url = "/api/v1/auth/change-password"

    r = client.post(url, json={"current_password": "wrong-pass", "new_password": "brand-new-pass"}, headers=_auth(user))
    assert r.status_code == 422 and r.json()["error"]["message"] == "Current password is incorrect."
    assert _login(user["phone"], "brand-new-pass").status_code == 401  # unchanged

    r = client.post(url, json={"current_password": PASSWORD, "new_password": "short"}, headers=_auth(user))
    assert r.status_code == 422

    r = client.post(url, json={"current_password": PASSWORD, "new_password": "brand-new-pass"}, headers=_auth(user))
    assert r.status_code == 204, r.text

    assert _refresh(other["refresh_token"]).status_code == 401  # other device signed out
    assert _refresh(user["refresh_token"]).status_code == 200  # this one stays
    assert _login(user["phone"], PASSWORD).status_code == 401
    assert _login(user["phone"], "brand-new-pass").status_code == 200
    assert client.post(url, json={"current_password": "x", "new_password": "brand-new-pass"}).status_code == 401


@pytest.mark.ac("BE-51", "AC4")
def test_wrong_current_password_counts_towards_the_lock():
    user = _signup()
    url = "/api/v1/auth/change-password"
    for _ in range(5):
        r = client.post(
            url, json={"current_password": "guess-123", "new_password": "brand-new-pass"}, headers=_auth(user)
        )
        assert r.status_code == 422
    r = client.post(url, json={"current_password": PASSWORD, "new_password": "brand-new-pass"}, headers=_auth(user))
    assert r.status_code == 429
    assert _login(user["phone"]).status_code == 429


# ---- AC5: logs never contain secrets -------------------------------------------------------------------


@pytest.fixture
def captured_logs():
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    try:
        yield stream
    finally:
        logger.removeHandler(handler)


@pytest.mark.ac("BE-51", "AC5")
def test_request_logs_contain_no_passwords_tokens_or_phones(captured_logs):
    user = _signup()
    _login(user["phone"], "Wrong-Pass-Secret-1")
    tokens = _login(user["phone"]).json()
    renewed = _refresh(tokens["refresh_token"]).json()
    client.get("/api/v1/me", headers=_auth(renewed))
    client.get(f"/api/v1/public/join/{'q' * 40}")
    client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "Another-Secret-2", "new_password": "brand-new-pass"},
        headers=_auth(renewed),
    )
    client.post("/api/v1/auth/logout", json={"refresh_token": renewed["refresh_token"]})

    text = captured_logs.getvalue()
    lines = [json.loads(line) for line in text.splitlines()]
    assert any(line.get("route") == "/api/v1/auth/login" for line in lines)  # logging did happen
    assert all("request_id" in line for line in lines if line["msg"] == "request")
    for secret in (
        PASSWORD,
        "Wrong-Pass-Secret-1",
        "Another-Secret-2",
        user["phone"],
        user["access_token"],
        user["refresh_token"],
        tokens["refresh_token"],
        renewed["access_token"],
        renewed["refresh_token"],
        "q" * 40,
    ):
        assert secret not in text, secret
    assert f"{user['phone'][:2]}******{user['phone'][-2:]}" in text  # failed login logs a masked phone


@pytest.mark.ac("BE-51", "AC5")
def test_redaction_rules():
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlX3NpZ25hdHVyZQ"
    line = (
        f"user 9876543210 / +91 98765 43210 sent password=hunter22 and "
        f'{{"new_password": "p@ss w0rd"}} with Bearer {jwt}; refresh xY3_kP9qLmN2vB8wR4tZ7aC1dE5fG6hJ0kL; '
        "aadhaar 1234 5678 9012, PAN ABCDE1234F"
    )
    out = redact(line)
    for secret in (
        "9876543210",
        "98765 43210",
        "hunter22",
        "p@ss w0rd",
        jwt,
        "xY3_kP9qLmN2vB8wR4tZ7aC1dE5fG6hJ0kL",
        "1234 5678 9012",
        "ABCDE1234F",
    ):
        assert secret not in out, secret
    assert "98******10" in out


@pytest.mark.ac("BE-51", "AC5")
def test_unhandled_errors_and_db_messages_are_redacted(captured_logs):
    try:
        raise RuntimeError("boom for 9876543210 with token=abc123secret")
    except RuntimeError:
        logger.exception("unhandled error")
    text = captured_logs.getvalue()
    assert "9876543210" not in text and "abc123secret" not in text and "98******10" in text


@pytest.mark.ac("BE-51", "AC5")
def test_sentry_events_are_scrubbed():
    event = {
        "request": {
            "headers": {"Authorization": "Bearer eyJa.eyJb.c", "User-Agent": "x"},
            "data": {"password": "hunter22"},
            "cookies": {"s": "1"},
            "query_string": "key=org/1/kyc.jpg",
        },
        "user": {"id": "u"},
        "exception": {"values": [{"value": "duplicate phone 9876543210"}]},
        "extra": {"refresh_token": "abc", "note": "ok"},
    }
    out = json.dumps(scrub_event(event))
    for secret in ("hunter22", "eyJa", "9876543210", "kyc.jpg", '"abc"'):
        assert secret not in out, secret
    assert '"User-Agent": "x"' in out and '"note": "ok"' in out


# ---- AC6: deactivated users can't refresh --------------------------------------------------------------


@pytest.mark.ac("BE-51", "AC6")
def test_deactivated_user_cannot_refresh(admin):
    user = _signup()
    admin.execute("UPDATE users SET is_active = false WHERE phone = %s", (user["phone"],))
    assert _refresh(user["refresh_token"]).status_code == 401
    # The session is revoked, so reactivating doesn't bring that token back.
    admin.execute("UPDATE users SET is_active = true WHERE phone = %s", (user["phone"],))
    assert _refresh(user["refresh_token"]).status_code == 401
    assert _login(user["phone"]).status_code == 200


# ---- Headers --------------------------------------------------------------------------------------------


def test_security_headers_and_request_id():
    r = client.get("/health", headers={"X-Request-ID": "abc-123"})
    assert r.headers["X-Request-ID"] == "abc-123"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    assert r.headers["Cache-Control"] == "no-store"
    assert "default-src 'none'" in r.headers["Content-Security-Policy"]
    assert len(client.get("/health", headers={"X-Request-ID": "bad id!"}).headers["X-Request-ID"]) == 32
    assert "Content-Security-Policy" not in client.get("/docs").headers


def test_prod_settings_refuse_dev_secret_and_loose_cors():
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError):
        Settings(environment="prod", cors_origins=["https://app.example.in"])  # dev JWT secret
    for origins in (["*"], ["http://app.example.in"], ["https://localhost:5173"], []):
        with pytest.raises(ValidationError):
            Settings(environment="prod", jwt_secret="x" * 40, cors_origins=origins)
    assert Settings(environment="prod", jwt_secret="x" * 40, cors_origins=["https://app.example.in"])
