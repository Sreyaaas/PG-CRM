from uuid import UUID

from fastapi import APIRouter, HTTPException
from psycopg import Cursor
from psycopg.rows import DictRow

from app.db import transaction
from app.deps import UserId
from app.schemas import LoginRequest, Me, Membership, SignupRequest, TokenResponse
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(tags=["auth"])


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


@router.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest) -> TokenResponse:
    with transaction() as cur:
        cur.execute("SELECT * FROM api.auth_get_credentials(%s)", (body.phone,))
        row = cur.fetchone()
    ok = verify_password(row["password_hash"] if row else None, body.password)
    if not row or not ok or not row["is_active"]:
        raise HTTPException(401, "Wrong phone number or password")

    token, ttl = create_access_token(row["user_id"])
    with transaction(user_id=row["user_id"]) as cur:
        me = _load_me(cur, row["user_id"])
    return TokenResponse(access_token=token, expires_in=ttl, me=me)


@router.post("/auth/signup", response_model=TokenResponse, status_code=201)
def signup_owner(body: SignupRequest) -> TokenResponse:
    """Owner self-signup: creates the account, organization and owner membership."""
    with transaction() as cur:
        cur.execute(
            "SELECT user_id FROM api.signup_owner(%s, %s, %s, %s)",
            (body.phone, body.full_name, hash_password(body.password), body.organization_name),
        )
        user_id = cur.fetchone()["user_id"]
    token, ttl = create_access_token(user_id)
    with transaction(user_id=user_id) as cur:
        me = _load_me(cur, user_id)
    return TokenResponse(access_token=token, expires_in=ttl, me=me)


@router.get("/me", response_model=Me)
def me(user_id: UserId) -> Me:
    with transaction(user_id=user_id) as cur:
        return _load_me(cur, user_id)
