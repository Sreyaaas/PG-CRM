"""wa.me message links (no WhatsApp Business API: free links that open WhatsApp with the text filled in; the
caretaker taps Send). Wording lives in one dict so it is the same everywhere and can gain languages later.

BE-31 needs the receipt; BE-35 adds the reminder, invoice and settlement templates here.
"""

from urllib.parse import quote

from app.config import get_settings
from app.money import format_inr

TEMPLATES = {
    "receipt": "Hi {first_name}, received {amount} ({method}) for {property}. Receipt: {receipt_url}",
}
METHOD_LABELS = {"cash": "Cash", "upi": "UPI", "bank_transfer": "Bank transfer"}


def first_name(full_name: str) -> str:
    return (full_name or "").strip().split(" ")[0] or "there"


def document_url(public_token: str) -> str:
    """The public receipt / invoice page (FE-32) for a document's unguessable token."""
    return f"{get_settings().public_app_url.rstrip('/')}/receipt/{public_token}"


def wa_link(phone: str, text: str) -> str:
    """https://wa.me/91<10 digits>?text=<url-encoded>. Phones are stored as 10 digits."""
    return f"https://wa.me/91{phone}?text={quote(text, safe='')}"


def receipt_link(*, phone: str, full_name: str, amount_paise: int, method: str, property_name: str, token: str) -> str:
    text = TEMPLATES["receipt"].format(
        first_name=first_name(full_name),
        amount=format_inr(amount_paise),
        method=METHOD_LABELS.get(method, method),
        property=property_name,
        receipt_url=document_url(token),
    )
    return wa_link(phone, text)
