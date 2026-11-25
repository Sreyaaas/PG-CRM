"""The anti-theft guarantees, proven against a real Postgres.

These tests are the spec for the database. A Rust backend later must pass the
same behaviour because the rules live in SQL, not in Python.
"""

from uuid import uuid4

import pytest
from conftest import BASE_RENT, World, api_client, as_user, raises_sqlstate, rand_phone, rand_utr

# --------------------------------------------------------------------------
# Multi-tenant isolation
# --------------------------------------------------------------------------


def test_caretaker_sees_only_assigned_property(world: World):
    with as_user(world.caretaker_b, world.org) as cur:
        cur.execute("SELECT id FROM properties")
        assert [r["id"] for r in cur.fetchall()] == [world.prop_b]
        cur.execute("SELECT count(*) AS n FROM residents")
        assert cur.fetchone()["n"] == 0


def test_caretaker_cannot_write_to_unassigned_property(world: World):
    with raises_sqlstate("42501"), as_user(world.caretaker_b, world.org) as cur:
        cur.execute(
            "INSERT INTO residents (org_id, property_id, full_name, phone) VALUES (%s, %s, 'X', %s)",
            (world.org, world.prop_a, rand_phone()),
        )


def test_other_org_owner_sees_nothing(world: World):
    other = World.__new__(World)
    with as_user(None) as cur:
        cur.execute("SELECT * FROM api.signup_owner(%s, 'Other', 'x', 'Other PGs')", (rand_phone(),))
        other.owner = cur.fetchone()["user_id"]
    # Even if the attacker sends our org id, membership is checked in the DB.
    with as_user(other.owner, world.org) as cur:
        cur.execute("SELECT count(*) AS n FROM properties")
        assert cur.fetchone()["n"] == 0
        cur.execute("SELECT count(*) AS n FROM payments")
        assert cur.fetchone()["n"] == 0


def test_no_context_sees_nothing(world: World):
    with as_user(None) as cur:
        for table in ("properties", "residents", "payments", "expenses", "users"):
            cur.execute(f"SELECT count(*) AS n FROM {table}")
            assert cur.fetchone()["n"] == 0, table


def test_api_role_cannot_read_password_hashes(world: World):
    with raises_sqlstate("42501"), as_user(world.owner, world.org) as cur:
        cur.execute("SELECT password_hash FROM users")


# --------------------------------------------------------------------------
# Threat #3: floor-price lock + discount approval
# --------------------------------------------------------------------------


def _stay(cur, w: World, rent: int, discount_request_id=None, bed=None):
    cur.execute(
        """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, rent_paise,
                              deposit_paise, check_in_date, discount_request_id)
           VALUES (%s, %s, %s, %s, 'monthly', %s, 2000000, app.today_ist(), %s) RETURNING id""",
        (w.org, w.prop_a, w.resident_a, bed or w.bed_a1, rent, discount_request_id),
    )
    return cur.fetchone()["id"]


def test_caretaker_cannot_set_rent_below_floor(world: World):
    with raises_sqlstate("PC002"), as_user(world.caretaker_a, world.org) as cur:
        _stay(cur, world, BASE_RENT - 2_000_00)


def test_discount_needs_owner_approval(world: World):
    with as_user(world.caretaker_a, world.org) as cur:
        cur.execute(
            """INSERT INTO discount_requests (org_id, property_id, bed_id, resident_id, requested_rent_paise,
                                              reason, requested_by)
               VALUES (%s, %s, %s, %s, %s, 'long stay, 6 months upfront', %s) RETURNING id, status""",
            (world.org, world.prop_a, world.bed_a1, world.resident_a, 9_000_00, world.owner),
        )
        req = cur.fetchone()
        assert req["status"] == "pending"

    # Caretaker cannot approve their own request
    with raises_sqlstate("PC002", "42501"), as_user(world.caretaker_a, world.org) as cur:
        cur.execute("UPDATE discount_requests SET status = 'approved' WHERE id = %s", (req["id"],))

    # Pending request does not unlock the discount
    with raises_sqlstate("PC002"), as_user(world.caretaker_a, world.org) as cur:
        _stay(cur, world, 9_000_00, req["id"])

    with as_user(world.owner, world.org) as cur:
        cur.execute("UPDATE discount_requests SET status = 'approved' WHERE id = %s", (req["id"],))

    # Approved amount only — not a rupee lower
    with raises_sqlstate("PC002"), as_user(world.caretaker_a, world.org) as cur:
        _stay(cur, world, 8_500_00, req["id"])

    with as_user(world.caretaker_a, world.org) as cur:
        stay = _stay(cur, world, 9_000_00, req["id"])
        cur.execute("SELECT status FROM beds WHERE id = %s", (world.bed_a1,))
        assert cur.fetchone()["status"] == "occupied"
        assert stay


def test_owner_can_set_any_rent(world: World):
    with as_user(world.owner, world.org) as cur:
        assert _stay(cur, world, 5_000_00)


# --------------------------------------------------------------------------
# Threat #4: no deletes, no backdating, immutable audit
# --------------------------------------------------------------------------


def test_deletes_are_impossible(world: World, admin):
    with as_user(world.owner, world.org) as cur:
        cur.execute(
            """INSERT INTO payments (org_id, property_id, resident_id, amount_paise, method, status, received_by)
               VALUES (%s, %s, %s, 500000, 'cash', 'recorded', %s) RETURNING id""",
            (world.org, world.prop_a, world.resident_a, world.owner),
        )
        pid = cur.fetchone()["id"]
    # API role has no DELETE privilege at all
    with raises_sqlstate("42501"), as_user(world.owner, world.org) as cur:
        cur.execute("DELETE FROM payments WHERE id = %s", (pid,))
    # Even a superuser is stopped by the trigger
    with raises_sqlstate("PC001"):
        admin.execute("DELETE FROM payments WHERE id = %s", (pid,))
    with raises_sqlstate("PC001"):
        admin.execute("DELETE FROM residents WHERE id = %s", (world.resident_a,))


def test_caretaker_cannot_backdate_move_out(world: World):
    with as_user(world.caretaker_a, world.org) as cur:
        stay = _stay(cur, world, BASE_RENT)
    with raises_sqlstate("PC002"), as_user(world.caretaker_a, world.org) as cur:
        cur.execute(
            "UPDATE stays SET status='vacated', actual_vacate_date = app.today_ist() - 1 WHERE id = %s", (stay,)
        )
    with as_user(world.caretaker_a, world.org) as cur:
        cur.execute("UPDATE stays SET status='vacated', actual_vacate_date = app.today_ist() WHERE id = %s", (stay,))
        cur.execute("SELECT status FROM beds WHERE id = %s", (world.bed_a1,))
        assert cur.fetchone()["status"] == "vacant"
    # Once vacated, only the owner may touch it
    with raises_sqlstate("PC002"), as_user(world.caretaker_a, world.org) as cur:
        cur.execute("UPDATE stays SET notice_given_on = app.today_ist() WHERE id = %s", (stay,))


def test_caretaker_cannot_backdate_check_in(world: World):
    with raises_sqlstate("PC002"), as_user(world.caretaker_a, world.org) as cur:
        cur.execute(
            """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, rent_paise,
                                  check_in_date)
               VALUES (%s, %s, %s, %s, 'monthly', %s, app.today_ist() - 20)""",
            (world.org, world.prop_a, world.resident_a, world.bed_a1, BASE_RENT),
        )


def test_audit_log_written_and_immutable(world: World, admin):
    with as_user(world.caretaker_a, world.org) as cur:
        _stay(cur, world, BASE_RENT)
    with as_user(world.owner, world.org) as cur:
        cur.execute("SELECT actor_id, action FROM audit_logs WHERE entity_type = 'stays' AND org_id = %s", (world.org,))
        rows = cur.fetchall()
        assert rows and rows[0]["actor_id"] == world.caretaker_a
    with as_user(world.caretaker_a, world.org) as cur:
        cur.execute("SELECT count(*) AS n FROM audit_logs")
        assert cur.fetchone()["n"] == 0  # owner-only
    with raises_sqlstate("PC001"):
        admin.execute("UPDATE audit_logs SET action = 'x' WHERE org_id = %s", (world.org,))
    with raises_sqlstate("PC001"):
        admin.execute("DELETE FROM audit_logs WHERE org_id = %s", (world.org,))


# --------------------------------------------------------------------------
# Threats #1 and #5: payments, UTRs, cash in hand
# --------------------------------------------------------------------------


def _pay(cur, w: World, amount: int, method: str = "cash", utr: str | None = None, status: str = "verified"):
    cur.execute(
        """INSERT INTO payments (org_id, property_id, resident_id, amount_paise, method, utr_number,
                                 status, received_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, status, received_by""",
        (w.org, w.prop_a, w.resident_a, amount, method, utr, status, w.owner),
    )
    return cur.fetchone()


def test_payment_status_and_receiver_are_forced(world: World):
    with as_user(world.caretaker_a, world.org) as cur:
        upi = _pay(cur, world, 1_000_000, "upi", rand_utr(), status="verified")
        cash = _pay(cur, world, 500_000, "cash", status="verified")
    assert upi["status"] == "provisional"  # caretakers can never self-verify
    assert cash["status"] == "recorded"
    assert upi["received_by"] == world.caretaker_a  # cannot attribute cash to someone else


def test_duplicate_utr_rejected(world: World):
    utr = rand_utr()
    with as_user(world.caretaker_a, world.org) as cur:
        _pay(cur, world, 1_000_000, "upi", utr)
    with raises_sqlstate("23505"), as_user(world.caretaker_a, world.org) as cur:
        _pay(cur, world, 1_000_000, "upi", utr)


def test_payment_amount_immutable_and_only_owner_verifies(world: World):
    with as_user(world.caretaker_a, world.org) as cur:
        pid = _pay(cur, world, 1_000_000, "upi", rand_utr())["id"]
    with raises_sqlstate("PC002"), as_user(world.caretaker_a, world.org) as cur:
        cur.execute("UPDATE payments SET status = 'verified' WHERE id = %s", (pid,))
    with raises_sqlstate("PC001"), as_user(world.owner, world.org) as cur:
        cur.execute("UPDATE payments SET amount_paise = 1 WHERE id = %s", (pid,))
    with as_user(world.owner, world.org) as cur:
        cur.execute("UPDATE payments SET status = 'verified' WHERE id = %s RETURNING verified_by", (pid,))
        assert cur.fetchone()["verified_by"] == world.owner


def test_cash_in_hand_ledger(world: World):
    with as_user(world.caretaker_a, world.org) as cur:
        _pay(cur, world, 8_000_000, "cash")  # ₹80,000 collected
        cur.execute(
            """INSERT INTO expenses (org_id, property_id, category, amount_paise, expense_date, bill_mode,
                                     proof_path, paid_from, created_by)
               VALUES (%s, %s, 'groceries', 300000, app.today_ist(), 'has_bill', 'bills/x.jpg',
                       'caretaker_cash', %s)""",
            (world.org, world.prop_a, world.owner),
        )
    # Caretaker cannot reduce their own balance
    with raises_sqlstate("PC002", "42501"), as_user(world.caretaker_a, world.org) as cur:
        cur.execute(
            "INSERT INTO cash_handovers (org_id, caretaker_user_id, amount_paise, recorded_by) "
            "VALUES (%s, %s, 7000000, %s)",
            (world.org, world.caretaker_a, world.caretaker_a),
        )
    with as_user(world.owner, world.org) as cur:
        cur.execute(
            "INSERT INTO cash_handovers (org_id, caretaker_user_id, amount_paise, recorded_by) "
            "VALUES (%s, %s, 7000000, %s)",
            (world.org, world.caretaker_a, world.owner),
        )
        cur.execute("SELECT * FROM api.cash_balances()")
        balances = {r["user_id"]: r for r in cur.fetchall()}
    a = balances[world.caretaker_a]
    assert (a["collected_paise"], a["spent_paise"], a["handed_over_paise"]) == (8_000_000, 300_000, 7_000_000)
    assert a["in_hand_paise"] == 700_000  # ₹7,000 still with Ravi

    with as_user(world.caretaker_a, world.org) as cur:
        cur.execute("SELECT user_id FROM api.cash_balances()")
        assert [r["user_id"] for r in cur.fetchall()] == [world.caretaker_a]


# --------------------------------------------------------------------------
# Threat #6: no-bill expenses + owner-only categories
# --------------------------------------------------------------------------


def _expense(cur, w: World, **over):
    vals = {
        "category": "water_tanker",
        "amount_paise": 150_000,
        "bill_mode": "no_bill",
        "notes": "3 tanker loads",
        "proof_path": "exp/1.jpg",
        "paid_from": "caretaker_cash",
        "lat": 12.9121,
        "lng": 77.6446,
        "captured": "now()",
    } | over
    cur.execute(
        f"""INSERT INTO expenses (org_id, property_id, category, amount_paise, expense_date, bill_mode, notes,
                                  proof_path, proof_captured_at, proof_lat, proof_lng, paid_from, created_by)
            VALUES (%s, %s, %s, %s, app.today_ist(), %s, %s, %s, {vals["captured"]}, %s, %s, %s, %s)
            RETURNING flagged_for_review""",
        (
            w.org,
            w.prop_a,
            vals["category"],
            vals["amount_paise"],
            vals["bill_mode"],
            vals["notes"],
            vals["proof_path"],
            vals["lat"],
            vals["lng"],
            vals["paid_from"],
            w.owner,
        ),
    )
    return cur.fetchone()


def test_no_bill_expense_is_flagged(world: World):
    with as_user(world.caretaker_a, world.org) as cur:
        assert _expense(cur, world)["flagged_for_review"] is True


def test_no_bill_expense_requires_gps_note_and_fresh_photo(world: World):
    for bad in ({"lat": None}, {"notes": ""}, {"captured": "now() - interval '2 hours'"}):
        with raises_sqlstate("PC003"), as_user(world.caretaker_a, world.org) as cur:
            _expense(cur, world, **bad)


def test_caretaker_cannot_see_or_log_owner_only_expenses(world: World):
    with as_user(world.owner, world.org) as cur:
        _expense(
            cur, world, category="lease_rent", bill_mode="has_bill", paid_from="owner_direct", amount_paise=150_000_00
        )
    with as_user(world.caretaker_a, world.org) as cur:
        cur.execute("SELECT count(*) AS n FROM expenses WHERE category = 'lease_rent'")
        assert cur.fetchone()["n"] == 0
    with raises_sqlstate("PC002"), as_user(world.caretaker_a, world.org) as cur:
        _expense(cur, world, category="lease_rent", bill_mode="has_bill")


def test_owner_pnl_is_owner_only(world: World):
    with raises_sqlstate("PC002"), as_user(world.caretaker_a, world.org) as cur:
        cur.execute("SELECT * FROM api.owner_pnl(app.today_ist() - 30, app.today_ist())")
    with as_user(world.owner, world.org) as cur:
        cur.execute("SELECT * FROM api.owner_pnl(app.today_ist() - 30, app.today_ist())")
        assert len(cur.fetchall()) == 2


# --------------------------------------------------------------------------
# Public surfaces
# --------------------------------------------------------------------------


def test_public_receipt_shows_no_private_data(world: World):
    with as_user(world.caretaker_a, world.org) as cur:
        pid = _pay(cur, world, 1_000_000, "upi", rand_utr())["id"]
        cur.execute("SELECT public_token FROM payments WHERE id = %s", (pid,))
        token = cur.fetchone()["public_token"]
    with as_user(None) as cur:
        cur.execute("SELECT api.public_get_document(%s) AS d", (token,))
        doc = cur.fetchone()["d"]
        cur.execute("SELECT api.public_get_document(%s) AS d", ("0" * 64,))
        assert cur.fetchone()["d"] is None
    assert doc["type"] == "payment_receipt" and doc["resident_name"] == "Anika Rao"
    assert "phone" not in str(doc) and doc["status"] == "provisional"


def test_public_onboarding_intake(world: World):
    with as_user(world.owner, world.org) as cur:
        cur.execute("SELECT qr_slug FROM properties WHERE id = %s", (world.prop_a,))
        slug = cur.fetchone()["qr_slug"]
    payload = {
        "full_name": "Kiran M",
        "phone": rand_phone(),
        "permanent_address": "Mysuru",
        "occupation": "working",
        "employer_or_college": "Infosys",
        "emergency_contact_name": "Parent",
        "emergency_contact_phone": "9876543210",
        "id_doc_type": "aadhaar",
        "id_doc_number": "XXXX-1234",
        "id_doc_path": f"onboarding/{world.prop_a}/{uuid4()}.jpg",
        "selfie_path": f"onboarding/{world.prop_a}/{uuid4()}.jpg",
        "accepted_rules": True,
        "accepted_exit_deduction_paise": 2_000_00,
    }
    import json

    with as_user(None) as cur:
        cur.execute("SELECT api.public_submit_onboarding(%s, %s::jsonb) AS id", (slug, json.dumps(payload)))
        assert cur.fetchone()["id"]
    # Same phone again while pending -> rejected (spam guard)
    with raises_sqlstate("PC003"), as_user(None) as cur:
        cur.execute("SELECT api.public_submit_onboarding(%s, %s::jsonb)", (slug, json.dumps(payload)))
    with as_user(world.caretaker_a, world.org) as cur:
        cur.execute("SELECT count(*) AS n FROM onboarding_requests WHERE status = 'pending'")
        assert cur.fetchone()["n"] == 1
    with as_user(world.caretaker_b, world.org) as cur:
        cur.execute("SELECT count(*) AS n FROM onboarding_requests")
        assert cur.fetchone()["n"] == 0


def test_public_onboarding_photos_must_belong_to_that_property(world: World):
    """BE-21: an onboarding request can only reference keys uploaded through that property's QR form."""
    import json

    with as_user(world.owner, world.org) as cur:
        cur.execute("SELECT qr_slug FROM properties WHERE id = %s", (world.prop_a,))
        slug = cur.fetchone()["qr_slug"]
    good = f"onboarding/{world.prop_a}/{uuid4()}.jpg"
    base = {
        "full_name": "Kiran M", "phone": rand_phone(), "permanent_address": "Mysuru", "occupation": "working",
        "emergency_contact_name": "Parent", "emergency_contact_phone": "9876543210", "id_doc_type": "aadhaar",
        "id_doc_number": "XXXX-1234", "id_doc_path": good, "selfie_path": good, "accepted_rules": True,
        "accepted_exit_deduction_paise": 2_000_00,
    }  # fmt: skip
    for bad in (
        f"onboarding/{world.prop_b}/{uuid4()}.jpg",  # another building
        f"org/{world.org}/{world.prop_a}/selfie/{uuid4()}.jpg",  # a staff upload
        f"onboarding/{world.prop_a}/../{world.prop_b}/{uuid4()}.jpg",
        None,
    ):
        for field in ("id_doc_path", "selfie_path"):
            with raises_sqlstate("PC003"), as_user(None) as cur:
                cur.execute(
                    "SELECT api.public_submit_onboarding(%s, %s::jsonb)", (slug, json.dumps(base | {field: bad}))
                )
    with as_user(None) as cur:
        cur.execute("SELECT api.public_submit_onboarding(%s, %s::jsonb) AS id", (slug, json.dumps(base)))
        assert cur.fetchone()["id"]


# --------------------------------------------------------------------------
# BE-22: joining charges can't be lowered by caretakers
# --------------------------------------------------------------------------


def test_caretaker_deposit_cannot_be_below_property_deposit(world: World):
    with as_user(world.owner, world.org) as cur:
        cur.execute("UPDATE properties SET security_deposit_paise = 2000000 WHERE id = %s", (world.prop_a,))
    with raises_sqlstate("PC002"), as_user(world.caretaker_a, world.org) as cur:
        cur.execute(
            """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, rent_paise, deposit_paise,
                                  check_in_date)
               VALUES (%s, %s, %s, %s, 'monthly', %s, 1999999, app.today_ist())""",
            (world.org, world.prop_a, world.resident_a, world.bed_a1, BASE_RENT),
        )
    with as_user(world.caretaker_a, world.org) as cur:
        assert _stay(cur, world, BASE_RENT)  # deposit 2000000 = the property's amount
    with as_user(world.owner, world.org) as cur:  # owners may take any deposit
        cur.execute(
            "INSERT INTO residents (org_id, property_id, full_name, phone) VALUES (%s, %s, 'B', %s) RETURNING id",
            (world.org, world.prop_a, rand_phone()),
        )
        other = cur.fetchone()["id"]
        cur.execute(
            """INSERT INTO stays (org_id, property_id, resident_id, bed_id, stay_type, rent_paise, deposit_paise,
                                  check_in_date)
               VALUES (%s, %s, %s, %s, 'monthly', %s, 0, app.today_ist())""",
            (world.org, world.prop_a, other, world.bed_a2, BASE_RENT),
        )


def test_caretaker_maintenance_charge_cannot_be_below_property_value(world: World):
    with as_user(world.owner, world.org) as cur:
        cur.execute("UPDATE properties SET maintenance_charge_paise = 100000 WHERE id = %s", (world.prop_a,))

    def invoice(cur, kind, amount):
        cur.execute(
            """INSERT INTO invoices (org_id, property_id, resident_id, kind, amount_paise, due_date)
               VALUES (%s, %s, %s, %s, %s, app.today_ist()) RETURNING id""",
            (world.org, world.prop_a, world.resident_a, kind, amount),
        )
        return cur.fetchone()["id"]

    with raises_sqlstate("PC002"), as_user(world.caretaker_a, world.org) as cur:
        invoice(cur, "maintenance_charge", 99999)
    with as_user(world.caretaker_a, world.org) as cur:
        assert invoice(cur, "maintenance_charge", 100000)
        assert invoice(cur, "other", 500)  # only the maintenance charge has this floor
    with as_user(world.owner, world.org) as cur:
        assert invoice(cur, "maintenance_charge", 100)


# --------------------------------------------------------------------------
# BE-24: notice rule (caretakers can't backdate notice or pick the last day)
# --------------------------------------------------------------------------


@pytest.mark.ac("BE-24", "AC1", "AC5")
def test_notice_last_day_sql_matches_python(world: World):
    from datetime import date, timedelta

    from app.billing import notice_last_day

    cases = [(date(2026, 11, 5), 5), (date(2026, 11, 6), 5), (date(2026, 12, 6), 5), (date(2026, 11, 8), 10)]
    start = date(2027, 12, 1)
    cases += [(start + timedelta(days=i), d) for i in range(0, 400, 3) for d in (1, 5, 15, 28)]
    with as_user(world.owner, world.org) as cur:
        for notice, deadline in cases:
            cur.execute("SELECT app.notice_last_day(%s::date, %s::smallint) AS d", (notice, deadline))
            assert cur.fetchone()["d"] == notice_last_day(notice, deadline), (notice, deadline)


@pytest.mark.ac("BE-24", "AC3")
def test_caretaker_notice_must_be_today_with_computed_last_day(world: World):
    with as_user(world.caretaker_a, world.org) as cur:
        stay = _stay(cur, world, BASE_RENT)

    def give(user, notice_sql: str, last_sql: str):
        with as_user(user, world.org) as cur:
            cur.execute(
                f"""UPDATE stays SET status = 'on_notice', notice_given_on = {notice_sql},
                                     expected_vacate_date = {last_sql} WHERE id = %s""",
                (stay,),
            )

    rule = "app.notice_last_day({}, 5::smallint)"
    with raises_sqlstate("PC002"):  # backdated (with a matching last day)
        give(world.caretaker_a, "app.today_ist() - 1", rule.format("app.today_ist() - 1"))
    with raises_sqlstate("PC002"):  # today, but a different last day
        give(world.caretaker_a, "app.today_ist()", rule.format("app.today_ist()") + " + 31")
    give(world.caretaker_a, "app.today_ist()", rule.format("app.today_ist()"))
    with raises_sqlstate("PC002"):  # moving the last day afterwards
        give(world.caretaker_a, "notice_given_on", "expected_vacate_date + 1")
    # Withdrawing (both cleared) is allowed; owners may set anything.
    give(world.caretaker_a, "NULL", "NULL")
    give(world.owner, "app.today_ist() - 20", "app.today_ist() + 3")


def _session_user(c) -> dict:
    """Sign up through the API so a real session (refresh token) exists."""
    r = c.post(
        "/api/v1/auth/signup",
        json={"phone": rand_phone(), "full_name": "Meera", "password": "s3cret-pass", "organization_name": "M PGs"},
    )
    assert r.status_code == 201, r.text
    return {"phone": r.json()["me"]["phone"], **r.json()}


# --------------------------------------------------------------------------
# BE-51: sessions and rate limits
# --------------------------------------------------------------------------


def test_users_only_see_and_change_their_own_sessions(admin):
    c = api_client()
    a, b = _session_user(c), _session_user(c)
    ids = {
        k: admin.execute("SELECT id FROM users WHERE phone = %s", (u["phone"],)).fetchone()["id"]
        for k, u in (("a", a), ("b", b))
    }
    with as_user(ids["a"]) as cur:
        cur.execute("SELECT DISTINCT user_id FROM sessions")
        assert [r["user_id"] for r in cur.fetchall()] == [ids["a"]]
        cur.execute("UPDATE sessions SET revoked_at = now() WHERE user_id = %s", (ids["b"],))
        assert cur.rowcount == 0
    with raises_sqlstate("42501"), as_user(ids["a"]) as cur:
        cur.execute("UPDATE sessions SET expires_at = now() + interval '10 years' WHERE user_id = %s", (ids["a"],))
    with raises_sqlstate("42501"), as_user(ids["a"]) as cur:
        cur.execute("SELECT * FROM rate_limit_events")
    assert c.post("/api/v1/auth/refresh", json={"refresh_token": b["refresh_token"]}).status_code == 200


def test_revoked_session_cannot_be_revived_or_deleted(admin):
    c = api_client()
    user = _session_user(c)
    c.post("/api/v1/auth/logout", json={"refresh_token": user["refresh_token"]})
    with raises_sqlstate("PC001"):
        admin.execute(
            "UPDATE sessions SET revoked_at = NULL WHERE user_id = (SELECT id FROM users WHERE phone = %s)",
            (user["phone"],),
        )
    with raises_sqlstate("PC001"):
        admin.execute("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE phone = %s)", (user["phone"],))


# --------------------------------------------------------------------------
# BE-26: complaints
# --------------------------------------------------------------------------


def _complaint(cur, w: World, **cols):
    values = {"org_id": w.org, "property_id": w.prop_a, "category": "wifi", "title": "Wi-Fi down"} | cols
    cur.execute(
        f"INSERT INTO complaints ({', '.join(values)}) VALUES ({', '.join(['%s'] * len(values))}) RETURNING *",
        list(values.values()),
    )
    return cur.fetchone()


@pytest.mark.ac("BE-26", "AC1")
def test_complaint_created_by_and_status_are_forced(world: World):
    with as_user(world.caretaker_a, world.org) as cur:
        c = _complaint(cur, world, created_by=world.owner, status="resolved", resolution_note="fake")
    assert c["created_by"] == world.caretaker_a and c["status"] == "open" and c["resolution_note"] is None


@pytest.mark.ac("BE-26", "AC6")
def test_complaints_cannot_be_deleted_even_by_superuser(world: World, admin):
    with as_user(world.owner, world.org) as cur:
        c = _complaint(cur, world)
    with raises_sqlstate("42501"), as_user(world.owner, world.org) as cur:
        cur.execute("DELETE FROM complaints WHERE id = %s", (c["id"],))
    with raises_sqlstate("PC001"):
        admin.execute("DELETE FROM complaints WHERE id = %s", (c["id"],))


@pytest.mark.ac("BE-26", "AC3")
def test_complaint_resolution_rules_in_db(world: World):
    with as_user(world.caretaker_a, world.org) as cur:
        c = _complaint(cur, world)
    with raises_sqlstate("PC003"), as_user(world.caretaker_a, world.org) as cur:
        cur.execute("UPDATE complaints SET status = 'resolved', resolution_note = 'x' WHERE id = %s", (c["id"],))
    with as_user(world.caretaker_a, world.org) as cur:
        cur.execute(
            """UPDATE complaints SET status = 'resolved', resolution_note = 'Fixed the tap',
                      resolved_by = %s, resolved_at = now() - interval '9 days'
                WHERE id = %s RETURNING resolved_by, resolved_at > now() - interval '1 minute' AS just_now""",
            (world.owner, c["id"]),
        )
        row = cur.fetchone()
    assert row["resolved_by"] == world.caretaker_a and row["just_now"]  # stamped by the DB, not the caller


def test_complaint_history_fields_are_immutable(world: World):
    with as_user(world.caretaker_a, world.org) as cur:
        c = _complaint(cur, world)
    for change in (
        f"property_id = '{world.prop_b}'",
        "created_at = now() - interval '1 day'",
        "photo_path = 'x'",
    ):
        with raises_sqlstate("PC001", "42501"), as_user(world.owner, world.org) as cur:
            cur.execute(f"UPDATE complaints SET {change} WHERE id = %s", (c["id"],))
