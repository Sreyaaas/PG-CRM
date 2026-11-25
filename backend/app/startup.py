"""Startup safety checks (BE-52).

The biggest production mistake would be connecting the API as a superuser, a BYPASSRLS role or the tables' owner:
each of those skips Row Level Security, so every anti-theft rule that lives in policies would silently stop
applying. In prod the API refuses to start if its login role is any of them. See db/prod/roles.sql.
"""

from psycopg import Cursor
from psycopg.rows import DictRow

from app.db import transaction

_ROLE_CHECK = """
  SELECT session_user AS login,
         r.rolsuper AS superuser,
         r.rolbypassrls AS bypassrls,
         EXISTS (SELECT 1 FROM pg_tables t
                  WHERE t.schemaname = 'public' AND t.tablename = 'properties' AND t.tableowner = session_user)
           AS owns_tables
    FROM pg_roles r
   WHERE r.rolname = session_user
"""


class UnsafeDatabaseRole(RuntimeError):
    pass


def check_db_role(cur: Cursor[DictRow]) -> None:
    """Raise UnsafeDatabaseRole if the *login* role (session_user, not the pgcrm_app role the transaction switched
    to) would bypass Row Level Security."""
    cur.execute(_ROLE_CHECK)
    row = cur.fetchone()
    problems = [
        reason
        for flag, reason in (
            ("superuser", "is a superuser"),
            ("bypassrls", "has BYPASSRLS"),
            ("owns_tables", "owns the tables (run migrations as pgcrm_migrator, the API as pgcrm_api)"),
        )
        if row[flag]
    ]
    if problems:
        raise UnsafeDatabaseRole(
            f"Refusing to start: database login role {row['login']!r} {' and '.join(problems)}, which bypasses Row "
            "Level Security. Connect as a role like pgcrm_api (see db/prod/roles.sql)."
        )


def check_production_database() -> None:
    with transaction() as cur:
        check_db_role(cur)
