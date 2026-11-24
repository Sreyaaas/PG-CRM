"""Staff sign-in and sessions.

Access token: short JWT (15 min). Refresh token: random, single use, 30 days, stored only as a SHA-256 hash in
`sessions`. Every refresh rotates it; presenting a used one again revokes the whole session (theft signal).
Failed logins are rate limited per phone and per IP (`app.ratelimit`).
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from psycopg import Cursor
from psycopg.rows import DictRow

from app import ratelimit
from app.config import get_settings
from app.db import transaction
from app.deps import Claims, UserId
from app.errors import error_body
from app.logs import logger, mask_phone
from app.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    Me,
    Membership,
    RefreshRequest,
    SignupRequest,
    TokenResponse,
)
from app.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    verify_password,
)

router = APIRouter(tags=["auth"])

_SESSION_GONE = "Your session has ended. Please sign in again."
_RATE_LIMITED = {429: {"description": "Too many failed attempts"}}


def _load_me(cur: Cursor[DictRow], user_id: UUID) -> Me:
    cur.execute("SELECT id, phone, full_name FROM users WHERE id = %s", (user_id,))
    user = cur.fetchone()
    if user is None:
        raise HTTPException(401, "Account not found")
    cur.execute(
        """
        SELECT m.org_id, o.name AS organization_name, m.role::text AS role, m.assigned_property_ids
          FROM organization_members m
          JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = %s AND m.is_active
         ORDER BY o.name
        """,
        (user_id,),
    )
    return Me(**user, memberships=[Membership(**r) for r in cur.fetchall()])


def _start_session(user_id: UUID) -> TokenResponse:
    """New session family for a fresh sign-in."""
    s = get_settings()
    refresh, refresh_hash = new_refresh_token()
    refresh_ttl = s.refresh_ttl_days * 24 * 3600
    with transaction(user_id=user_id) as cur:
        cur.execute(
            """INSERT INTO sessions (user_id, token_hash, expires_at)
               VALUES (%s, %s, now() + make_interval(secs => %s)) RETURNING family_id""",
            (user_id, refresh_hash, refresh_ttl),
        )
        family_id = cur.fetchone()["family_id"]
        me = _load_me(cur, user_id)
    access, ttl = create_access_token(user_id, family_id)
    return TokenResponse(
        access_token=access, expires_in=ttl, refresh_token=refresh, refresh_expires_in=refresh_ttl, me=me
    )


def _record_failure(cur: Cursor[DictRow], phone: str, ip: str) -> None:
    ratelimit.record(cur, ratelimit.LOGIN_PHONE, phone)
    ratelimit.record(cur, ratelimit.LOGIN_IP, ip)


@router.post("/auth/login", response_model=TokenResponse, responses=_RATE_LIMITED)
def login(body: LoginRequest, request: Request) -> TokenResponse:
    """5 failed attempts per phone (or 20 per IP) in 15 minutes lock sign-in, even with the right password."""
    ip = ratelimit.client_ip(request)
    with transaction() as cur:
        if ratelimit.is_limited(cur, ratelimit.LOGIN_PHONE, body.phone) or ratelimit.is_limited(
            cur, ratelimit.LOGIN_IP, ip
        ):
            logger.warning("login rate limited", extra={"phone": mask_phone(body.phone)})
            raise ratelimit.RateLimited(ratelimit.LOGIN_PHONE.window_seconds)
        cur.execute("SELECT * FROM api.auth_get_credentials(%s)", (body.phone,))
        row = cur.fetchone()

    ok = verify_password(row["password_hash"] if row else None, body.password)
    if not row or not ok or not row["is_active"]:
        with transaction() as cur:
            _record_failure(cur, body.phone, ip)
        logger.info("login failed", extra={"phone": mask_phone(body.phone)})
        raise HTTPException(401, "Wrong phone number or password")
    return _start_session(row["user_id"])


@router.post("/auth/signup", response_model=TokenResponse, status_code=201)
def signup_owner(body: SignupRequest) -> TokenResponse:
    """Owner self-signup: creates the account, organization and owner membership."""
    with transaction() as cur:
        cur.execute(
            "SELECT user_id FROM api.signup_owner(%s, %s, %s, %s)",
            (body.phone, body.full_name, hash_password(body.password), body.organization_name),
        )
        user_id = cur.fetchone()["user_id"]
    return _start_session(user_id)


@router.post("/auth/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest) -> TokenResponse:
    """Exchange the refresh token for a new access token **and a new refresh token** (the old one stops working).
    Using an old refresh token again signs out that whole session. Deactivated accounts can't refresh."""
    new_refresh, new_hash = new_refresh_token()
    with transaction() as cur:
        cur.execute(
            "SELECT * FROM api.rotate_session(%s, %s, make_interval(days => %s))",
            (hash_refresh_token(body.refresh_token), new_hash, get_settings().refresh_ttl_days),
        )
        row = cur.fetchone()
    # Commit first: a reuse revokes the session family even though this request fails.
    if row is None:
        raise HTTPException(401, _SESSION_GONE)
    with transaction(user_id=row["user_id"]) as cur:
        me = _load_me(cur, row["user_id"])
    access, ttl = create_access_token(row["user_id"], row["family_id"])
    return TokenResponse(
        access_token=access,
        expires_in=ttl,
        refresh_token=new_refresh,
        refresh_expires_in=get_settings().refresh_ttl_days * 24 * 3600,
        me=me,
    )


@router.post("/auth/logout", status_code=204)
def logout(body: RefreshRequest) -> None:
    """Ends this session (works even if the access token has expired). Unknown tokens are ignored."""
    with transaction() as cur:
        cur.execute("SELECT api.revoke_session(%s)", (hash_refresh_token(body.refresh_token),))


@router.post("/auth/logout-all", status_code=204)
def logout_all(user_id: UserId) -> None:
    """Ends every session of the signed-in user, on every device."""
    with transaction(user_id=user_id) as cur:
        cur.execute("UPDATE sessions SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL", (user_id,))


@router.post(
    "/auth/change-password",
    status_code=204,
    response_model=None,
    responses=_RATE_LIMITED | {422: {"description": "Current password is incorrect"}},
)
def change_password(body: ChangePasswordRequest, claims: Claims, request: Request) -> JSONResponse | None:
    """Needs the current password. Signs out every other session; this one stays signed in.
    Wrong current passwords count towards the same lock as failed logins."""
    ip = ratelimit.client_ip(request)
    with transaction(user_id=claims.user_id) as cur:
        cur.execute("SELECT phone FROM users WHERE id = %s", (claims.user_id,))
        phone = cur.fetchone()["phone"]
        if ratelimit.is_limited(cur, ratelimit.LOGIN_PHONE, phone) or ratelimit.is_limited(cur, ratelimit.LOGIN_IP, ip):
            raise ratelimit.RateLimited(ratelimit.LOGIN_PHONE.window_seconds)
        cur.execute("SELECT * FROM api.auth_get_credentials(%s)", (phone,))
        creds = cur.fetchone()

    if not verify_password(creds["password_hash"], body.current_password):
        with transaction() as cur:
            _record_failure(cur, phone, ip)
        # 422, not 401: a 401 would make the app sign the user out.
        return JSONResponse(status_code=422, content=error_body("invalid", "Current password is incorrect."))

    with transaction(user_id=claims.user_id) as cur:
        cur.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s", (hash_password(body.new_password), claims.user_id)
        )
        cur.execute(
            """UPDATE sessions SET revoked_at = now()
                WHERE user_id = %s AND revoked_at IS NULL AND family_id IS DISTINCT FROM %s""",
            (claims.user_id, claims.session_id),
        )
    logger.info("password changed")
    return None


@router.get("/me", response_model=Me)
def me(user_id: UserId) -> Me:
    with transaction(user_id=user_id) as cur:
        return _load_me(cur, user_id)
