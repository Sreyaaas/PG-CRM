"""Request/response models. These generate contract/openapi.json, which the
frontend turns into TypeScript types. Money is always integer paise."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

Phone = Annotated[str, StringConstraints(pattern=r"^[6-9][0-9]{9}$")]
Paise = Annotated[int, Field(ge=0, description="Amount in paise (₹1 = 100)")]
Role = Literal["owner", "caretaker"]


class LoginRequest(BaseModel):
    phone: Phone
    password: Annotated[str, StringConstraints(min_length=6, max_length=128)]


class SignupRequest(BaseModel):
    phone: Phone
    full_name: Annotated[str, StringConstraints(min_length=1, max_length=120, strip_whitespace=True)]
    password: Annotated[str, StringConstraints(min_length=8, max_length=128)]
    organization_name: Annotated[str, StringConstraints(min_length=1, max_length=120, strip_whitespace=True)]


class Membership(BaseModel):
    org_id: UUID
    organization_name: str
    role: Role
    assigned_property_ids: list[UUID]


class Me(BaseModel):
    id: UUID
    phone: str
    full_name: str
    memberships: list[Membership]


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    me: Me


class Property(BaseModel):
    id: UUID
    name: str
    address: str | None
    locality: str | None
    qr_slug: str
    upi_vpa: str | None
    upi_payee_name: str | None
    short_term_daily_rate_paise: Paise | None
    exit_deduction_paise: Paise
    is_active: bool
    created_at: datetime


class JoinInfo(BaseModel):
    property_name: str
    locality: str | None
    organization_name: str
    house_rules: str | None
    exit_deduction_paise: Paise
    short_term_daily_rate_paise: Paise | None
    upi_vpa: str | None
    upi_payee_name: str | None


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
