"""Request/response models. These generate contract/openapi.json, which the
frontend turns into TypeScript types. Money is always integer paise."""

from datetime import date, datetime
from typing import Annotated, Any, Literal
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


Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]


class TokenResponse(BaseModel):
    access_token: str = Field(description="Short-lived (15 min). Send as `Authorization: Bearer <token>`")
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = Field(description="Seconds until access_token expires")
    refresh_token: str = Field(
        description="Long-lived (30 days), single use: POST /auth/refresh returns a new one. Store it securely"
    )
    refresh_expires_in: int
    me: Me


class RefreshRequest(BaseModel):
    refresh_token: Annotated[str, StringConstraints(min_length=1, max_length=256)]


class ChangePasswordRequest(BaseModel):
    current_password: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    new_password: Password


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


DiscountStatus = Literal["pending", "approved", "rejected"]


class DiscountRequestCreate(BaseModel):
    model_config = {"extra": "forbid"}

    bed_id: UUID
    resident_id: UUID | None = Field(
        default=None, description="Optional: the request often happens before the resident exists (check-in)"
    )
    requested_rent_paise: Rent = Field(description="Exact monthly rent the stay may then use, in paise")
    reason: Annotated[str, StringConstraints(min_length=3, strip_whitespace=True)]


class DiscountDecision(BaseModel):
    model_config = {"extra": "forbid"}

    decision: Literal["approved", "rejected"]
    note: str | None = None


class DiscountRequest(BaseModel):
    id: UUID
    status: DiscountStatus
    property_id: UUID
    property_name: str
    bed_id: UUID
    bed_label: str
    resident_id: UUID | None
    resident_name: str | None
    base_rent_paise: Paise = Field(description="The bed's floor price now")
    requested_rent_paise: Paise
    difference_paise: int = Field(description="base_rent_paise - requested_rent_paise (the discount asked for)")
    reason: str
    requested_by: UUID
    requested_by_name: str
    created_at: datetime
    decided_by: UUID | None
    decided_at: datetime | None
    decision_note: str | None


ContentType = Literal["image/jpeg", "image/png", "image/webp", "application/pdf"]
SizeBytes = Annotated[int, Field(ge=1, le=5 * 1024 * 1024, description="Exact file size in bytes, max 5 MB")]


class _UploadFields(BaseModel):
    model_config = {"extra": "forbid"}

    content_type: ContentType = Field(description="Must match the upload's Content-Type. PDF only for kyc_id")
    size_bytes: SizeBytes

    @model_validator(mode="after")
    def _type_allowed_for_kind(self):
        if self.content_type == "application/pdf" and self.kind != "kyc_id":
            raise ValueError("PDF is only allowed for kyc_id")
        return self


class PublicUploadRequest(_UploadFields):
    kind: Literal["kyc_id", "selfie"]


class UploadRequest(_UploadFields):
    kind: Literal["expense_proof", "kyc_id", "selfie", "complaint_photo"]
    property_id: UUID


class UploadTicket(BaseModel):
    object_key: str = Field(description="Store this on the record (e.g. id_doc_path) after the upload succeeds")
    upload_url: str = Field(
        description="PUT the file here within expires_in seconds, with exactly the same Content-Type and size"
    )
    expires_in: int


class FileUrl(BaseModel):
    url: str = Field(description="Short-lived signed GET URL")
    expires_in: int


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


Text = Annotated[str, StringConstraints(min_length=1, max_length=500, strip_whitespace=True)]
OptionalText = Annotated[str, StringConstraints(max_length=500, strip_whitespace=True)] | None
ContactPhone = Annotated[str, StringConstraints(pattern=r"^[0-9+ ]{10,15}$")]
Occupation = Literal["working", "student", "other"]
IdDocType = Literal["aadhaar", "pan", "driving_licence", "voter_id", "passport"]


FoodPreference = Literal["veg", "non_veg", "egg"]
PoliceVerificationStatus = Literal["pending", "submitted", "verified"]
VehicleNumber = Annotated[str, StringConstraints(max_length=20, strip_whitespace=True)]
ContactRelation = Annotated[str, StringConstraints(max_length=40, strip_whitespace=True)]


class OnboardingSubmit(BaseModel):
    """The Reception QR form. Photos are object keys from POST /public/join/{qr_slug}/uploads."""

    model_config = {"extra": "forbid"}

    full_name: Text
    phone: Phone = Field(description="10 digits, starting 6-9")
    email: OptionalText = None
    date_of_birth: date | None = None
    permanent_address: Text
    occupation: Occupation
    employer_or_college: OptionalText = None
    emergency_contact_name: Text
    emergency_contact_phone: ContactPhone
    emergency_contact_relation: ContactRelation | None = Field(default=None, description="e.g. father, sister")
    food_preference: FoodPreference | None = None
    vehicle_number: VehicleNumber | None = Field(default=None, description="e.g. KA01AB1234")
    id_doc_type: IdDocType
    id_doc_number: Text
    id_doc_path: Text = Field(description="object_key of the ID photo upload (onboarding/{property_id}/...)")
    selfie_path: Text = Field(description="object_key of the live selfie upload (onboarding/{property_id}/...)")
    is_foreign_national: bool = False
    passport_number: OptionalText = Field(default=None, description="Required for foreign nationals")
    visa_number: OptionalText = Field(default=None, description="Required for foreign nationals")
    visa_expiry: date | None = None
    accepted_rules: Literal[True]
    accepted_exit_deduction_paise: Paise = Field(
        description="The exit_deduction_paise shown on the form (from GET /public/join/{qr_slug}), unchanged"
    )

    @model_validator(mode="after")
    def _blank_is_missing(self):
        for name in (
            "email",
            "employer_or_college",
            "passport_number",
            "visa_number",
            "emergency_contact_relation",
            "vehicle_number",
        ):
            if getattr(self, name) == "":
                setattr(self, name, None)
        return self


class OnboardingSubmitted(BaseModel):
    request_id: UUID


OnboardingStatus = Literal["pending", "approved", "rejected"]
StayType = Literal["monthly", "short_term"]


class OnboardingRequestSummary(BaseModel):
    id: UUID
    full_name: str
    phone: str
    occupation: Occupation
    employer_or_college: str | None
    is_foreign_national: bool
    created_at: datetime


class OnboardingSuggested(BaseModel):
    """Defaults for the approve form. Caretakers may raise, never lower, rent, deposit and maintenance charge."""

    rent_paise: Paise | None = Field(
        description="Monthly: the bed's floor price (needs ?bed_id=). Short-term: the property's daily rate"
    )
    deposit_paise: Paise = Field(description="The property's security_deposit_paise")
    maintenance_charge_paise: Paise = Field(description="The property's maintenance_charge_paise")
    first_month_rent_paise: Paise | None = Field(
        description="Monthly only: pro-rata first month for a check-in today at rent_paise"
    )


class OnboardingRequestDetail(BaseModel):
    id: UUID
    property_id: UUID
    property_name: str
    status: OnboardingStatus
    full_name: str
    phone: str
    email: str | None
    date_of_birth: date | None
    permanent_address: str
    occupation: Occupation
    employer_or_college: str | None
    emergency_contact_name: str
    emergency_contact_phone: str
    emergency_contact_relation: str | None
    food_preference: FoodPreference | None
    vehicle_number: str | None
    id_doc_type: IdDocType
    id_doc_number: str
    id_doc_path: str
    selfie_path: str
    id_doc_url: str = Field(description="Short-lived signed GET URL of the ID photo")
    selfie_url: str = Field(description="Short-lived signed GET URL of the selfie")
    url_expires_in: int = Field(description="Seconds the signed URLs stay valid")
    is_foreign_national: bool
    passport_number: str | None
    visa_number: str | None
    visa_expiry: date | None
    accepted_rules: bool
    accepted_exit_deduction_paise: Paise
    accepted_at: datetime
    created_at: datetime
    reviewed_by: UUID | None
    reviewed_at: datetime | None
    review_note: str | None
    suggested: OnboardingSuggested


class OnboardingApprove(BaseModel):
    model_config = {"extra": "forbid"}

    bed_id: UUID
    stay_type: StayType
    rent_paise: Rent = Field(description="Monthly rent, or the daily rate for short_term, in paise")
    deposit_paise: Paise = Field(description="Refundable security deposit")
    maintenance_charge_paise: Paise = Field(description="One-time, non-refundable")
    check_in_date: date
    expected_vacate_date: date | None = Field(default=None, description="Check-out date; required for short_term")
    discount_request_id: UUID | None = None

    @model_validator(mode="after")
    def _vacate_date(self):
        if self.stay_type == "short_term":
            if self.expected_vacate_date is None:
                raise ValueError("expected_vacate_date is required for a short stay")
            if self.expected_vacate_date < self.check_in_date:
                raise ValueError("expected_vacate_date can't be before check_in_date")
        elif self.expected_vacate_date is not None:
            raise ValueError("expected_vacate_date is only for short stays; monthly stays end through notice")
        return self


class OnboardingApproved(BaseModel):
    resident_id: UUID
    stay_id: UUID
    invoice_ids: list[UUID] = Field(description="Joining invoices: deposit, maintenance_charge, first rent")


class OnboardingReject(BaseModel):
    model_config = {"extra": "forbid"}

    note: Annotated[str, StringConstraints(min_length=1, max_length=500, strip_whitespace=True)]


StayStatus = Literal["reserved", "active", "on_notice", "vacated"]


class Stay(BaseModel):
    id: UUID
    property_id: UUID
    resident_id: UUID
    resident_name: str
    bed_id: UUID
    bed_label: str
    room_label: str
    stay_type: StayType
    status: StayStatus
    rent_paise: Paise = Field(description="Monthly rent, or the daily rate for short_term")
    deposit_paise: Paise
    check_in_date: date
    notice_given_on: date | None
    expected_vacate_date: date | None = Field(description="Last day: from the notice rule, or a short stay's check-out")
    actual_vacate_date: date | None
    discount_request_id: UUID | None
    created_at: datetime
    updated_at: datetime


class NoticeRequest(BaseModel):
    """Owner overrides only. Caretakers send no body: the date is today and the last day follows the notice rule."""

    model_config = {"extra": "forbid"}

    notice_given_on: date | None = None
    expected_vacate_date: date | None = None


class MoveOutRequest(BaseModel):
    model_config = {"extra": "forbid"}

    actual_vacate_date: date = Field(description="Caretakers: today only. Owners: any date")


class StayCorrection(BaseModel):
    """Owner only. Partial update: only the fields sent are changed."""

    model_config = {"extra": "forbid"}

    check_in_date: date = _optional()
    actual_vacate_date: date = _optional(description="Only for a stay that has moved out")
    deposit_paise: Paise = _optional()
    rent_paise: Rent = _optional()

    @model_validator(mode="after")
    def _not_null(self):
        for name in ("check_in_date", "actual_vacate_date", "deposit_paise", "rent_paise"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} may not be null")
        return self


ExpenseCategory = Literal[
    "water_tanker",
    "electricity_bescom",
    "groceries",
    "gas_lpg",
    "maintenance_repairs",
    "cleaning",
    "internet",
    "staff_salary",
    "security",
    "lease_rent",
    "other",
]


class ExpenseCreate(BaseModel):
    """`no_bill` needs a note (>= 5 chars), a live photo uploaded in the last 15 minutes, its capture time and GPS.
    Caretakers: paid from their cash, dated within the last 3 days, never lease rent. The database enforces it."""

    model_config = {"extra": "forbid"}

    property_id: UUID
    category: ExpenseCategory
    amount_paise: Rent
    quantity: Annotated[float, Field(gt=0, le=99_999_999)] | None = Field(
        default=None, description="e.g. 3 (tankers), so the owner sees the price per unit"
    )
    unit: Annotated[str, StringConstraints(min_length=1, max_length=20, strip_whitespace=True)] | None = Field(
        default=None, description="e.g. 'tanker'"
    )
    expense_date: date
    vendor_name: Annotated[str, StringConstraints(min_length=1, max_length=120, strip_whitespace=True)] | None = None
    notes: Annotated[str, StringConstraints(max_length=1000, strip_whitespace=True)] | None = None
    bill_mode: Literal["has_bill", "no_bill"]
    proof_path: str = Field(description="object_key from POST /uploads (kind expense_proof) for this property")
    proof_captured_at: datetime | None = None
    proof_lat: Annotated[float, Field(ge=-90, le=90)] | None = None
    proof_lng: Annotated[float, Field(ge=-180, le=180)] | None = None
    paid_from: Literal["caretaker_cash", "owner_direct"]


class ExpenseReview(BaseModel):
    model_config = {"extra": "forbid"}

    note: Annotated[str, StringConstraints(max_length=1000, strip_whitespace=True)] | None = None


class Expense(BaseModel):
    id: UUID
    property_id: UUID
    category: ExpenseCategory
    amount_paise: Paise
    quantity: float | None
    unit: str | None
    expense_date: date
    vendor_name: str | None
    notes: str | None
    bill_mode: Literal["has_bill", "no_bill"]
    proof_path: str = Field(description="View it with GET /files/url?key=...")
    proof_captured_at: datetime | None
    proof_lat: float | None
    proof_lng: float | None
    paid_from: Literal["caretaker_cash", "owner_direct"]
    owner_only: bool
    flagged_for_review: bool
    reviewed_by: UUID | None
    reviewed_at: datetime | None
    review_note: str | None
    created_by: UUID
    created_at: datetime
    voided_at: datetime | None
    voided_by: UUID | None
    void_reason: str | None


ComplaintCategory = Literal["wifi", "water", "electricity", "plumbing", "ac", "cleaning", "food", "security", "other"]
ComplaintPriority = Literal["low", "normal", "urgent"]
ComplaintStatus = Literal["open", "in_progress", "resolved"]
ComplaintTitle = Annotated[str, StringConstraints(min_length=1, max_length=120, strip_whitespace=True)]
ComplaintNote = Annotated[str, StringConstraints(max_length=2000, strip_whitespace=True)]


class ComplaintCreate(BaseModel):
    model_config = {"extra": "forbid"}

    property_id: UUID
    room_id: UUID | None = None
    bed_id: UUID | None = None
    resident_id: UUID | None = None
    category: ComplaintCategory
    title: ComplaintTitle
    note: ComplaintNote | None = None
    priority: ComplaintPriority = "normal"
    photo_path: str | None = Field(
        default=None, description="object_key from POST /uploads (kind complaint_photo) for this property"
    )
    assigned_to: UUID | None = Field(default=None, description="An active member of the organization")


class ComplaintUpdate(BaseModel):
    """Partial update. Resolving needs `resolution_note`; reopening clears the resolution."""

    model_config = {"extra": "forbid"}

    status: ComplaintStatus = _optional()
    priority: ComplaintPriority = _optional()
    category: ComplaintCategory = _optional()
    title: ComplaintTitle = _optional()
    note: ComplaintNote | None = None
    assigned_to: UUID | None = None
    resolution_note: ComplaintNote | None = None

    @model_validator(mode="after")
    def _not_null(self):
        for name in ("status", "priority", "category", "title"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} may not be null")
        return self


class Resident(BaseModel):
    id: UUID
    property_id: UUID
    onboarding_request_id: UUID | None
    full_name: str
    phone: str
    email: str | None
    date_of_birth: date | None
    permanent_address: str | None
    occupation: Occupation | None
    employer_or_college: str | None
    emergency_contact_name: str | None
    emergency_contact_phone: str | None
    id_doc_type: IdDocType | None
    id_doc_number: str | None
    id_doc_url: str | None = Field(description="Short-lived signed GET URL of the ID photo")
    selfie_url: str | None = Field(description="Short-lived signed GET URL of the selfie")
    url_expires_in: int
    is_foreign_national: bool
    passport_number: str | None
    visa_number: str | None
    visa_expiry: date | None
    emergency_contact_relation: str | None
    food_preference: FoodPreference | None
    vehicle_number: str | None
    police_verification_status: PoliceVerificationStatus
    police_verification_date: date | None
    created_at: datetime
    current_stay: Stay | None = Field(description="The open (not vacated) stay, if any")
    past_stays: list[Stay] = Field(description="Vacated stays, newest first")


class Complaint(BaseModel):
    id: UUID
    property_id: UUID
    property_name: str
    room_id: UUID | None
    room_label: str | None
    bed_id: UUID | None
    bed_label: str | None
    resident_id: UUID | None
    resident_name: str | None
    category: ComplaintCategory
    title: str
    note: str | None
    priority: ComplaintPriority
    status: ComplaintStatus
    photo_path: str | None = Field(description="View it with GET /files/url?key=...")
    assigned_to: UUID | None
    assigned_to_name: str | None
    created_by: UUID
    created_by_name: str
    created_at: datetime
    updated_at: datetime
    resolved_by: UUID | None
    resolved_at: datetime | None
    resolution_note: str | None


Gstin = Annotated[str, StringConstraints(pattern=r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")]
MessageLanguage = Literal["en", "kn", "hi", "ta", "te"]


class Organization(BaseModel):
    id: UUID
    name: str = Field(description="Business name shown on receipts and the Reception poster")
    gstin: str | None
    whatsapp_language: MessageLanguage = Field(description="Language of WhatsApp messages (BE-35 templates)")
    receipt_footer: str | None
    created_at: datetime


class OrganizationUpdate(BaseModel):
    """Owner only. Partial update: only the fields sent change. Send null to clear gstin / receipt_footer."""

    model_config = {"extra": "forbid"}

    name: Annotated[str, StringConstraints(min_length=1, max_length=120, strip_whitespace=True)] = _optional()
    gstin: Gstin | None = None
    whatsapp_language: MessageLanguage = _optional()
    receipt_footer: Annotated[str, StringConstraints(max_length=300, strip_whitespace=True)] | None = None

    @model_validator(mode="after")
    def _not_null(self):
        for name in ("name", "whatsapp_language"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} may not be null")
        return self


class ActivityItem(BaseModel):
    id: int
    at: datetime
    actor_id: UUID | None = Field(description="null when a resident did it (Reception QR form)")
    actor_name: str | None
    entity_type: str = Field(description="Table the change was made in, e.g. expenses, stays, payments")
    entity_id: UUID | None
    action: Literal["insert", "update"]
    property_id: UUID | None
    summary: str = Field(description="One human-readable line. Names, labels and ₹ amounts only")


class ResidentProfileUpdate(BaseModel):
    """Owner or a caretaker of the resident's building. Partial: only the fields sent change.
    `submitted` / `verified` need `police_verification_date` (sent now, or already saved)."""

    model_config = {"extra": "forbid"}

    food_preference: FoodPreference | None = None
    vehicle_number: VehicleNumber | None = None
    emergency_contact_relation: ContactRelation | None = None
    police_verification_status: PoliceVerificationStatus = _optional()
    police_verification_date: date | None = None

    @model_validator(mode="after")
    def _clean(self):
        if "police_verification_status" in self.model_fields_set and self.police_verification_status is None:
            raise ValueError("police_verification_status may not be null")
        for name in ("vehicle_number", "emergency_contact_relation"):
            if getattr(self, name) == "":
                setattr(self, name, None)
        return self


InvoiceKind = Literal["rent", "short_term", "deposit", "maintenance_charge", "exit_deduction", "other"]
Month = Annotated[str, StringConstraints(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")]


class Invoice(BaseModel):
    id: UUID
    invoice_no: str = Field(description="INV-000123, per organization (set by the database)")
    kind: InvoiceKind
    property_id: UUID
    resident_id: UUID
    stay_id: UUID | None
    period_start: date | None
    period_end: date | None
    amount_paise: Paise
    due_date: date
    notes: str | None
    created_by: UUID | None
    created_at: datetime
    voided_at: datetime | None
    void_reason: str | None
    invoice_url: str = Field(description="Public invoice page for the resident")
    whatsapp_url: str = Field(description="wa.me link with the invoice message, ready to send")


class GenerateDueRequest(BaseModel):
    model_config = {"extra": "forbid"}

    month: Month | None = Field(default=None, description="YYYY-MM; default the current month (IST)")
    property_id: UUID | None = Field(default=None, description="Default: every building the caller can access")


class GenerateDueResult(BaseModel):
    month: Month
    created: int = Field(description="New rent invoices. 0 when the month was already generated (safe to re-run)")


class OneOffInvoiceCreate(BaseModel):
    """Owner only: a one-off charge (kind `other`), e.g. a broken-furniture fee."""

    model_config = {"extra": "forbid"}

    resident_id: UUID
    amount_paise: Rent
    due_date: date
    notes: Annotated[str, StringConstraints(min_length=3, max_length=500, strip_whitespace=True)] = Field(
        description="What the charge is for (shown to the resident)"
    )


class DueRow(BaseModel):
    resident_id: UUID
    full_name: str
    phone: str
    bed_label: str | None = Field(description="Current bed; null after move-out")
    outstanding_paise: int = Field(description="Non-void invoices minus non-void payments")
    oldest_due_date: date = Field(description="Due date of the oldest invoice not yet covered by payments")
    days_overdue: int = Field(description="max(0, today (IST) - oldest_due_date). 0 on the due day itself")
    whatsapp_url: str = Field(
        description="wa.me link with the rent reminder (outstanding, oldest due date, link to that invoice)"
    )


class LedgerEntry(BaseModel):
    entry_date: date = Field(description="Invoice due date, or the day a payment was received (IST)")
    type: Literal["invoice", "payment"]
    id: UUID
    reference: str = Field(description="Invoice number, or the payment method and UTR")
    description: str
    amount_paise: int = Field(description="Invoices positive, payments negative")
    voided: bool = Field(description="Void entries are listed for the record but don't change the balance")
    balance_paise: int = Field(description="Running balance after this entry")


class ResidentLedger(BaseModel):
    resident_id: UUID
    full_name: str
    outstanding_paise: int
    entries: list[LedgerEntry] = Field(description="Oldest first")
    whatsapp_url: str | None = Field(description="wa.me rent reminder, as on GET /dues; null when nothing is owed")


PaymentMethod = Literal["cash", "upi", "bank_transfer"]
PaymentStatus = Literal["recorded", "provisional", "verified", "flagged"]


class PaymentCreate(BaseModel):
    """Who received it, when, and the status are set by the database, never by the client."""

    model_config = {"extra": "forbid"}

    resident_id: UUID
    invoice_id: UUID | None = Field(default=None, description="Optional: dues are per resident, not per invoice")
    amount_paise: Rent
    method: PaymentMethod
    utr_number: str | None = Field(
        default=None,
        description="12-digit UPI/bank reference. Required for upi and bank_transfer, not allowed for cash. "
        "Spaces are removed",
    )
    notes: Annotated[str, StringConstraints(max_length=500, strip_whitespace=True)] | None = None

    @model_validator(mode="after")
    def _utr(self):
        if self.utr_number is not None:
            self.utr_number = "".join(self.utr_number.split()) or None
        if self.method == "cash":
            if self.utr_number is not None:
                raise ValueError("Cash payments have no UTR")
        else:
            if self.utr_number is None:
                raise ValueError("UPI and bank payments need the 12-digit UTR")
            if not (len(self.utr_number) == 12 and self.utr_number.isdigit()):
                raise ValueError("The UTR must be exactly 12 digits")
        return self


class Payment(BaseModel):
    id: UUID
    property_id: UUID
    resident_id: UUID
    resident_name: str
    invoice_id: UUID | None
    amount_paise: Paise
    method: PaymentMethod
    utr_number: str | None
    status: PaymentStatus = Field(description="recorded (cash) or provisional (UPI/bank) until verified")
    received_by: UUID
    received_by_name: str
    received_at: datetime
    notes: str | None
    verified_at: datetime | None
    flag_reason: str | None = Field(description="The owner's reason when they flagged it (BE-44)")
    voided_at: datetime | None
    void_reason: str | None
    public_token: str
    receipt_url: str = Field(description="Public receipt page for the resident")
    whatsapp_url: str = Field(description="wa.me link with the receipt message, ready to send")


# ---- Caretaker cash (BE-41) ----


class CashBalance(BaseModel):
    user_id: UUID
    full_name: str
    collected_paise: int = Field(description="Cash payments received (non-void)")
    spent_paise: int = Field(description="Expenses paid from caretaker cash (non-void)")
    handed_over_paise: int = Field(description="Cash handed to the owner")
    in_hand_paise: int = Field(description="collected - spent - handed over. Negative if the owner was overpaid")


class CashHandoverCreate(BaseModel):
    """Who recorded it and when are set by the database."""

    model_config = {"extra": "forbid"}

    caretaker_user_id: UUID
    amount_paise: Rent
    notes: Annotated[str, StringConstraints(max_length=500, strip_whitespace=True)] | None = None


class CashHandover(BaseModel):
    id: UUID
    caretaker_user_id: UUID
    caretaker_name: str
    amount_paise: int
    handed_over_at: datetime
    recorded_by: UUID
    recorded_by_name: str
    notes: str | None


class CashHandoverResult(CashHandover):
    in_hand_paise: int = Field(description="The caretaker's cash in hand after this handover")
    warning: str | None = Field(description="Set when the handover is more than the cash in hand. Still recorded")


class CashLedgerEntry(BaseModel):
    entry_at: datetime
    type: Literal["payment", "expense", "handover"]
    id: UUID
    property_name: str | None
    description: str
    notes: str | None
    amount_paise: int = Field(description="+ cash in (payment), - cash out (expense, handover)")
    voided: bool = Field(description="Void entries are listed but don't change the balance")
    balance_paise: int = Field(description="Cash in hand after this entry")


class CashLedger(BaseModel):
    user_id: UUID
    full_name: str
    in_hand_paise: int
    entries: list[CashLedgerEntry] = Field(description="Oldest first")


# ---- Statement reconciliation (BE-40) ----

CsvSource = Literal["paytm_business", "phonepe_business", "bank_statement", "other"]
CsvMatch = Literal["matched", "amount_mismatch", "unmatched", "already_verified"]


class CsvImportResult(BaseModel):
    import_id: UUID
    row_count: int = Field(description="Credit rows read from the file")
    matched_count: int = Field(description="Payments verified by this upload")
    mismatch_count: int = Field(description="UTR found but the amount differs: payment flagged")
    unmatched_count: int = Field(description="Money received that nobody logged")


class CsvImport(BaseModel):
    id: UUID
    source: CsvSource
    file_name: str
    row_count: int
    matched_count: int
    mismatch_count: int
    unmatched_count: int
    uploaded_by: UUID
    uploaded_by_name: str
    created_at: datetime


class CsvImportRow(BaseModel):
    id: UUID
    utr_number: str | None
    amount_paise: int | None
    txn_at: datetime | None
    payer_name: str | None
    match: CsvMatch
    payment_id: UUID | None
    payment_amount_paise: int | None
    payment_status: PaymentStatus | None
    resident_id: UUID | None
    resident_name: str | None
    raw: dict[str, str] = Field(description="The original row, column name -> value")


# ---- Voids, verification and the audit log (BE-44) ----

Reason = Annotated[str, StringConstraints(min_length=3, max_length=500, strip_whitespace=True)]


class VoidRequest(BaseModel):
    """Who voided it and when are set by the database. A void is final."""

    model_config = {"extra": "forbid"}

    reason: Reason


class FlagRequest(BaseModel):
    model_config = {"extra": "forbid"}

    reason: Reason


class AuditLogEntry(BaseModel):
    id: int
    created_at: datetime
    actor_id: UUID | None
    actor_name: str | None = Field(description="None for changes made by the system")
    entity_type: str = Field(description="Table name, e.g. payments, invoices, stays")
    entity_id: UUID | None
    action: Literal["insert", "update"]
    old_value: dict[str, Any] | None = Field(description="The row before the change (update only)")
    new_value: dict[str, Any] | None = Field(description="The row after the change")


class AuditLogPage(BaseModel):
    items: list[AuditLogEntry] = Field(description="Newest first")
    next_cursor: int | None = Field(description="Pass as `cursor` for the next (older) page. None on the last page")


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
