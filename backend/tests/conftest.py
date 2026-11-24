"""Test fixtures.

Tests need a migrated Postgres. Point PGCRM_DATABASE_URL at it (default: the
docker-compose database). Each test builds its own organization with random
phone numbers, so tests never interfere and no DB reset is needed.
"""

import os
import random
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from uuid import UUID

os.environ.setdefault("PGCRM_DATABASE_URL", "postgresql://pgcrm:pgcrm@localhost:5432/pgcrm")
os.environ.setdefault("PGCRM_ENVIRONMENT", "test")

import psycopg  # noqa: E402
import pytest  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

from app.db import transaction  # noqa: E402

# @pytest.mark.ac("BE-31", "AC1") + --ac-report (see ticket_plugin.py, tools/verify_ticket.py)
pytest_plugins = ["ticket_plugin"]

BASE_RENT = 10_000_00  # ₹10,000 in paise


def rand_phone() -> str:
    return "9" + "".join(random.choices("0123456789", k=9))


def rand_ip() -> str:
    return "10." + ".".join(str(random.randint(0, 255)) for _ in range(3))


def api_client():
    """A TestClient with its own random client IP, so per-IP rate limits (BE-51) never build up across test
    modules or repeated runs (every plain TestClient is "testclient")."""
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app, client=(rand_ip(), 50000))


def rand_utr() -> str:
    return "".join(random.choices("0123456789", k=12))


@contextmanager
def as_user(user_id: UUID | None, org_id: UUID | None = None):
    with transaction(user_id, org_id) as cur:
        yield cur


@contextmanager
def raises_sqlstate(*states: str) -> Iterator[None]:
    with pytest.raises(psycopg.Error) as exc:
        yield
    assert exc.value.sqlstate in states, f"expected {states}, got {exc.value.sqlstate}: {exc.value}"


@dataclass
class World:
    org: UUID
    owner: UUID
    caretaker_a: UUID  # assigned to property A only
    caretaker_b: UUID  # assigned to property B only
    prop_a: UUID
    prop_b: UUID
    bed_a1: UUID
    bed_a2: UUID
    resident_a: UUID


@pytest.fixture(scope="session")
def admin() -> Iterator[psycopg.Connection]:
    """Superuser connection, bypasses RLS. Only for proving triggers hold even then."""
    with psycopg.connect(os.environ["PGCRM_DATABASE_URL"], autocommit=True, row_factory=dict_row) as c:
        yield c


@pytest.fixture
def world() -> World:
    with as_user(None) as cur:
        cur.execute("SELECT * FROM api.signup_owner(%s, 'Owner', 'x', 'Test PGs')", (rand_phone(),))
        row = cur.fetchone()
    owner, org = row["user_id"], row["org_id"]

    with as_user(owner, org) as cur:
        cur.execute(
            """INSERT INTO properties (org_id, name, locality, short_term_daily_rate_paise, exit_deduction_paise)
               VALUES (%s, 'Sunrise HSR', 'HSR', 800_00, 2_000_00) RETURNING id""",
            (org,),
        )
        prop_a = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO properties (org_id, name, locality) VALUES (%s, 'Lakeview BTM', 'BTM') RETURNING id",
            (org,),
        )
        prop_b = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO rooms (org_id, property_id, label, sharing) VALUES (%s, %s, '101', 2) RETURNING id",
            (org, prop_a),
        )
        room = cur.fetchone()["id"]
        beds = []
        for label in ("101-A", "101-B"):
            cur.execute(
                """INSERT INTO beds (org_id, property_id, room_id, label, base_rent_paise)
                   VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                (org, prop_a, room, label, BASE_RENT),
            )
            beds.append(cur.fetchone()["id"])
        cur.execute("SELECT api.add_staff_member(%s, 'Ravi', 'x', 'caretaker', %s) AS id", (rand_phone(), [prop_a]))
        ct_a = cur.fetchone()["id"]
        cur.execute("SELECT api.add_staff_member(%s, 'Suresh', 'x', 'caretaker', %s) AS id", (rand_phone(), [prop_b]))
        ct_b = cur.fetchone()["id"]
        cur.execute(
            """INSERT INTO residents (org_id, property_id, full_name, phone)
               VALUES (%s, %s, 'Anika Rao', %s) RETURNING id""",
            (org, prop_a, rand_phone()),
        )
        resident = cur.fetchone()["id"]

    return World(org, owner, ct_a, ct_b, prop_a, prop_b, beds[0], beds[1], resident)
