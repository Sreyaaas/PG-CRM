"""Idempotency-Key for the money-creating POSTs (BE-32): POST /payments, POST /expenses, POST /cash/handovers.

A caretaker on flaky Wi-Fi taps "Log payment" again after a timeout; the retry must not record the cash twice.
The client sends a UUID in `Idempotency-Key` (optional; FE-51 always sends it). Inside the endpoint's transaction:

    request_hash = idempotency.hash_body(body)
    if (replay := idempotency.replay(cur, key, request_hash)) is not None:
        return replay              # same body: the stored response; different body: 422
    ... insert ...
    idempotency.save(cur, key, request_hash, 201, result)

`replay` takes a transaction-scoped advisory lock on (org, user, key), so a concurrent request with the same key
waits until the first one commits or rolls back, then sees its stored response. Only successful responses are
stored, in the same transaction as the insert: a failed request leaves no key and can simply be retried. Keys older
than 7 days are ignored.
"""

import hashlib
import json
from typing import Annotated
from uuid import UUID

from fastapi import Header
from fastapi.responses import JSONResponse
from psycopg import Cursor
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app.errors import error_body

IdempotencyKey = Annotated[
    UUID | None,
    Header(
        alias="Idempotency-Key",
        description="Optional UUID. Retrying with the same key and body returns the first response instead of "
        "recording it twice; the same key with a different body is 422. Keys are kept for 7 days.",
    ),
]

REUSED = "Idempotency-Key reused with a different request"


def hash_body(body: BaseModel) -> str:
    """sha256 of the canonical JSON body (sorted keys, no spaces), after validation."""
    canonical = json.dumps(body.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def replay(cur: Cursor[DictRow], key: UUID | None, request_hash: str) -> JSONResponse | None:
    """None: go ahead (no key, or a new one). Otherwise the response to return as is."""
    if key is None:
        return None
    cur.execute(
        """SELECT pg_advisory_xact_lock(hashtextextended(
                    concat_ws(':', app.current_org_id(), app.current_user_id(), %s::text), 0))""",
        (str(key),),
    )
    cur.execute(
        """SELECT request_hash, status_code, response FROM idempotency_keys
            WHERE org_id = app.current_org_id() AND user_id = app.current_user_id() AND key = %s
              AND created_at > now() - interval '7 days'""",
        (str(key),),
    )
    row = cur.fetchone()
    if row is None:
        return None
    if row["request_hash"] != request_hash:
        return JSONResponse(status_code=422, content=error_body("invalid", REUSED))
    return JSONResponse(status_code=row["status_code"], content=row["response"])


def save(cur: Cursor[DictRow], key: UUID | None, request_hash: str, status_code: int, response: BaseModel) -> None:
    """Store the response in the caller's transaction, so it commits (or rolls back) with the insert."""
    if key is None:
        return
    cur.execute(
        """INSERT INTO idempotency_keys (org_id, user_id, key, request_hash, status_code, response)
           VALUES (app.current_org_id(), app.current_user_id(), %s, %s, %s, %s)
           ON CONFLICT (org_id, user_id, key) DO NOTHING""",  # only an expired (> 7 days) key can be there
        (str(key), request_hash, status_code, Jsonb(response.model_dump(mode="json"))),
    )
