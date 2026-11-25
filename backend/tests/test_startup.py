"""BE-52: in prod the API refuses to start when its database login would bypass Row Level Security."""

import os

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row

from app.config import get_settings
from app.main import app
from app.startup import UnsafeDatabaseRole, check_db_role

PASSWORD = "role-check-pass"


def _login_role(admin, name: str, flags: str) -> str:
    """A throwaway login role that may SET ROLE pgcrm_app, like production's pgcrm_api."""
    db = admin.execute("SELECT current_database() AS db").fetchone()["db"]
    admin.execute(
        f"""DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{name}') THEN
                CREATE ROLE {name} LOGIN PASSWORD '{PASSWORD}' {flags};
              END IF;
            END $$"""
    )
    admin.execute(f"GRANT pgcrm_app TO {name}")
    admin.execute(f'GRANT CONNECT ON DATABASE "{db}" TO {name}')
    return make_conninfo(os.environ["PGCRM_DATABASE_URL"], user=name, password=PASSWORD)


def _check_as(url: str) -> None:
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SET LOCAL ROLE pgcrm_app")  # exactly what app.db.transaction() does
        check_db_role(cur)


@pytest.mark.ac("BE-52", "AC1")
def test_prod_api_refuses_to_start_as_superuser(admin, monkeypatch):
    assert admin.execute("SELECT rolsuper FROM pg_roles WHERE rolname = session_user").fetchone()["rolsuper"]
    monkeypatch.setattr(get_settings(), "environment", "prod")
    with pytest.raises(UnsafeDatabaseRole, match="is a superuser"), TestClient(app):
        pass  # startup (lifespan) raises before the app serves anything
    user = conninfo_to_dict(os.environ["PGCRM_DATABASE_URL"]).get("user")
    assert user  # the message names the login role, so ops can see which one was wrong


@pytest.mark.ac("BE-52", "AC1")
def test_bypassrls_login_is_refused(admin):
    url = _login_role(admin, "pgcrm_bypass_check", "NOSUPERUSER BYPASSRLS NOINHERIT")
    with pytest.raises(UnsafeDatabaseRole, match="has BYPASSRLS"):
        _check_as(url)


@pytest.mark.ac("BE-52", "AC1")
def test_api_style_login_passes(admin):
    url = _login_role(admin, "pgcrm_api_check", "NOSUPERUSER NOBYPASSRLS NOINHERIT")
    _check_as(url)  # no exception
    # And it really is RLS-bound: without an org context it sees no properties at all.
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SET LOCAL ROLE pgcrm_app")
        cur.execute("SELECT count(*) AS n FROM properties")
        assert cur.fetchone()["n"] == 0


class _Cursor:
    def __init__(self, row):
        self.row = row

    def execute(self, *_):
        pass

    def fetchone(self):
        return self.row


@pytest.mark.ac("BE-52", "AC1")
def test_table_owner_login_is_refused():
    row = {"login": "pgcrm_migrator", "superuser": False, "bypassrls": False, "owns_tables": True}
    with pytest.raises(UnsafeDatabaseRole, match="owns the tables"):
        check_db_role(_Cursor(row))
    check_db_role(_Cursor(row | {"owns_tables": False}))  # a plain API login is fine


def test_dev_and_test_skip_the_check(monkeypatch):
    for env in ("dev", "test"):
        monkeypatch.setattr(get_settings(), "environment", env)
        with TestClient(app) as c:  # superuser is fine outside prod
            assert c.get("/health").json() == {"status": "ok"}
