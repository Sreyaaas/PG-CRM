"""Unauthenticated routes. The ONLY two public surfaces in the product:
  * /public/join/{qr_slug}      Reception QR onboarding (write-only intake)
  * /public/documents/{token}   Tokenized receipt / invoice / settlement view
They run with no user context, so RLS denies all table access; only the
SECURITY DEFINER functions in schema `api` are callable.
"""

import ipaddress
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app import ratelimit, storage
from app.db import transaction
from app.errors import error_body
from app.schemas import JoinInfo, OnboardingSubmit, OnboardingSubmitted, PublicUploadRequest, UploadTicket

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


def _inet(ip: str) -> str | None:
    try:
        return str(ipaddress.ip_address(ip))
    except ValueError:
        return None


@router.post(
    "/join/{qr_slug}",
    response_model=OnboardingSubmitted,
    status_code=201,
    responses={422: {"description": "Inactive QR code, stale exit deduction, bad photos, already pending"}},
)
def join_submit(qr_slug: str, body: OnboardingSubmit, request: Request) -> OnboardingSubmitted | JSONResponse:
    """Submit the onboarding form. No sign-in; 5 submissions per IP per hour. Returns only the request id.

    The rules (active QR, exit deduction unchanged, one pending request per phone, passport + visa for foreign
    nationals, photos under onboarding/{property_id}/) are enforced by `api.public_submit_onboarding`; this route
    only adds the storage check that the photos were really uploaded."""
    ip = ratelimit.client_ip(request)
    with transaction() as cur:  # its own transaction, so a rejected attempt still counts
        ratelimit.hit(cur, ratelimit.PUBLIC_JOIN_SUBMIT_IP, ip)
    with transaction() as cur:
        cur.execute("SELECT api.public_upload_property(%s) AS id", (qr_slug,))
        property_id = cur.fetchone()["id"]
    if property_id is None:
        return JSONResponse(status_code=422, content=error_body("invalid", "This QR code is not active"))

    prefix = f"onboarding/{property_id}/"
    for key in (body.id_doc_path, body.selfie_path):
        if not key.startswith(prefix) or not storage.object_exists(key)[0]:
            return JSONResponse(
                status_code=422,
                content=error_body("invalid", "Please upload the ID photo and selfie again."),
            )

    with transaction() as cur:
        cur.execute(
            "SELECT api.public_submit_onboarding(%s, %s::jsonb, %s::inet, %s) AS id",
            (qr_slug, json.dumps(body.model_dump(mode="json")), _inet(ip), request.headers.get("user-agent")),
        )
        return OnboardingSubmitted(request_id=cur.fetchone()["id"])
