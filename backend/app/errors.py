"""Map database errors to HTTP responses.

Business rules live in Postgres and raise custom SQLSTATEs (see
db/migrations/*_roles_and_context.sql). Every error body has one shape:

    {"error": {"code": "<machine_code>", "message": "<human text>"}}
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg import errors as pg

# sqlstate -> (http status, machine code)
_SQLSTATE_MAP: dict[str, tuple[int, str]] = {
    "PC001": (409, "append_only"),
    "PC002": (403, "forbidden"),
    "PC003": (422, "invalid"),
    "23505": (409, "duplicate"),
    "23514": (422, "invalid"),
    "23503": (422, "invalid_reference"),
    "23502": (422, "missing_field"),
    "22P02": (422, "invalid"),
    "42501": (403, "forbidden"),  # privilege / RLS WITH CHECK violation
}

# Friendlier messages for constraint names the frontend will commonly hit.
_CONSTRAINT_MESSAGES = {
    "idx_payments_utr_unique": "This UTR has already been used for another payment.",
    "uq_stays_open_bed": "This bed already has an active or reserved stay.",
    "uq_stays_open_resident": "This resident already has an active stay.",
    "uq_invoices_rent_period": "Rent for this period has already been invoiced.",
    "users_phone_key": "An account with this phone number already exists.",
}


def error_body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def _db_error(_: Request, exc: pg.Error) -> JSONResponse:
    state = exc.sqlstate or ""
    status, code = _SQLSTATE_MAP.get(state, (500, "internal"))
    diag = exc.diag
    message = _CONSTRAINT_MESSAGES.get(diag.constraint_name or "") or diag.message_primary or "Database error"
    if status == 500:
        message = "Internal error"
    elif state == "42501":
        message = "You do not have access to do this."
    return JSONResponse(status_code=status, content=error_body(code, message))


def _http_error(_: Request, exc: HTTPException) -> JSONResponse:
    code = {401: "unauthenticated", 403: "forbidden", 404: "not_found"}.get(exc.status_code, "error")
    return JSONResponse(status_code=exc.status_code, content=error_body(code, str(exc.detail)), headers=exc.headers)


def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    body = error_body("validation", "Request validation failed")
    body["error"]["fields"] = [{"loc": list(e["loc"]), "message": e["msg"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content=body)


def install(app: FastAPI) -> None:
    app.add_exception_handler(pg.Error, _db_error)  # type: ignore[arg-type]
    app.add_exception_handler(HTTPException, _http_error)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _validation_error)  # type: ignore[arg-type]
