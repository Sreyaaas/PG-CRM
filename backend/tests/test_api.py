from conftest import api_client, rand_phone

client = api_client()


def _signup() -> tuple[str, dict]:
    phone = rand_phone()
    r = client.post(
        "/api/v1/auth/signup",
        json={"phone": phone, "full_name": "Meera", "password": "s3cret-pass", "organization_name": "Meera PGs"},
    )
    assert r.status_code == 201, r.text
    return phone, r.json()


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_signup_login_me_and_properties():
    phone, signup = _signup()
    org_id = signup["me"]["memberships"][0]["org_id"]
    assert signup["me"]["memberships"][0]["role"] == "owner"

    bad = client.post("/api/v1/auth/login", json={"phone": phone, "password": "wrong-pass"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "unauthenticated"

    r = client.post("/api/v1/auth/login", json={"phone": phone, "password": "s3cret-pass"})
    assert r.status_code == 200
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    assert client.get("/api/v1/me", headers=headers).json()["phone"] == phone
    r = client.get("/api/v1/properties", headers=headers | {"X-Org-Id": org_id})
    assert r.status_code == 200 and r.json() == []


def test_duplicate_phone_is_409():
    phone, _ = _signup()
    r = client.post(
        "/api/v1/auth/signup",
        json={"phone": phone, "full_name": "X", "password": "another-pass", "organization_name": "X"},
    )
    assert r.status_code == 409
    assert r.json()["error"]["message"] == "An account with this phone number already exists."


def test_foreign_org_is_403():
    _, a = _signup()
    _, b = _signup()
    headers = {"Authorization": f"Bearer {a['access_token']}", "X-Org-Id": b["me"]["memberships"][0]["org_id"]}
    assert client.get("/api/v1/properties", headers=headers).status_code == 403


def test_requires_auth():
    assert client.get("/api/v1/me").status_code == 401


def test_unknown_join_slug_is_404():
    assert client.get("/api/v1/public/join/nope").status_code == 404
