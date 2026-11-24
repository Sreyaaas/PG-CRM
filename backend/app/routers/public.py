"""Unauthenticated routes. The ONLY two public surfaces in the product:
  * /public/join/{qr_slug}      Reception QR onboarding (write-only intake)
  * /public/documents/{token}   Tokenized receipt / invoice / settlement view
They run with no user context, so RLS denies all table access; only the
SECURITY DEFINER functions in schema `api` are callable.
"""

from fastapi import APIRouter, HTTPException, Request

from app import ratelimit, storage
from app.db import transaction
from app.schemas import JoinInfo, PublicUploadRequest, UploadTicket

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/join/{qr_slug}", response_model=JoinInfo)
def join_info(qr_slug: str) -> JoinInfo:
    with transaction() as cur:
        cur.execute("SELECT api.public_join_info(%s) AS info", (qr_slug,))
        info = cur.fetchone()["info"]
    if info is None:
        raise HTTPException(404, "This QR code is not active")
    return JoinInfo(**info)


@router.post(
    "/join/{qr_slug}/uploads",
    response_model=UploadTicket,
    responses={404: {"description": "Unknown or inactive QR code"}, 429: {"description": "Too many uploads"}},
)
def join_upload(qr_slug: str, body: PublicUploadRequest, request: Request) -> UploadTicket:
    """Presigned PUT for the onboarding form's ID photo or live selfie, under onboarding/{property_id}/.
    No sign-in; 10 per IP per 10 minutes."""
    with transaction() as cur:  # its own transaction, so the attempt counts even when the slug is unknown
        ratelimit.hit(cur, ratelimit.UPLOADS_IP, ratelimit.client_ip(request))
    with transaction() as cur:
        cur.execute("SELECT api.public_upload_property(%s) AS id", (qr_slug,))
        property_id = cur.fetchone()["id"]
    if property_id is None:
        raise HTTPException(404, "This QR code is not active")
    key = storage.new_key(f"onboarding/{property_id}", body.content_type)
    return UploadTicket(
        object_key=key,
        upload_url=storage.presign_put(key, body.content_type, body.size_bytes),
        expires_in=storage.UPLOAD_TTL,
    )
