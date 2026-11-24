"""Request/response models. These generate contract/openapi.json, which the
frontend turns into TypeScript types. Money is always integer paise."""

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

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


PropertyName = Annotated[str, StringConstraints(min_length=1, strip_whitespace=True)]
DailyRate = Annotated[int, Field(gt=0, description="Amount in paise (₹1 = 100)")]
DayOfMonth = Annotated[int, Field(ge=1, le=28, description="Day of the month (1-28, exists in every month)")]


def _no_default_in_schema(schema: dict) -> None:
    schema.pop("default", None)


def _optional(**kwargs):
    """A field that may be left out but, when sent, may not be null (the column is NOT NULL)."""
    return Field(default=None, json_schema_extra=_no_default_in_schema, **kwargs)


class _PropertyFields(BaseModel):
    """Owner-writable property fields. Each maps 1:1 to a column of `properties`."""

    model_config = {"extra": "forbid"}

    address: str | None = None
    locality: str | None = None
    short_term_daily_rate_paise: DailyRate | None = None
    exit_deduction_paise: Paise = _optional(description="Default 0")
    house_rules: str | None = None
    fallback_upi_id: str | None = None
    bank_details: str | None = None
    is_active: bool = _optional(description="Default true. Removing a property = setting this to false")
    rent_due_day: DayOfMonth = _optional(description="Rent is due by this day of each month. Default 5")
    security_deposit_paise: Paise = _optional(description="Refundable deposit paid at joining. Default 0")
    maintenance_charge_paise: Paise = _optional(description="One-time, non-refundable, paid at joining. Default 0")
    notice_deadline_day: DayOfMonth = _optional(
        description="Notice on/before this day makes the current month the last one. Default 5"
    )

    @model_validator(mode="after")
    def _not_null(self):
        for name in ("name", *_NOT_NULL):
            if name in self.model_fields_set and getattr(self, name, None) is None:
                raise ValueError(f"{name} may not be null")
        return self


_NOT_NULL = (
    "exit_deduction_paise",
    "is_active",
    "rent_due_day",
    "security_deposit_paise",
    "maintenance_charge_paise",
    "notice_deadline_day",
)


class PropertyCreate(_PropertyFields):
    name: PropertyName


class PropertyUpdate(_PropertyFields):
    """Partial update: only the fields sent are changed."""

    name: PropertyName = _optional()


class Property(BaseModel):
    id: UUID
    name: str
    address: str | None
    locality: str | None
    qr_slug: str
    upi_vpa: str | None
    upi_payee_name: str | None
    upi_mcc: str | None
    fallback_upi_id: str | None
    bank_details: str | None
    short_term_daily_rate_paise: Paise | None
    exit_deduction_paise: Paise
    house_rules: str | None
    rent_due_day: int
    security_deposit_paise: Paise
    maintenance_charge_paise: Paise
    notice_deadline_day: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UpiFromQrRequest(BaseModel):
    qr_text: Annotated[str, StringConstraints(min_length=1, max_length=4096)] = Field(
        description="The text of the owner's Soundbox QR, e.g. upi://pay?pa=...&pn=...&mc=..."
    )


class UpiPayeeDetails(BaseModel):
    upi_vpa: str
    upi_payee_name: str | None
    upi_mcc: str | None
    warning: str | None = Field(
        default=None,
        description='"Not a merchant QR" when the QR has no merchant code (personal QRs have lower limits)',
    )


Label = Annotated[str, StringConstraints(min_length=1, strip_whitespace=True)]
Rent = Annotated[int, Field(gt=0, description="Amount in paise (₹1 = 100)")]
Floor = Annotated[int, Field(ge=-32768, le=32767)]
AreaSqft = Annotated[int, Field(gt=0, le=2_147_483_647)]
BedStatus = Literal["vacant", "reserved", "occupied", "on_notice"]
AREA_WARNING = "Below 70 sq ft per resident (GBA rule)"


class RoomCreate(BaseModel):
    """Creates the room and `sharing` beds labelled `{label}-A`, `{label}-B`, ... at `base_rent_paise` each."""

    model_config = {"extra": "forbid"}

    label: Label
    floor: Floor | None = None
    sharing: Annotated[int, Field(ge=1, le=8)]
    is_ac: bool
    area_sqft: AreaSqft | None = None
    base_rent_paise: Rent = Field(description="Floor price of each bed, in paise")


class RoomUpdate(BaseModel):
    """Partial update: only the fields sent are changed."""

    model_config = {"extra": "forbid"}

    label: Label = _optional()
    floor: Floor | None = None
    is_ac: bool = _optional()
    area_sqft: AreaSqft | None = None

    @model_validator(mode="after")
    def _not_null(self):
        for name in ("label", "is_ac"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} may not be null")
        return self


class BedCreate(BaseModel):
    model_config = {"extra": "forbid"}

    label: Label
    base_rent_paise: Rent = Field(description="Floor price, in paise")


class BedUpdate(BaseModel):
    """Partial update. `status` is not accepted: it is derived from stays."""

    model_config = {"extra": "forbid"}

    label: Label = _optional()
    base_rent_paise: Rent = _optional(description="Floor price, in paise. Doesn't change existing stays' rent")
    is_active: bool = _optional(description="false = take the bed out of use (only when it has no open stay)")

    @model_validator(mode="after")
    def _not_null(self):
        for name in ("label", "base_rent_paise", "is_active"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} may not be null")
        return self


class Bed(BaseModel):
    id: UUID
    room_id: UUID
    property_id: UUID
    label: str
    base_rent_paise: Paise
    status: BedStatus
    is_active: bool
    created_at: datetime
    updated_at: datetime


class Room(BaseModel):
    id: UUID
    property_id: UUID
    label: str
    floor: int | None
    sharing: int
    is_ac: bool
    area_sqft: int | None
    created_at: datetime
    updated_at: datetime
    beds: list[Bed]
    warning: str | None = Field(default=None, description=f'"{AREA_WARNING}" when area_sqft / sharing < 70')


class BoardResident(BaseModel):
    id: UUID
    full_name: str


class BoardStay(BaseModel):
    id: UUID
    stay_type: Literal["monthly", "short_term"]
    status: Literal["reserved", "active", "on_notice"]
    rent_paise: Paise
    check_in_date: date
    expected_vacate_date: date | None
    resident: BoardResident


class BoardBed(BaseModel):
    id: UUID
    label: str
    status: BedStatus
    base_rent_paise: Paise
    is_active: bool
    stay: BoardStay | None = Field(description="The bed's open stay (not vacated), if any")


class BoardRoom(BaseModel):
    id: UUID
    label: str
    floor: int | None
    sharing: int
    is_ac: bool
    beds: list[BoardBed]


class BedBoard(BaseModel):
    rooms: list[BoardRoom]


class StaffCreate(BaseModel):
    model_config = {"extra": "forbid"}

    phone: Phone
    full_name: Annotated[str, StringConstraints(min_length=1, max_length=120, strip_whitespace=True)]
    password: Annotated[str, StringConstraints(min_length=8, max_length=128)] = Field(
        description="Only used for a new account. An existing account keeps its password."
    )
    role: Role
    property_ids: list[UUID] = Field(default_factory=list, description="Buildings a caretaker can see")


class StaffUpdate(BaseModel):
    """Partial update of another member's membership. Owners can't change their own."""

    model_config = {"extra": "forbid"}

    assigned_property_ids: list[UUID] = _optional()
    is_active: bool = _optional(description="false removes all access to this organization immediately")
    role: Role = _optional()

    @model_validator(mode="after")
    def _not_null(self):
        for name in ("assigned_property_ids", "is_active", "role"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} may not be null")
        return self


class StaffMember(BaseModel):
    user_id: UUID
    full_name: str
    phone: str
    role: Role
    assigned_property_ids: list[UUID]
    is_active: bool


class StaffMemberCreated(StaffMember):
    existing_account: bool = Field(
        description="true when the phone already had an account: only a membership was added and the "
        "person keeps their own name and password"
    )


class JoinInfo(BaseModel):
    property_name: str
    locality: str | None
    organization_name: str
    house_rules: str | None
    exit_deduction_paise: Paise
    short_term_daily_rate_paise: Paise | None
    upi_vpa: str | None
    upi_payee_name: str | None
    rent_due_day: int
    security_deposit_paise: Paise
    maintenance_charge_paise: Paise
    notice_deadline_day: int


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
