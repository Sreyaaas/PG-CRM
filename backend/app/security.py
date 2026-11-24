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


def create_access_token(user_id: UUID) -> tuple[str, int]:
    s = get_settings()
    ttl = s.jwt_ttl_minutes * 60
    now = datetime.now(UTC)
    token = jwt.encode(
        {"sub": str(user_id), "iat": now, "exp": now + timedelta(seconds=ttl), "typ": "access"},
        s.jwt_secret,
        algorithm="HS256",
    )
    return token, ttl


def decode_access_token(token: str) -> UUID | None:
    """Return the user id, or None if the token is invalid/expired.

    The token carries identity only. Roles and property access are always
    resolved from organization_members in the database.
    """
    try:
        claims = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
        if claims.get("typ") != "access":
            return None
        return UUID(claims["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
