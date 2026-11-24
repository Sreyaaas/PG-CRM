"""Sentry error + performance monitoring, with personal data scrubbed before anything leaves the server."""

from typing import Any

import sentry_sdk

from app.config import Settings
from app.logs import redact_obj

_DROP_HEADERS = {"authorization", "cookie", "x-org-id"}


def scrub_event(event: dict[str, Any], _hint: dict[str, Any] | None = None) -> dict[str, Any]:
    """Remove request bodies, cookies and auth headers; redact secrets/phones/KYC numbers everywhere else."""
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)
        request.pop("cookies", None)
        request.pop("query_string", None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {k: v for k, v in headers.items() if k.lower() not in _DROP_HEADERS}
    event.pop("user", None)
    return redact_obj(event)


def init_sentry(settings: Settings) -> bool:
    if not settings.sentry_dsn:
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
        before_send=scrub_event,
        before_send_transaction=scrub_event,
    )
    return True
