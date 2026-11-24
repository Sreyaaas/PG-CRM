import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.config import get_settings

_hasher = PasswordHasher()
# Used to spend the same time on unknown phones as on wrong passwords.
_DUMMY_HASH = _hasher.hash("timing-equaliser")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def create_access_token(user_id: UUID, session_id: UUID | None = None) -> tuple[str, int]:
    """Short-lived (PGCRM_JWT_TTL_MINUTES). `sid` names the session (refresh-token family) it came from."""
    s = get_settings()
    ttl = s.jwt_ttl_minutes * 60
    now = datetime.now(UTC)
    claims = {"sub": str(user_id), "iat": now, "exp": now + timedelta(seconds=ttl), "typ": "access"}
    if session_id is not None:
        claims["sid"] = str(session_id)
    return jwt.encode(claims, s.jwt_secret, algorithm="HS256"), ttl


@dataclass(frozen=True)
class AccessClaims:
    user_id: UUID
    session_id: UUID | None


def decode_access_claims(token: str) -> AccessClaims | None:
    """None if the token is invalid/expired.

    The token carries identity only. Roles and property access are always
    resolved from organization_members in the database.
    """
    try:
        claims = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
        if claims.get("typ") != "access":
            return None
        sid = claims.get("sid")
        return AccessClaims(UUID(claims["sub"]), UUID(sid) if sid else None)
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def decode_access_token(token: str) -> UUID | None:
    claims = decode_access_claims(token)
    return claims.user_id if claims else None


def new_refresh_token() -> tuple[str, str]:
    """(token for the client, SHA-256 hex stored in `sessions`). The token itself is never stored."""
    token = secrets.token_urlsafe(32)
    return token, hash_refresh_token(token)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
