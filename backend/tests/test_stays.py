"""BE-24: notice, withdraw notice, move-out, reserved -> check-in, owner corrections, resident detail."""

from datetime import date, timedelta

import pytest
from conftest import BASE_RENT, World, api_client, as_user

from app import billing
from app.security import create_access_token

client = api_client()


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


def today(w: World) -> date:
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT app.today_ist() AS d")
        return cur.fetchone()["d"]


def make_stay(w: World, status="active", check_in=None, stay_type="monthly") -> str:
    """Owner-created stay (owners may backdate check-in), so move-out dates in the past are valid."""
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, status, rent_paise,
                                  check_in_date, expected_vacate_date)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (
                w.org, w.prop_a, w.resident_a, w.bed_a1, stay_type, status,
                BASE_RENT if stay_type == "monthly" else 800_00,
                check_in or today(w) - timedelta(days=40),
                today(w) + timedelta(days=3) if stay_type == "short_term" else None,
            ),
        )  # fmt: skip
        return str(cur.fetchone()["id"])


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)
    world.ct_b_h = _h(world.caretaker_b, world.org)
    world.stay = make_stay(world)
    return world


def post(w, action, headers, json=None):
    return client.post(f"/api/v1/stays/{w.stay}/{action}", json=json, headers=headers)


def board_bed(w) -> dict:
    r = client.get(f"/api/v1/properties/{w.prop_a}/bed-board", headers=w.ct_a_h)
    assert r.status_code == 200
    return next(b for room in r.json()["rooms"] for b in room["beds"] if b["id"] == str(w.bed_a1))


def audit_entries(w, field: str) -> list:
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            """SELECT actor_id, old_value ->> %s AS old, new_value ->> %s AS new FROM audit_logs
                WHERE entity_type = 'stays' AND entity_id = %s AND action = 'update' ORDER BY id""",
            (field, field, w.stay),
        )
        return [r for r in cur.fetchall() if r["old"] != r["new"]]


@pytest.mark.ac("BE-24", "AC1")
def test_notice_last_day():
    assert billing.notice_last_day(date(2026, 11, 5), 5) == date(2026, 11, 30)
    assert billing.notice_last_day(date(2026, 11, 6), 5) == date(2026, 12, 31)
    assert billing.notice_last_day(date(2026, 12, 6), 5) == date(2027, 1, 31)
    assert billing.notice_last_day(date(2026, 11, 8), 10) == date(2026, 11, 30)
    assert billing.notice_last_day(date(2027, 1, 20), 5) == date(2027, 2, 28)
    assert billing.notice_last_day(date(2028, 1, 31), 28) == date(2028, 2, 29)


@pytest.mark.ac("BE-24", "AC2")
def test_caretaker_notice_uses_today_and_the_rule(w):
    r = post(w, "notice", w.ct_a_h)
    assert r.status_code == 200, r.text
    s = r.json()
    t = today(w)
    assert s["status"] == "on_notice" and s["notice_given_on"] == t.isoformat()
    assert s["expected_vacate_date"] == billing.notice_last_day(t, 5).isoformat()  # property default deadline: 5
    bed = board_bed(w)
    assert bed["status"] == "on_notice"
    assert bed["stay"]["status"] == "on_notice" and bed["stay"]["expected_vacate_date"] == s["expected_vacate_date"]


@pytest.mark.ac("BE-24", "AC3")
def test_caretaker_cannot_backdate_notice_or_pick_the_last_day(w):
    t = today(w)
    r = post(w, "notice", w.ct_a_h, {"notice_given_on": (t - timedelta(days=3)).isoformat()})
    assert r.status_code == 403
    assert "today" in r.json()["error"]["message"]
    wrong = billing.notice_last_day(t, 5) + timedelta(days=1)
    r = post(w, "notice", w.ct_a_h, {"expected_vacate_date": wrong.isoformat()})
    assert r.status_code == 403
    assert "notice rule" in r.json()["error"]["message"]
    with as_user(w.owner, w.org) as cur:
        cur.execute("SELECT status::text, notice_given_on FROM stays WHERE id = %s", (w.stay,))
        assert cur.fetchone() == {"status": "active", "notice_given_on": None}


@pytest.mark.ac("BE-24", "AC4")
def test_owner_can_override_last_day_and_it_is_audited(w):
    waived = billing.month_end(today(w))
    notice = today(w) - timedelta(days=10)
    r = post(
        w, "notice", w.owner_h, {"notice_given_on": notice.isoformat(), "expected_vacate_date": waived.isoformat()}
    )
    assert r.status_code == 200, r.text
    assert (r.json()["notice_given_on"], r.json()["expected_vacate_date"]) == (notice.isoformat(), waived.isoformat())
    entries = audit_entries(w, "expected_vacate_date")
    assert entries and entries[-1]["new"] == waived.isoformat() and entries[-1]["actor_id"] == w.owner


@pytest.mark.ac("BE-24", "AC6")
def test_withdraw_notice(w):
    assert post(w, "notice", w.ct_a_h).status_code == 200
    r = post(w, "withdraw-notice", w.ct_a_h)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["status"] == "active" and s["notice_given_on"] is None and s["expected_vacate_date"] is None
    assert board_bed(w)["status"] == "occupied"
    assert post(w, "withdraw-notice", w.ct_a_h).status_code == 422  # not on notice any more


@pytest.mark.ac("BE-24", "AC7")
def test_caretaker_move_out_today_frees_the_bed(w):
    r = post(w, "move-out", w.ct_a_h, {"actual_vacate_date": today(w).isoformat()})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "vacated" and r.json()["actual_vacate_date"] == today(w).isoformat()
    bed = board_bed(w)
    assert bed["status"] == "vacant" and bed["stay"] is None


@pytest.mark.ac("BE-24", "AC8")
def test_caretaker_move_out_yesterday_is_403(w):
    r = post(w, "move-out", w.ct_a_h, {"actual_vacate_date": (today(w) - timedelta(days=1)).isoformat()})
    assert r.status_code == 403
    assert "today" in r.json()["error"]["message"]
    assert board_bed(w)["status"] == "occupied"


@pytest.mark.ac("BE-24", "AC9")
def test_vacated_stay_only_owner_can_change(w):
    assert post(w, "move-out", w.ct_a_h, {"actual_vacate_date": today(w).isoformat()}).status_code == 200
    # Caretaker: no change to a vacated stay (DB guard), and corrections are owner-only.
    r = post(w, "move-out", w.ct_a_h, {"actual_vacate_date": today(w).isoformat()})
    assert r.status_code == 403 and "vacated" in r.json()["error"]["message"]
    assert (
        client.patch(f"/api/v1/stays/{w.stay}", json={"rent_paise": BASE_RENT + 1}, headers=w.ct_a_h).status_code == 403
    )

    backdated = today(w) - timedelta(days=20)
    r = client.patch(
        f"/api/v1/stays/{w.stay}",
        json={"actual_vacate_date": backdated.isoformat(), "deposit_paise": 1_000_00},
        headers=w.owner_h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["actual_vacate_date"] == backdated.isoformat() and r.json()["deposit_paise"] == 1_000_00
    entries = audit_entries(w, "actual_vacate_date")
    assert entries[-1]["new"] == backdated.isoformat() and entries[-1]["actor_id"] == w.owner


@pytest.mark.ac("BE-24", "AC9")
def test_owner_corrects_check_in_and_move_out_dates(w):
    new_cin = today(w) - timedelta(days=60)
    r = client.patch(f"/api/v1/stays/{w.stay}", json={"check_in_date": new_cin.isoformat()}, headers=w.owner_h)
    assert r.status_code == 200 and r.json()["check_in_date"] == new_cin.isoformat()
    # Caretaker can't change check-in date (DB guard, behind the owner-only route)
    r = client.patch(f"/api/v1/stays/{w.stay}", json={"check_in_date": today(w).isoformat()}, headers=w.ct_a_h)
    assert r.status_code == 403
    # Owner move-out on any date
    r = post(w, "move-out", w.owner_h, {"actual_vacate_date": (today(w) - timedelta(days=5)).isoformat()})
    assert r.status_code == 200 and r.json()["status"] == "vacated"
    # Correcting the move-out date of a stay that hasn't moved out -> 422
    other = make_stay(w)
    r = client.patch(f"/api/v1/stays/{other}", json={"actual_vacate_date": today(w).isoformat()}, headers=w.owner_h)
    assert r.status_code == 422


@pytest.mark.ac("BE-24", "AC10")
def test_reserved_stay_check_in(w):
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE stays SET status = 'vacated', actual_vacate_date = check_in_date WHERE id = %s", (w.stay,))
    w.stay = make_stay(w, status="reserved", check_in=today(w) + timedelta(days=2))
    assert board_bed(w)["status"] == "reserved"
    r = post(w, "check-in", w.ct_a_h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"
    assert board_bed(w)["status"] == "occupied"
    assert post(w, "check-in", w.ct_a_h).status_code == 422


def test_notice_only_for_monthly_stays(w):
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE stays SET status = 'vacated', actual_vacate_date = check_in_date WHERE id = %s", (w.stay,))
    w.stay = make_stay(w, stay_type="short_term", check_in=today(w))
    assert post(w, "notice", w.ct_a_h).status_code == 422


def test_other_property_caretaker_gets_404(w):
    assert client.get(f"/api/v1/stays/{w.stay}", headers=w.ct_b_h).status_code == 404
    assert post(w, "notice", w.ct_b_h).status_code == 404
    assert client.get(f"/api/v1/residents/{w.resident_a}", headers=w.ct_b_h).status_code == 404


def test_resident_detail_with_current_and_past_stays(w):
    assert (
        post(w, "move-out", w.owner_h, {"actual_vacate_date": (today(w) - timedelta(days=1)).isoformat()}).status_code
        == 200
    )
    past = w.stay
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE residents SET id_doc_path = 'onboarding/x/a.jpg' WHERE id = %s", (w.resident_a,))
    w.stay = make_stay(w, check_in=today(w))
    r = client.get(f"/api/v1/residents/{w.resident_a}", headers=w.ct_a_h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["full_name"] == "Anika Rao" and d["phone"]
    assert d["current_stay"]["id"] == w.stay and d["current_stay"]["bed_label"] == "101-A"
    assert d["current_stay"]["room_label"] == "101"
    assert [s["id"] for s in d["past_stays"]] == [past]
    assert "X-Amz-Signature" in d["id_doc_url"] and d["selfie_url"] is None
