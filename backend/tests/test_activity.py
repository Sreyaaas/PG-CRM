"""BE-45: activity feed over the audit log."""

import pytest
from conftest import BASE_RENT, World, api_client, as_user, rand_phone

from app.activity import Names, inr, summarize
from app.security import create_access_token

client = api_client()


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


def _feed(w, **params):
    r = client.get("/api/v1/activity", params=params, headers=_h(w.owner, w.org))
    assert r.status_code == 200, r.text
    return r.json()


def _complaint(cur, w, title="Wi-Fi down", prop=None, **cols):
    values = {"org_id": w.org, "property_id": prop or w.prop_a, "category": "wifi", "title": title} | cols
    cur.execute(
        f"INSERT INTO complaints ({', '.join(values)}) VALUES ({', '.join(['%s'] * len(values))}) RETURNING id",
        list(values.values()),
    )
    return cur.fetchone()["id"]


@pytest.mark.ac("BE-45", "AC1")
def test_owner_sees_newest_first_human_lines_for_own_org(world: World):
    w = world
    with as_user(w.caretaker_a, w.org) as cur:
        cur.execute(
            """INSERT INTO discount_requests (org_id, property_id, bed_id, resident_id, requested_rent_paise, reason)
               VALUES (%s, %s, %s, %s, 900000, 'six months upfront') RETURNING id""",
            (w.org, w.prop_a, w.bed_a1, w.resident_a),
        )
        dr = cur.fetchone()["id"]
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE discount_requests SET status = 'approved' WHERE id = %s", (dr,))
        cur.execute(
            """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, rent_paise, check_in_date)
               VALUES (%s, %s, %s, %s, 'monthly', %s, app.today_ist()) RETURNING id""",
            (w.org, w.prop_a, w.resident_a, w.bed_a1, BASE_RENT),
        )
    with as_user(w.caretaker_a, w.org) as cur:
        _complaint(cur, w, title="AC not cooling", category="ac", priority="urgent")

    feed = _feed(w)
    lines = [f["summary"] for f in feed]
    assert lines[0] == "Ravi raised an urgent ac complaint: AC not cooling"
    assert "Owner checked in Anika Rao on bed 101-A at ₹10,000/month" in lines
    assert "Bed 101-A is now occupied" in lines
    assert "Owner approved the discount for bed 101-A" in lines
    assert "Ravi requested a discounted rent of ₹9,000/month for bed 101-A" in lines
    assert "Owner added building Sunrise HSR" in lines
    assert any(line.startswith("Owner added Ravi as caretaker") for line in lines)
    assert [f["id"] for f in feed] == sorted((f["id"] for f in feed), reverse=True)  # newest first
    top = feed[0]
    assert (top["actor_name"], top["entity_type"], top["action"], top["property_id"]) == (
        "Ravi",
        "complaints",
        "insert",
        str(w.prop_a),
    )

    # Another organization's activity never shows up.
    other = client.post(
        "/api/v1/auth/signup",
        json={"phone": rand_phone(), "full_name": "Other", "password": "s3cret-pass", "organization_name": "Other"},
    ).json()
    other_h = {"Authorization": f"Bearer {other['access_token']}", "X-Org-Id": other["me"]["memberships"][0]["org_id"]}
    client.post("/api/v1/properties", json={"name": "Their Building"}, headers=other_h)
    assert all("Their Building" not in line for line in [f["summary"] for f in _feed(w)])
    their = client.get("/api/v1/activity", headers=other_h).json()
    assert [f["summary"] for f in their] == [
        "Other added building Their Building",
        "Other signed up and created the organization",
    ]
    assert their[1]["actor_id"] is None and their[1]["actor_name"] is None


@pytest.mark.ac("BE-45", "AC2")
def test_property_filter(world: World):
    w = world
    with as_user(w.owner, w.org) as cur:
        _complaint(cur, w, title="Leaking tap", prop=w.prop_b, category="plumbing")
        _complaint(cur, w, title="Noisy fan", prop=w.prop_a, category="other")
    b = _feed(w, property_id=str(w.prop_b))
    assert {f["property_id"] for f in b} == {str(w.prop_b)}
    assert [f["summary"] for f in b] == [
        "Owner raised a plumbing complaint: Leaking tap",
        "Owner added building Lakeview BTM",
    ]
    assert all(f["property_id"] == str(w.prop_a) for f in _feed(w, property_id=str(w.prop_a)))


@pytest.mark.ac("BE-45", "AC3")
def test_caretaker_gets_403(world: World):
    r = client.get("/api/v1/activity", headers=_h(world.caretaker_a, world.org))
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"


@pytest.mark.ac("BE-45", "AC4")
def test_summaries_never_contain_phones_id_numbers_tokens_or_keys(world: World, admin):
    w = world
    phone = rand_phone()
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """INSERT INTO residents (org_id, property_id, full_name, phone, id_doc_type, id_doc_number,
                                      passport_number, visa_number, selfie_path)
               VALUES (%s, %s, 'Lena Fischer', %s, 'passport', 'C01X00T47', 'C01X00T47', 'VISA778899',
                       'onboarding/x/0b0c.jpg') RETURNING id""",
            (w.org, w.prop_a, phone),
        )
        _complaint(cur, w, title=f"Call Lena on {phone}, Aadhaar 1234 5678 9012", note="ignored")
    resident_phone = admin.execute("SELECT phone FROM residents WHERE id = %s", (w.resident_a,)).fetchone()["phone"]
    staff_phones = [
        r["phone"]
        for r in admin.execute(
            "SELECT phone FROM users WHERE id = ANY(%s)", ([w.owner, w.caretaker_a, w.caretaker_b],)
        ).fetchall()
    ]

    text = " ".join(f["summary"] for f in _feed(w, limit=200))
    assert "Owner added resident Lena Fischer" in text
    for secret in (
        phone,
        resident_phone,
        *staff_phones,
        "C01X00T47",
        "VISA778899",
        "1234 5678 9012",
        "onboarding/x/0b0c.jpg",
    ):
        assert secret not in text, secret
    assert f"{phone[:2]}******{phone[-2:]}" in text  # typed into a title: masked, not leaked


@pytest.mark.ac("BE-45", "AC5")
def test_limit_defaults_to_50_and_is_capped_at_200(world: World):
    with as_user(world.owner, world.org) as cur:
        for i in range(55):
            _complaint(cur, world, title=f"Bulb {i} fused", category="electricity")
    assert len(_feed(world)) == 50
    assert len(_feed(world, limit=3)) == 3
    assert len(_feed(world, limit=200)) > 50
    for bad in (0, 201):
        r = client.get("/api/v1/activity", params={"limit": bad}, headers=_h(world.owner, world.org))
        assert r.status_code == 422


def test_inr_and_fallback_lines():
    assert [inr(p) for p in (0, 50, 1_250_00, 1_50_000_00, 12_34_567_89)] == [
        "₹0",
        "₹0.50",
        "₹1,250",
        "₹1,50,000",
        "₹12,34,567.89",
    ]
    assert summarize("csv_imports", "insert", None, {}, "Meera", Names()) == "Meera created a statement upload"
    assert summarize("exit_settlements", "update", {}, {}, "Meera", Names()) == "Meera updated an exit settlement"
    assert summarize("csv_imports", "insert", None, {}, None, Names()) == "System created a statement upload"
