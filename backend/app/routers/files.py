"""Staff uploads and signed view links for private files.

A signed GET URL is only issued for a key that is stored on a row the caller can read (onboarding request,
resident, expense or complaint). RLS decides which rows those are, so a caretaker of building B never gets a
selfie from A.
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from app import storage
from app.deps import Org
from app.schemas import FileUrl, UploadRequest, UploadTicket

router = APIRouter(tags=["files"])

_REFERENCED = """
  SELECT EXISTS (SELECT 1 FROM onboarding_requests WHERE id_doc_path = %(k)s OR selfie_path = %(k)s)
      OR EXISTS (SELECT 1 FROM residents WHERE id_doc_path = %(k)s OR selfie_path = %(k)s)
      OR EXISTS (SELECT 1 FROM expenses WHERE proof_path = %(k)s)
      OR EXISTS (SELECT 1 FROM complaints WHERE photo_path = %(k)s) AS ok
"""


@router.post("/uploads", response_model=UploadTicket, responses={404: {"description": "Property not found"}})
def staff_upload(body: UploadRequest, ctx: Org) -> UploadTicket:
    """Presigned PUT under org/{org_id}/{property_id}/{kind}/. Only for a property the caller can access."""
    with ctx.tx() as cur:
        cur.execute("SELECT 1 FROM properties WHERE id = %s", (body.property_id,))  # RLS hides other buildings
        if cur.fetchone() is None:
            raise HTTPException(404, "Property not found")
    key = storage.new_key(f"org/{ctx.org_id}/{body.property_id}/{body.kind}", body.content_type)
    return UploadTicket(
        object_key=key,
        upload_url=storage.presign_put(key, body.content_type, body.size_bytes),
        expires_in=storage.UPLOAD_TTL,
    )


@router.get("/files/url", response_model=FileUrl, responses={404: {"description": "Not found"}})
def file_url(key: Annotated[str, Query(min_length=1, max_length=512)], ctx: Org) -> FileUrl:
    """Signed GET (5 minutes), only if `key` is stored on a row the caller can see. Otherwise 404."""
    with ctx.tx() as cur:
        cur.execute(_REFERENCED, {"k": key})
        if not cur.fetchone()["ok"]:
            raise HTTPException(404, "File not found")
    return FileUrl(url=storage.presign_get(key), expires_in=storage.VIEW_TTL)
