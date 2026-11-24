"""Rate limits stored in Postgres (`rate_limit_events`), so every API process shares them.

Keys (phone, IP) are hashed before they reach the database: no phone number or IP is stored.
"""

import hashlib
from dataclasses import dataclass

from fastapi import Request
from psycopg import Cursor
from psycopg.rows import DictRow

from app.config import get_settings


@dataclass(frozen=True)
class Limit:
    name: str
    limit: int
    window_seconds: int


# Failed logins (only failures count; once reached, even the right password is refused).
LOGIN_PHONE = Limit("login:phone", 5, 15 * 60)
LOGIN_IP = Limit("login:ip", 20, 15 * 60)
# Every request counts. Applied by the endpoints that own them: BE-21, BE-34, BE-20.
PUBLIC_JOIN_SUBMIT_IP = Limit("join-submit:ip", 5, 60 * 60)
PUBLIC_DOCUMENTS_IP = Limit("documents:ip", 60, 60)
UPLOADS_IP = Limit("uploads:ip", 10, 10 * 60)


class RateLimited(Exception):
    def __init__(self, retry_after: int):
        super().__init__("rate limited")
        self.retry_after = retry_after


def client_ip(request: Request) -> str:
    """The direct peer, unless `PGCRM_TRUST_FORWARDED_FOR` says we're behind our own proxy: then the last address in
    X-Forwarded-For (the one our proxy appended; earlier entries come from the client and can be forged).
    Alternatively run uvicorn with --proxy-headers and --forwarded-allow-ips=<proxy>."""
    if get_settings().trust_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for", "")
        last = forwarded.rsplit(",", 1)[-1].strip()
        if last:
            return last
    return request.client.host if request.client else "unknown"


def _bucket(limit: Limit, key: str) -> str:
    return hashlib.sha256(f"{limit.name}:{key}".encode()).hexdigest()


def is_limited(cur: Cursor[DictRow], limit: Limit, key: str) -> bool:
    cur.execute(
        "SELECT api.rate_limit_count(%s, make_interval(secs => %s)) AS n",
        (_bucket(limit, key), limit.window_seconds),
    )
    return cur.fetchone()["n"] >= limit.limit


def record(cur: Cursor[DictRow], limit: Limit, key: str) -> None:
    cur.execute("SELECT api.rate_limit_record(%s)", (_bucket(limit, key),))


def hit(cur: Cursor[DictRow], limit: Limit, key: str) -> None:
    """Count this request; raise RateLimited when the limit is already used up."""
    if is_limited(cur, limit, key):
        raise RateLimited(limit.window_seconds)
    record(cur, limit, key)
