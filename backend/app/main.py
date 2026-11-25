from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response

from app import errors, logs, monitoring, startup, storage
from app.config import get_settings
from app.db import close_pool
from app.routers import (
    activity,
    auth,
    complaints,
    discounts,
    expenses,
    files,
    invoices,
    onboarding,
    organization,
    payments,
    properties,
    public,
    reconciliation,
    rooms,
    staff,
    stays,
)
from app.schemas import ErrorResponse

API_PREFIX = "/api/v1"
_DOCS = ("/docs", "/redoc", "/openapi.json")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if get_settings().environment == "prod":
        startup.check_production_database()  # refuses to start if the DB login bypasses RLS
    if get_settings().environment in ("dev", "test"):
        try:
            storage.ensure_bucket()
        except Exception:  # storage not running: the API still starts, uploads fail until it is
            logs.logger.warning("could not reach object storage to create the bucket", exc_info=True)
    yield
    close_pool()


def create_app() -> FastAPI:
    settings = get_settings()
    logs.configure(settings.log_level)
    monitoring.init_sentry(settings)
    app = FastAPI(
        title="PG-CRM API",
        version="0.1.0",
        lifespan=lifespan,
        responses={
            401: {"model": ErrorResponse},
            403: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
            422: {"model": ErrorResponse},
            429: {"model": ErrorResponse},
        },
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next) -> Response:
        response = await call_next(request)
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        # Receipt/QR links carry secret tokens: never leak them through Referer.
        h.setdefault("Referrer-Policy", "no-referrer")
        h.setdefault("Cache-Control", "no-store")
        if not request.url.path.startswith(_DOCS):  # Swagger UI needs its scripts
            h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if settings.environment == "prod":
            h.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
        return response

    # Added after the headers middleware, so it wraps it: every response gets an X-Request-ID and a log line.
    app.add_middleware(logs.RequestLogMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,  # prod: only the real https frontend (enforced in config)
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Org-Id", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After"],
    )
    errors.install(app)

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    for r in (
        auth.router,
        properties.router,
        rooms.router,
        staff.router,
        organization.router,
        activity.router,
        discounts.router,
        onboarding.router,
        stays.router,
        invoices.router,
        payments.router,
        reconciliation.router,
        expenses.router,
        complaints.router,
        files.router,
        public.router,
    ):
        app.include_router(r, prefix=API_PREFIX)
    return app


app = create_app()
