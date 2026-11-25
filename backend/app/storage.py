"""Private object storage (KYC ID photos, live selfies, expense bill photos).

Files never pass through the API: the client uploads straight to the bucket with a short-lived presigned PUT, and
views them through a short-lived presigned GET. The bucket is private, and the database stores only object keys.
Works with any S3-compatible service through `PGCRM_S3_*` (RustFS locally; Supabase Storage / AWS S3 / R2).
"""

import contextlib
from datetime import datetime
from functools import lru_cache
from uuid import uuid4

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import get_settings
from app.logs import logger

MAX_BYTES = 5 * 1024 * 1024
UPLOAD_TTL = 5 * 60
VIEW_TTL = 5 * 60
EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_TYPES = {
    "kyc_id": IMAGE_TYPES | {"application/pdf"},
    "selfie": IMAGE_TYPES,
    "expense_proof": IMAGE_TYPES,
    "complaint_photo": IMAGE_TYPES,
}


@lru_cache
def client():
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint,
        aws_access_key_id=s.s3_access_key,
        aws_secret_access_key=s.s3_secret_key,
        region_name=s.s3_region,
        # SigV4 is what every S3-compatible service checks; path style works with custom endpoints.
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, retries={"max_attempts": 2}),
    )


def _bucket() -> str:
    return get_settings().s3_bucket


def new_key(prefix: str, content_type: str) -> str:
    return f"{prefix}/{uuid4()}.{EXTENSIONS[content_type]}"


def presign_put(key: str, content_type: str, size_bytes: int) -> str:
    """The upload must send exactly this Content-Type and Content-Length, or the storage refuses it."""
    return client().generate_presigned_url(
        "put_object",
        Params={"Bucket": _bucket(), "Key": key, "ContentType": content_type, "ContentLength": size_bytes},
        ExpiresIn=UPLOAD_TTL,
    )


def presign_get(key: str) -> str:
    return client().generate_presigned_url("get_object", Params={"Bucket": _bucket(), "Key": key}, ExpiresIn=VIEW_TTL)


def object_exists(key: str) -> tuple[bool, datetime | None]:
    """HEAD the object: (exists, last_modified). Used by BE-21 (onboarding submit) and BE-42 (expenses)."""
    try:
        head = client().head_object(Bucket=_bucket(), Key=key)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return False, None
        raise
    return True, head["LastModified"]


def ensure_bucket() -> None:
    """Dev/test only: create the private bucket if it's missing. In prod the bucket is provisioned (BE-52)."""
    s3 = client()
    try:
        s3.head_bucket(Bucket=_bucket())
        return
    except ClientError:
        pass
    s3.create_bucket(Bucket=_bucket())
    # Not every S3-compatible service supports this; new buckets are private anyway.
    with contextlib.suppress(ClientError):
        s3.put_public_access_block(
            Bucket=_bucket(),
            PublicAccessBlockConfiguration={
                "BlockPublicAcls": True,
                "IgnorePublicAcls": True,
                "BlockPublicPolicy": True,
                "RestrictPublicBuckets": True,
            },
        )
    logger.info("created storage bucket", extra={"bucket": _bucket()})
