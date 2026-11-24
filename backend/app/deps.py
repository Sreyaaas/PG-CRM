"""Request context: who is calling and for which organization."""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from psycopg import Cursor
from psycopg.rows import DictRow

from app.db import transaction
from app.security import AccessClaims, decode_access_claims

_bearer = HTTPBearer(auto_error=False)


def current_claims(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AccessClaims:
    claims = decode_access_claims(creds.credentials) if creds else None
    if claims is None:
        raise HTTPException(401, "Not signed in", headers={"WWW-Authenticate": "Bearer"})
    return claims


def current_user_id(claims: Annotated[AccessClaims, Depends(current_claims)]) -> UUID:
    return claims.user_id


@dataclass(frozen=True)
class OrgContext:
    """Authenticated user acting inside one organization (X-Org-Id header).

    Use `with ctx.tx() as cur:` for all queries. Membership and role are
    checked by the database at the start of the transaction.
    """

    user_id: UUID
    org_id: UUID

    @contextmanager
    def tx(self) -> Iterator[Cursor[DictRow]]:
        with transaction(self.user_id, self.org_id) as cur:
            cur.execute("SELECT app.member_role() AS role")
            row = cur.fetchone()
            if not row or row["role"] is None:
                raise HTTPException(403, "You are not a member of this organization")
            yield cur


def org_context(
    user_id: Annotated[UUID, Depends(current_user_id)],
    x_org_id: Annotated[UUID, Header(description="Organization the request acts on")],
) -> OrgContext:
    return OrgContext(user_id=user_id, org_id=x_org_id)


def require_owner(cur: Cursor[DictRow], message: str = "Only the owner can do this.") -> None:
    """A clear 403 for caretakers. Only a friendlier message: RLS (`app.is_owner()` in the insert/update
    policies) is the real guard, and an RLS-filtered UPDATE would otherwise just match zero rows."""
    cur.execute("SELECT app.is_owner() AS ok")
    if not cur.fetchone()["ok"]:
        raise HTTPException(403, message)


UserId = Annotated[UUID, Depends(current_user_id)]
Claims = Annotated[AccessClaims, Depends(current_claims)]
Org = Annotated[OrgContext, Depends(org_context)]
