"""BE-20: private file uploads with presigned URLs (S3-compatible storage: RustFS locally and in CI)."""

from datetime import datetime
from pathlib import Path

import httpx
import pytest
from conftest import World, api_client, as_user

from app import storage
from app.config import get_settings
from app.security import create_access_token

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 2048


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    storage.ensure_bucket()
    with as_user(world.owner, world.org) as cur:
        cur.execute("SELECT qr_slug FROM properties WHERE id = %s", (world.prop_a,))
        world.slug_a = cur.fetchone()["qr_slug"]
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)  # assigned to prop_a
    world.ct_b_h = _h(world.caretaker_b, world.org)  # assigned to prop_b
    world.client = api_client()  # own IP: the public endpoint allows 10 per IP per 10 minutes
    return world


def _public(w, slug=None, **body):
    body = {"kind": "selfie", "content_type": "image/jpeg", "size_bytes": len(JPEG)} | body
    return w.client.post(f"/api/v1/public/join/{slug or w.slug_a}/uploads", json=body)


def _staff(w, headers=None, **body):
    body = {
        "kind": "expense_proof",
        "property_id": str(w.prop_a),
        "content_type": "image/jpeg",
        "size_bytes": len(JPEG),
    } | body
    return w.client.post("/api/v1/uploads", json=body, headers=headers or w.owner_h)


def _put(ticket: dict, data: bytes = JPEG, content_type: str = "image/jpeg") -> int:
    return httpx.put(ticket["upload_url"], content=data, headers={"Content-Type": content_type}).status_code


def _store_selfie_on_resident(w, key: str) -> None:
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE residents SET selfie_path = %s WHERE id = %s", (key, w.resident_a))


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-20", "AC1")
def test_public_presign_for_valid_slug(w):
    r = _public(w)
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["object_key"].startswith(f"onboarding/{w.prop_a}/") and t["object_key"].endswith(".jpg")
    assert t["expires_in"] == 300
    assert t["upload_url"].startswith(get_settings().s3_endpoint)

    kyc = _public(w, kind="kyc_id", content_type="application/pdf").json()
    assert kyc["object_key"].startswith(f"onboarding/{w.prop_a}/") and kyc["object_key"].endswith(".pdf")


@pytest.mark.ac("BE-20", "AC1")
def test_public_presign_unknown_or_inactive_slug_is_404(w):
    assert _public(w, slug="no-such-slug").status_code == 404
    w.client.patch(f"/api/v1/properties/{w.prop_a}", json={"is_active": False}, headers=w.owner_h)
    r = _public(w)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_public_upload_rate_limit_is_10_per_ip():
    c = api_client()
    body = {"kind": "selfie", "content_type": "image/jpeg", "size_bytes": 10}
    for _ in range(10):
        assert c.post("/api/v1/public/join/whatever/uploads", json=body).status_code == 404
    r = c.post("/api/v1/public/join/whatever/uploads", json=body)
    assert r.status_code == 429 and r.headers["Retry-After"] == "600"


# ---- AC2 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-20", "AC2")
@pytest.mark.parametrize(
    "body",
    [
        {"content_type": "text/plain"},
        {"content_type": "image/gif"},
        {"content_type": "application/pdf"},  # PDF only for kyc_id
        {"size_bytes": 5 * 1024 * 1024 + 1},
        {"size_bytes": 0},
    ],
)
def test_disallowed_type_or_size_is_422(w, body):
    r = _public(w, **body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation"
    r = _staff(w, **body)
    assert r.status_code == 422


@pytest.mark.ac("BE-20", "AC2")
def test_limits_at_the_edge_are_accepted(w):
    assert _public(w, size_bytes=5 * 1024 * 1024).status_code == 200
    for ct in ("image/png", "image/webp"):
        assert _staff(w, content_type=ct).status_code == 200
    assert _staff(w, kind="kyc_id", content_type="application/pdf").status_code == 200


# ---- AC3 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-20", "AC3")
def test_presigned_put_works_and_anonymous_get_is_refused(w):
    t = _public(w).json()
    assert storage.object_exists(t["object_key"]) == (False, None)

    assert _put(t) == 200
    exists, modified = storage.object_exists(t["object_key"])
    assert exists and isinstance(modified, datetime)

    anonymous = httpx.get(f"{get_settings().s3_endpoint}/{get_settings().s3_bucket}/{t['object_key']}")
    assert anonymous.status_code == 403
    assert JPEG not in anonymous.content


@pytest.mark.ac("BE-20", "AC3")
def test_presigned_put_refuses_other_type_or_size(w):
    t = _public(w).json()
    assert _put(t, content_type="image/png") == 403
    assert _put(t, data=JPEG + b"extra") == 403
    assert storage.object_exists(t["object_key"])[0] is False


# ---- AC4 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-20", "AC4")
def test_staff_presign_needs_access_to_the_property(w):
    r = _staff(w, headers=w.ct_b_h)  # caretaker of B asks for building A
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert _staff(w, property_id="00000000-0000-0000-0000-000000000000").status_code == 404

    r = _staff(w, headers=w.ct_a_h)
    assert r.status_code == 200
    assert r.json()["object_key"].startswith(f"org/{w.org}/{w.prop_a}/expense_proof/")
    assert _put(r.json()) == 200
    assert w.client.post("/api/v1/uploads", json={}).status_code in (401, 422)


# ---- AC5 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-20", "AC5")
def test_signed_get_only_for_keys_on_rows_the_caller_can_see(w):
    t = _public(w).json()
    assert _put(t) == 200
    key = t["object_key"]

    # Not referenced by any row yet: nobody gets a link, not even the owner.
    assert w.client.get("/api/v1/files/url", params={"key": key}, headers=w.owner_h).status_code == 404

    _store_selfie_on_resident(w, key)  # resident of building A
    r = w.client.get("/api/v1/files/url", params={"key": key}, headers=w.ct_b_h)
    assert r.status_code == 404  # caretaker of B can't get a selfie from A

    for headers in (w.owner_h, w.ct_a_h):
        r = w.client.get("/api/v1/files/url", params={"key": key}, headers=headers)
        assert r.status_code == 200 and r.json()["expires_in"] == 300
        assert httpx.get(r.json()["url"]).content == JPEG

    assert w.client.get("/api/v1/files/url", params={"key": key}).status_code == 401


# ---- AC6 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-20", "AC6")
def test_ci_runs_s3_compatible_storage():
    """CI gets a RustFS service container (decided on the issue: the MinIO images can no longer be pulled and
    LocalStack now needs an account token), and points the API at it. The AC3 tests then run against it."""
    ci = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    services = ci[ci.index("services:") : ci.index("\n    env:")]
    assert "image: rustfs/rustfs" in services
    assert '"9000:9000"' in services
    for var in ("PGCRM_S3_ENDPOINT: http://localhost:9000", "PGCRM_S3_BUCKET", "PGCRM_S3_ACCESS_KEY"):
        assert var in ci


@pytest.mark.ac("BE-20", "AC6")
def test_configured_storage_is_reachable_and_private():
    storage.ensure_bucket()
    s3 = storage.client()
    s3.head_bucket(Bucket=get_settings().s3_bucket)
    key = "ci-check/hello.txt"
    s3.put_object(Bucket=get_settings().s3_bucket, Key=key, Body=b"hi")
    assert httpx.get(f"{get_settings().s3_endpoint}/{get_settings().s3_bucket}/{key}").status_code == 403
