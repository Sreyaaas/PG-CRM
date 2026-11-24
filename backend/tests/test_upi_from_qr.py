"""BE-11: parse the owner's Soundbox UPI QR into the property's payee details."""

import json

import pytest
from conftest import api_client, as_user, rand_phone

from app.security import hash_password
from app.upi import UpiQrError, parse_upi_qr

client = api_client()
PASSWORD = "s3cret-pass"

SIGN = "MEUCIQDv3x9rTqL0aZ8bNk2Yw7Hc1PfE4sUoJgVmXy5nRzKdQwIgS2tB8uFhLc6vWp+eA/9jN0qGxYiO3mZr7Dk1sTbHn4U="
PAYTM_QR = (
    "upi://pay?pa=paytmqr2810050501011abcdxyz@paytm&pn=Sunrise%20PG&mc=7011"
    f"&tr=PYTM2026112400001&tn=Payment&am=1500.00&cu=INR&mode=02&orgid=159761&sign={SIGN}"
)
PHONEPE_QR = "UPI://pay?pa=Q123456789@ybl&pn=Sri%20Sai%20PG&mc=5411&mode=02&purpose=00"
PERSONAL_QR = "upi://pay?pa=meera.rao-99@okhdfcbank&pn=Meera%20Rao"


@pytest.fixture
def org() -> dict:
    """Owner with one property, and a caretaker assigned to it."""
    phone = rand_phone()
    r = client.post(
        "/api/v1/auth/signup",
        json={"phone": phone, "full_name": "Meera", "password": PASSWORD, "organization_name": "Meera PGs"},
    )
    assert r.status_code == 201, r.text
    me = r.json()["me"]
    org_id = me["memberships"][0]["org_id"]
    owner = {"Authorization": f"Bearer {r.json()['access_token']}", "X-Org-Id": org_id}
    prop = client.post("/api/v1/properties", json={"name": "Sunrise HSR"}, headers=owner).json()

    ct_phone = rand_phone()
    with as_user(me["id"], org_id) as cur:
        cur.execute(
            "SELECT api.add_staff_member(%s, 'Ravi', %s, 'caretaker', %s)",
            (ct_phone, hash_password(PASSWORD), [prop["id"]]),
        )
    r = client.post("/api/v1/auth/login", json={"phone": ct_phone, "password": PASSWORD})
    caretaker = {"Authorization": f"Bearer {r.json()['access_token']}", "X-Org-Id": org_id}
    return {"owner": owner, "caretaker": caretaker, "prop": prop}


def _scan(org: dict, qr_text: str, who: str = "owner"):
    return client.post(
        f"/api/v1/properties/{org['prop']['id']}/upi-from-qr", json={"qr_text": qr_text}, headers=org[who]
    )


# ---- parser -----------------------------------------------------------------------------------------


@pytest.mark.ac("BE-11", "AC1")
def test_parser_keeps_only_pa_pn_mc():
    p = parse_upi_qr(PAYTM_QR)
    assert (p.vpa, p.payee_name, p.mcc) == ("paytmqr2810050501011abcdxyz@paytm", "Sunrise PG", "7011")


@pytest.mark.ac("BE-11", "AC2")
def test_parser_phonepe_style_and_url_encoded_name():
    p = parse_upi_qr(PHONEPE_QR)
    assert (p.vpa, p.payee_name, p.mcc) == ("Q123456789@ybl", "Sri Sai PG", "5411")
    assert parse_upi_qr("upi://pay?pa=sai@ybl&pn=Sri+Sai+PG").payee_name == "Sri Sai PG"
    assert parse_upi_qr("  upi://PAY?pa=sai@ybl&pn=%20%20Sri%20Sai%20  ").payee_name == "Sri Sai"
    assert len(parse_upi_qr("upi://pay?pa=sai@ybl&pn=" + "A" * 150).payee_name) == 100
    assert parse_upi_qr("upi://pay?pa=sai@ybl&pn=").payee_name is None


@pytest.mark.ac("BE-11", "AC3")
@pytest.mark.parametrize(
    "text",
    [
        "https://paytm.com/pay?pa=x@paytm",
        "hello",
        "upi://collect?pa=x@paytm",
        "upi://pay?pn=No%20VPA&mc=7011",
        "upi://pay?pa=&pn=Empty",
        "upi://pay?pa=not-a-vpa",
        "upi://pay?pa=x@paytm&mc=70",
    ],
)
def test_parser_rejects_unusable_text(text):
    with pytest.raises(UpiQrError):
        parse_upi_qr(text)


# ---- API --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-11", "AC1")
def test_paytm_qr_saves_payee_and_stores_nothing_else(org, admin):
    before = admin.execute("SELECT * FROM properties WHERE id = %s", (org["prop"]["id"],)).fetchone()

    r = _scan(org, PAYTM_QR)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "upi_vpa": "paytmqr2810050501011abcdxyz@paytm",
        "upi_payee_name": "Sunrise PG",
        "upi_mcc": "7011",
        "warning": None,
    }

    after = admin.execute("SELECT * FROM properties WHERE id = %s", (org["prop"]["id"],)).fetchone()
    changed = {k for k in after if after[k] != before[k]}
    assert changed == {"upi_vpa", "upi_payee_name", "upi_mcc", "updated_at"}

    # Neither the signature nor any other QR parameter reaches the database (row or audit trail).
    stored = json.dumps(after, default=str) + json.dumps(
        admin.execute("SELECT old_value, new_value FROM audit_logs WHERE entity_id = %s", (after["id"],)).fetchall(),
        default=str,
    )
    for fragment in (SIGN[:20], "PYTM2026112400001", "1500.00", "159761", "upi://"):
        assert fragment not in stored, fragment


@pytest.mark.ac("BE-11", "AC2")
def test_phonepe_qr_with_encoded_name(org):
    r = _scan(org, PHONEPE_QR)
    assert r.status_code == 200, r.text
    assert r.json()["upi_vpa"] == "Q123456789@ybl"
    assert r.json()["upi_payee_name"] == "Sri Sai PG"
    assert r.json()["upi_mcc"] == "5411"
    got = client.get(f"/api/v1/properties/{org['prop']['id']}", headers=org["owner"]).json()
    assert (got["upi_vpa"], got["upi_payee_name"], got["upi_mcc"]) == ("Q123456789@ybl", "Sri Sai PG", "5411")


@pytest.mark.ac("BE-11", "AC3")
def test_missing_pa_and_non_upi_text_are_422(org):
    r = _scan(org, "upi://pay?pn=Sunrise%20PG&mc=7011")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid"

    r = _scan(org, "https://example.com/menu")
    assert r.status_code == 422
    assert r.json() == {"error": {"code": "invalid", "message": "This is not a UPI payment QR"}}

    got = client.get(f"/api/v1/properties/{org['prop']['id']}", headers=org["owner"]).json()
    assert got["upi_vpa"] is None


@pytest.mark.ac("BE-11", "AC4")
def test_missing_mc_saves_with_warning(org):
    r = _scan(org, PERSONAL_QR)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "upi_vpa": "meera.rao-99@okhdfcbank",
        "upi_payee_name": "Meera Rao",
        "upi_mcc": None,
        "warning": "Not a merchant QR",
    }
    got = client.get(f"/api/v1/properties/{org['prop']['id']}", headers=org["owner"]).json()
    assert got["upi_vpa"] == "meera.rao-99@okhdfcbank" and got["upi_mcc"] is None


@pytest.mark.ac("BE-11", "AC4")
def test_rescanning_a_merchant_qr_replaces_personal_details(org):
    _scan(org, PERSONAL_QR)
    r = _scan(org, PAYTM_QR)
    assert r.json()["upi_mcc"] == "7011" and r.json()["warning"] is None


@pytest.mark.ac("BE-11", "AC5")
def test_caretaker_is_403_and_nothing_changes(org):
    for text in (PAYTM_QR, "not a qr"):
        r = _scan(org, text, who="caretaker")
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    got = client.get(f"/api/v1/properties/{org['prop']['id']}", headers=org["owner"]).json()
    assert got["upi_vpa"] is None


@pytest.mark.ac("BE-11", "AC5")
def test_caretaker_cannot_change_payee_in_db(world):
    """RLS is the real guard: a caretaker's direct UPDATE of the payee VPA matches no rows."""
    with as_user(world.caretaker_a, world.org) as cur:
        cur.execute("UPDATE properties SET upi_vpa = 'thief@ybl' WHERE id = %s", (world.prop_a,))
        assert cur.rowcount == 0


def test_unknown_property_is_404(org):
    r = client.post(
        "/api/v1/properties/00000000-0000-0000-0000-000000000000/upi-from-qr",
        json={"qr_text": PAYTM_QR},
        headers=org["owner"],
    )
    assert r.status_code == 404
