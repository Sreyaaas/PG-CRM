"""wa.me message links (BE-35). No WhatsApp Business API (it costs money and gets numbers banned): free links that
open WhatsApp with the text filled in; the caretaker taps Send.

The wording lives in one dict so it is the same everywhere and can gain Kannada / Hindi later
(`organizations.whatsapp_language`); the MVP sends English. `{amount}` / `{outstanding}` are filled with
`format_inr`, which includes the ₹ sign.
"""

from datetime import date
from urllib.parse import quote

from app.config import get_settings
from app.money import format_inr

TEMPLATES = {
    "receipt": "Hi {first_name}, received {amount} ({method}) for {property}. Receipt: {receipt_url}",
    "reminder": "Hi {first_name}, rent of {outstanding} for {property} was due on {due_date}. Pay here: {invoice_url}",
    "invoice": "Hi {first_name}, your rent invoice {invoice_no} of {amount} is due on {due_date}: {invoice_url}",
    "settlement": "Hi {first_name}, your deposit settlement for {property}: {settlement_url}",
}
METHOD_LABELS = {"cash": "Cash", "upi": "UPI", "bank_transfer": "Bank transfer"}


def first_name(full_name: str) -> str:
    """First word of the full name."""
    return (full_name or "").strip().split(" ")[0] or "there"


def format_date(d: date) -> str:
    """5 Dec 2026: unambiguous for Indian readers (no 12/05 vs 05/12)."""
    return f"{d.day} {d:%b %Y}"


def document_url(public_token: str) -> str:
    """The public receipt / invoice / settlement page (FE-32) for a document's unguessable token."""
    return f"{get_settings().public_app_url.rstrip('/')}/receipt/{public_token}"


def wa_link(phone: str, text: str) -> str:
    """https://wa.me/91<10 digits>?text=<url-encoded>. Phones are stored as 10 digits."""
    return f"https://wa.me/91{phone}?text={quote(text, safe='')}"


def receipt_text(*, full_name: str, amount_paise: int, method: str, property_name: str, token: str) -> str:
    return TEMPLATES["receipt"].format(
        first_name=first_name(full_name),
        amount=format_inr(amount_paise),
        method=METHOD_LABELS.get(method, method),
        property=property_name,
        receipt_url=document_url(token),
    )


def reminder_text(*, full_name: str, outstanding_paise: int, property_name: str, due_date: date, token: str) -> str:
    return TEMPLATES["reminder"].format(
        first_name=first_name(full_name),
        outstanding=format_inr(outstanding_paise),
        property=property_name,
        due_date=format_date(due_date),
        invoice_url=document_url(token),
    )


def invoice_text(*, full_name: str, invoice_no: str, amount_paise: int, due_date: date, token: str) -> str:
    return TEMPLATES["invoice"].format(
        first_name=first_name(full_name),
        invoice_no=invoice_no,
        amount=format_inr(amount_paise),
        due_date=format_date(due_date),
        invoice_url=document_url(token),
    )


def settlement_text(*, full_name: str, property_name: str, token: str) -> str:
    return TEMPLATES["settlement"].format(
        first_name=first_name(full_name), property=property_name, settlement_url=document_url(token)
    )


def receipt_link(*, phone: str, **fields) -> str:
    return wa_link(phone, receipt_text(**fields))


def reminder_link(*, phone: str, **fields) -> str:
    return wa_link(phone, reminder_text(**fields))


def invoice_link(*, phone: str, **fields) -> str:
    return wa_link(phone, invoice_text(**fields))


def settlement_link(*, phone: str, **fields) -> str:
    return wa_link(phone, settlement_text(**fields))
