"""Structured JSON logs with a request id, and redaction of secrets and personal data.

Never logged: passwords, tokens (JWT, refresh, receipt/QR links), full phone numbers (masked `98******10`),
KYC numbers (Aadhaar, PAN, passport). Request logs use the route *template*
(`/api/v1/public/documents/{token}`), never the actual path, and never bodies or query strings.
The same `redact()` scrubs Sentry events.
"""

import json
import logging
import re
import sys
import time
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
logger = logging.getLogger("pgcrm")

_SECRET_FIELDS = r"password|current_password|new_password|refresh_token|access_token|token|secret|authorization"
_RULES: list[tuple[re.Pattern[str], str]] = [
    # key=value / "key": "value" pairs for secret fields
    (re.compile(rf'(?i)("?(?:{_SECRET_FIELDS})"?\s*[:=]\s*)("[^"]*"|\'[^\']*\'|[^\s,}}&]+)'), r"\1[REDACTED]"),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+"), "Bearer [REDACTED]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"), "[REDACTED_JWT]"),
    # long random strings: refresh tokens, receipt tokens, QR slugs in paths, hashes
    (re.compile(r"\b[A-Za-z0-9_-]{32,}\b"), "[REDACTED]"),
    # Aadhaar (12 digits, optionally spaced) and other 12-digit numbers
    (re.compile(r"(?<!\d)\d{4}[ -]?\d{4}[ -]?(\d{4})(?!\d)"), r"********\1"),
    # Indian mobile numbers, optionally with +91 / 91 / 0
    (re.compile(r"(?<!\d)(?:\+?91[ -]?|0)?([6-9]\d)\d{3}[ -]?\d{3}(\d{2})(?!\d)"), r"\1******\2"),
    # PAN and passport numbers
    (re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"), "[REDACTED_PAN]"),
    (re.compile(r"\b[A-Z]\d{7}\b"), "[REDACTED_PASSPORT]"),
]
_REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")


def mask_phone(phone: str) -> str:
    return f"{phone[:2]}******{phone[-2:]}" if len(phone) >= 4 else "****"


def redact(text: str) -> str:
    for pattern, replacement in _RULES:
        text = pattern.sub(replacement, text)
    return text


def redact_obj(obj):
    """Recursively redact strings in dicts/lists (for Sentry events)."""
    if isinstance(obj, str):
        return redact(obj)
    if isinstance(obj, dict):
        return {
            k: "[REDACTED]" if re.fullmatch(_SECRET_FIELDS, str(k), re.I) else redact_obj(v) for k, v in obj.items()
        }
    if isinstance(obj, list | tuple):
        return [redact_obj(v) for v in obj]
    return obj


class JsonFormatter(logging.Formatter):
    _STD = set(vars(logging.makeLogRecord({}))) | {"message", "asctime"}

    def format(self, record: logging.LogRecord) -> str:
        out = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S") + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": redact(record.getMessage()),
        }
        rid = request_id_var.get()
        if rid:
            out["request_id"] = rid
        for key, value in vars(record).items():
            if key not in self._STD and not key.startswith("_"):
                out[key] = redact_obj(value) if isinstance(value, str | dict | list) else value
        if record.exc_info:
            out["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(out, default=str)


JsonFormatter.converter = time.gmtime


def configure(level: str = "INFO") -> None:
    """JSON logs to stdout for our logger. Idempotent."""
    if any(getattr(h, "_pgcrm", False) for h in logger.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler._pgcrm = True  # type: ignore[attr-defined]
    logger.addHandler(handler)
    logger.setLevel(level)
    logger.propagate = False


def route_template(request: Request) -> str:
    """The full path with every path parameter put back as `{name}`, e.g. /api/v1/public/documents/{token}:
    never the values (tokens, slugs, ids). Unmatched paths aren't logged at all."""
    if request.scope.get("route") is None:
        return "<unmatched>"
    by_value = {str(v): k for k, v in request.scope.get("path_params", {}).items()}
    return "/".join(f"{{{by_value[seg]}}}" if seg in by_value else seg for seg in request.url.path.split("/"))


class RequestLogMiddleware(BaseHTTPMiddleware):
    """Gives every request an id (X-Request-ID, echoed back) and logs one line per request."""

    async def dispatch(self, request: Request, call_next) -> Response:
        incoming = request.headers.get("x-request-id", "")
        rid = incoming if _REQUEST_ID.match(incoming) else uuid.uuid4().hex
        token = request_id_var.set(rid)
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = rid
            return response
        finally:
            logger.info(
                "request",
                extra={
                    "method": request.method,
                    "route": route_template(request),
                    "status": status,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                },
            )
            request_id_var.reset(token)
