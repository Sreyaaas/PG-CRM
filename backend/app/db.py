"""Database access.

Every query runs inside `transaction()`, which switches to the RLS-bound
`pgcrm_app` role and sets the request's user/org. Row Level Security and the
guard triggers in db/migrations do the authorization; Python only supplies
*who* is asking. Never query outside this helper.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID

from psycopg import Cursor
from psycopg.rows import DictRow, dict_row
from psycopg_pool import ConnectionPool

from app.config import get_settings

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        s = get_settings()
        _pool = ConnectionPool(
            s.database_url,
            min_size=s.db_pool_min,
            max_size=s.db_pool_max,
            # prepare_threshold=None: no server-side prepared statements, so the
            # API also works behind transaction-mode poolers (PgBouncer etc.).
            kwargs={"autocommit": True, "row_factory": dict_row, "prepare_threshold": None},
            open=True,
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def transaction(user_id: UUID | None = None, org_id: UUID | None = None) -> Iterator[Cursor[DictRow]]:
    """One request = one transaction, scoped to (user, org).

    Commits when the block exits normally, rolls back on any exception.
    Public routes call this with no user/org: every RLS policy then denies,
    and only the SECURITY DEFINER functions in schema `api` are usable.
    """
    with get_pool().connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SET LOCAL ROLE pgcrm_app")
        cur.execute(
            "SELECT set_config('app.user_id', %s, true), set_config('app.org_id', %s, true)",
            (str(user_id) if user_id else "", str(org_id) if org_id else ""),
        )
        yield cur
