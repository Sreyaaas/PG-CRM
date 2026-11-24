"""Unauthenticated routes. The ONLY two public surfaces in the product:
  * /public/join/{qr_slug}      Reception QR onboarding (write-only intake)
  * /public/documents/{token}   Tokenized receipt / invoice / settlement view
They run with no user context, so RLS denies all table access; only the
SECURITY DEFINER functions in schema `api` are callable.
"""

from fastapi import APIRouter, HTTPException

from app.db import transaction
from app.schemas import JoinInfo

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/join/{qr_slug}", response_model=JoinInfo)
def join_info(qr_slug: str) -> JoinInfo:
    with transaction() as cur:
        cur.execute("SELECT api.public_join_info(%s) AS info", (qr_slug,))
        info = cur.fetchone()["info"]
    if info is None:
        raise HTTPException(404, "This QR code is not active")
    return JoinInfo(**info)
