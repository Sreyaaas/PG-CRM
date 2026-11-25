"""Turn audit-log rows into one human-readable line each (BE-45 activity feed).

Lines use names, labels and ₹ amounts only. Every line is also passed through `app.logs.redact`, so a phone number
or ID number typed into a free-text field (a complaint title, a note) can't leak through. Never phone numbers,
KYC/ID/passport numbers, tokens or file keys.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from uuid import UUID

from app.logs import redact
from app.money import format_inr as inr

_NO_ACTOR = "System"


def _label(value: str | None) -> str:
    return (value or "").replace("_", " ")


@dataclass
class Names:
    """Lookups for ids that appear in audit rows (filled by the router in a few batch queries)."""

    users: dict[UUID, str] = field(default_factory=dict)
    properties: dict[UUID, str] = field(default_factory=dict)
    beds: dict[UUID, str] = field(default_factory=dict)
    residents: dict[UUID, str] = field(default_factory=dict)

    def get(self, table: dict, key, fallback: str) -> str:
        try:
            return table.get(UUID(str(key)), fallback) if key else fallback
        except ValueError:
            return fallback


def _changed(old: dict | None, new: dict, key: str) -> bool:
    return old is not None and old.get(key) != new.get(key)


def _members(actor: str, action: str, old, new, n: Names) -> str:
    who = n.get(n.users, new.get("user_id"), "a staff member")
    if action == "insert":
        if actor == _NO_ACTOR:  # owner self-signup: no one was signed in yet
            return f"{who} signed up and created the organization"
        return f"{actor} added {who} as {new.get('role')}"
    if _changed(old, new, "is_active"):
        return f"{actor} {'reactivated' if new.get('is_active') else 'deactivated'} {who}"
    if _changed(old, new, "role"):
        return f"{actor} made {who} {new.get('role')}"
    return f"{actor} changed {who}'s buildings"


def _properties(actor: str, action: str, old, new, n: Names) -> str:
    name = new.get("name") or "a building"
    if action == "insert":
        return f"{actor} added building {name}"
    if _changed(old, new, "is_active") and not new.get("is_active"):
        return f"{actor} deactivated building {name}"
    if _changed(old, new, "upi_vpa"):
        return f"{actor} updated the UPI payee for {name}"
    return f"{actor} updated building {name}"


def _beds(actor: str, action: str, old, new, n: Names) -> str:
    bed = f"bed {new.get('label')}"
    if action == "insert":
        return f"{actor} added {bed} at {inr(new.get('base_rent_paise'))}/month"
    if _changed(old, new, "base_rent_paise"):
        return f"{actor} changed the floor price of {bed} to {inr(new.get('base_rent_paise'))}"
    if _changed(old, new, "is_active"):
        return f"{actor} put {bed} back in use" if new.get("is_active") else f"{actor} took {bed} out of use"
    if _changed(old, new, "status"):
        return f"Bed {new.get('label')} is now {_label(new.get('status'))}"
    return f"{actor} updated {bed}"


def _onboarding(actor: str, action: str, old, new, n: Names) -> str:
    who = new.get("full_name") or "A resident"
    if action == "insert":
        return f"{who} submitted a check-in request at {n.get(n.properties, new.get('property_id'), 'a building')}"
    if _changed(old, new, "status") and new.get("status") in ("approved", "rejected"):
        return f"{actor} {new.get('status')} the check-in request of {who}"
    return f"{actor} updated the check-in request of {who}"


def _residents(actor: str, action: str, old, new, n: Names) -> str:
    who = new.get("full_name") or "a resident"
    return f"{actor} {'added' if action == 'insert' else 'updated'} resident {who}"


def _discounts(actor: str, action: str, old, new, n: Names) -> str:
    bed = n.get(n.beds, new.get("bed_id"), "a bed")
    if action == "insert":
        return f"{actor} requested a discounted rent of {inr(new.get('requested_rent_paise'))}/month for bed {bed}"
    if _changed(old, new, "status"):
        return f"{actor} {new.get('status')} the discount for bed {bed}"
    return f"{actor} updated the discount request for bed {bed}"


def _stays(actor: str, action: str, old, new, n: Names) -> str:
    who = n.get(n.residents, new.get("resident_id"), "a resident")
    bed = n.get(n.beds, new.get("bed_id"), "a bed")
    per = "/day" if new.get("stay_type") == "short_term" else "/month"
    if action == "insert":
        verb = "reserved" if new.get("status") == "reserved" else "checked in"
        return f"{actor} {verb} {who} on bed {bed} at {inr(new.get('rent_paise'))}{per}"
    status = new.get("status")
    if _changed(old, new, "status"):
        if status == "vacated":
            return f"{actor} moved {who} out of bed {bed}"
        if status == "on_notice":
            return f"{actor} recorded notice for {who} (bed {bed})"
        if status == "active" and old.get("status") == "reserved":
            return f"{actor} checked in {who} on bed {bed}"
        if status == "active":
            return f"{actor} withdrew the notice for {who} (bed {bed})"
    if _changed(old, new, "rent_paise"):
        return f"{actor} changed {who}'s rent to {inr(new.get('rent_paise'))}{per}"
    return f"{actor} updated the stay of {who} (bed {bed})"


def _voided(old, new) -> bool:
    return _changed(old, new, "voided_at") and new.get("voided_at") is not None


def _invoices(actor: str, action: str, old, new, n: Names) -> str:
    who = n.get(n.residents, new.get("resident_id"), "a resident")
    what = f"{_label(new.get('kind'))} invoice {new.get('invoice_no') or ''}".replace("  ", " ").strip()
    if action == "insert":
        return f"{actor} created a {inr(new.get('amount_paise'))} {what} for {who}"
    if _voided(old, new):
        return f"{actor} voided {what} of {who}"
    return f"{actor} updated {what} of {who}"


def _payments(actor: str, action: str, old, new, n: Names) -> str:
    who = n.get(n.residents, new.get("resident_id"), "a resident")
    method = {"cash": "cash", "upi": "UPI", "bank_transfer": "bank transfer"}.get(new.get("method"), "a payment")
    amount = inr(new.get("amount_paise"))
    if action == "insert":
        return f"{actor} logged {amount} {method} from {who}"
    if _voided(old, new):
        return f"{actor} voided the {amount} {method} payment from {who}"
    if _changed(old, new, "status") and new.get("status") in ("verified", "flagged"):
        return f"The {amount} {method} payment from {who} was {new.get('status')}"
    return f"{actor} updated the {amount} payment from {who}"


def _handovers(actor: str, action: str, old, new, n: Names) -> str:
    who = n.get(n.users, new.get("caretaker_user_id"), "a caretaker")
    return f"{actor} recorded a {inr(new.get('amount_paise'))} cash handover from {who}"


def _expenses(actor: str, action: str, old, new, n: Names) -> str:
    amount, category = inr(new.get("amount_paise")), _label(new.get("category"))
    at = n.get(n.properties, new.get("property_id"), "a building")
    if action == "insert":
        bill = " (no bill)" if new.get("bill_mode") == "no_bill" else ""
        return f"{actor} logged a {amount} {category} expense{bill} at {at}"
    if _voided(old, new):
        return f"{actor} voided the {amount} {category} expense at {at}"
    if _changed(old, new, "reviewed_at"):
        return f"{actor} reviewed the {amount} {category} expense at {at}"
    return f"{actor} updated the {amount} {category} expense at {at}"


def _complaints(actor: str, action: str, old, new, n: Names) -> str:
    title = new.get("title") or "a complaint"
    if action == "insert":
        urgent = "an urgent" if new.get("priority") == "urgent" else "a"
        return f"{actor} raised {urgent} {_label(new.get('category'))} complaint: {title}"
    if _changed(old, new, "status"):
        status = new.get("status")
        if status == "resolved":
            return f"{actor} resolved: {title}"
        if status == "in_progress":
            return f"{actor} started on: {title}"
        return f"{actor} reopened: {title}"
    if _changed(old, new, "assigned_to") and new.get("assigned_to"):
        return f"{actor} assigned {n.get(n.users, new.get('assigned_to'), 'someone')} to: {title}"
    return f"{actor} updated: {title}"


_SUMMARIES: dict[str, Callable[..., str]] = {
    "organization_members": _members,
    "properties": _properties,
    "beds": _beds,
    "onboarding_requests": _onboarding,
    "residents": _residents,
    "discount_requests": _discounts,
    "stays": _stays,
    "invoices": _invoices,
    "payments": _payments,
    "cash_handovers": _handovers,
    "expenses": _expenses,
    "complaints": _complaints,
}
_SINGULAR = {
    "csv_imports": "statement upload",
    "csv_import_rows": "statement row",
    "exit_settlements": "exit settlement",
}


def summarize(
    entity_type: str, action: str, old: dict | None, new: dict | None, actor: str | None, names: Names
) -> str:
    """`actor` is the person's name, or None when nobody was signed in (signup, the Reception QR form, system)."""
    actor = actor or _NO_ACTOR
    new = new or old or {}
    build = _SUMMARIES.get(entity_type)
    if build is not None:
        line = build(actor, action, old, new, names)
    else:
        thing = _SINGULAR.get(entity_type, entity_type.rstrip("s").replace("_", " "))
        article = "an" if thing[:1] in "aeiou" else "a"
        line = f"{actor} {'created' if action == 'insert' else 'updated'} {article} {thing}"
    return redact(line)
