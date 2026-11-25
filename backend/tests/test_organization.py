"""BE-14: organization settings."""

import pytest
from conftest import World, api_client, as_user, raises_sqlstate

from app.security import create_access_token

client = api_client()
GSTIN = "29ABCDE1234F1Z5"


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


def _get(headers):
    r = client.get("/api/v1/organization", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _patch(headers, **body):
    return client.patch("/api/v1/organization", json=body, headers=headers)


@pytest.mark.ac("BE-14", "AC1")
def test_owner_patch_changes_only_fields_sent(world: World):
    owner = _h(world.owner, world.org)
    before = _get(owner)
    assert before["name"] == "Test PGs" and before["id"] == str(world.org)

    r = _patch(owner, gstin=GSTIN, receipt_footer="Thank you! Rent is due by the 5th.")
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["gstin"] == GSTIN and after["receipt_footer"] == "Thank you! Rent is due by the 5th."
    assert (after["name"], after["whatsapp_language"]) == (before["name"], before["whatsapp_language"])
    assert _get(owner) == after

    after = _patch(owner, name="  Sunrise Stays  ", whatsapp_language="kn").json()
    assert (after["name"], after["whatsapp_language"], after["gstin"]) == ("Sunrise Stays", "kn", GSTIN)
    assert _patch(owner, gstin=None).json()["gstin"] is None  # cleared
    assert _patch(owner).json() == _get(owner)  # empty patch = no change


@pytest.mark.ac("BE-14", "AC2")
def test_caretaker_can_read_but_not_change(world: World):
    ct = _h(world.caretaker_a, world.org)
    assert _get(ct)["name"] == "Test PGs"
    r = _patch(ct, name="Hacked")
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert _get(_h(world.owner, world.org))["name"] == "Test PGs"


@pytest.mark.ac("BE-14", "AC2")
def test_db_blocks_caretaker_update(world: World):
    with as_user(world.caretaker_a, world.org) as cur:
        cur.execute("UPDATE organizations SET whatsapp_language = 'hi' WHERE id = %s", (world.org,))
        assert cur.rowcount == 0


@pytest.mark.ac("BE-14", "AC3")
@pytest.mark.parametrize(
    "body",
    [
        {"gstin": "29ABCDE1234F1Z"},  # too short
        {"gstin": "29abcde1234f1z5"},  # lower case
        {"gstin": "ABCDE1234F1Z529"},
        {"whatsapp_language": "fr"},
        {"whatsapp_language": None},
        {"name": "  "},
        {"receipt_footer": "x" * 301},
        {"id": "00000000-0000-0000-0000-000000000000"},
    ],
)
def test_invalid_settings_are_422(world: World, body):
    r = _patch(_h(world.owner, world.org), **body)
    assert r.status_code == 422, body


@pytest.mark.ac("BE-14", "AC3")
def test_db_checks_gstin_and_language(world: World):
    for change in ("gstin = 'NOT-A-GSTIN'", "whatsapp_language = 'fr'"):
        with raises_sqlstate("23514"), as_user(world.owner, world.org) as cur:
            cur.execute(f"UPDATE organizations SET {change} WHERE id = %s", (world.org,))


@pytest.mark.ac("BE-14", "AC4")
def test_language_defaults_to_english(world: World, admin):
    assert _get(_h(world.owner, world.org))["whatsapp_language"] == "en"
    missing = admin.execute("SELECT count(*) AS n FROM organizations WHERE whatsapp_language IS NULL").fetchone()
    assert missing["n"] == 0  # existing organizations got the default too
