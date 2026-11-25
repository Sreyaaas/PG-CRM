"""UPI QR handling: reading the owner's QR (BE-11) and building the dynamic per-invoice payload (BE-33).

The owner scans their Soundbox QR once. We keep only the payee details (`pa`, `pn`, `mc`) and drop everything
else, especially `sign=`: a signed QR whose amount we later change is rejected by UPI apps as tampered.
The raw QR text is never stored.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, quote

_PREFIX = "upi://pay?"
_VPA = re.compile(r"^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$")
_MCC = re.compile(r"^[0-9]{4}$")
PAYEE_NAME_MAX = 100
NOT_MERCHANT_WARNING = "Not a merchant QR"


class UpiQrError(ValueError):
    """The text can't be used as the property's payee details. `str(err)` is shown to the user."""


@dataclass(frozen=True)
class UpiPayee:
    vpa: str
    payee_name: str | None
    mcc: str | None


def parse_upi_qr(qr_text: str) -> UpiPayee:
    text = qr_text.strip()
    if not text.lower().startswith(_PREFIX):
        raise UpiQrError("This is not a UPI payment QR")

    params = parse_qs(text[len(_PREFIX) :], keep_blank_values=True)

    def first(key: str) -> str | None:
        values = params.get(key)
        return values[0].strip() if values else None

    vpa = first("pa")
    if not vpa:
        raise UpiQrError("This UPI QR has no payee UPI ID (pa)")
    if not _VPA.match(vpa):
        raise UpiQrError("The payee UPI ID (pa) in this QR is not valid")

    payee_name = (first("pn") or "")[:PAYEE_NAME_MAX].strip() or None

    mcc = first("mc") or None
    if mcc is not None and not _MCC.match(mcc):
        raise UpiQrError("The merchant code (mc) in this QR is not valid")

    return UpiPayee(vpa=vpa, payee_name=payee_name, mcc=mcc)


NOTE_MAX = 50


def rupees(amount_paise: int) -> str:
    """10_500_00 -> "10500.00". Integer math only: no float ever touches money."""
    return f"{amount_paise // 100}.{amount_paise % 100:02d}"


def build_upi_uri(property: Mapping[str, Any], amount_paise: int, note: str) -> str | None:
    """`upi://pay?pa=..&pn=..&mc=..&am=..&tn=..&cu=INR` for paying `amount_paise` straight to the property's own UPI.

    `property` needs `upi_vpa`, `upi_payee_name` and `upi_mcc` (a `properties` row). `note` is the invoice number.
    Returns None when the property has no UPI ID (the page then shows only the fallback UPI ID / bank details),
    or when there is nothing to pay (UPI apps refuse a zero amount).

    Never adds `sign`, `tr`, `mode` or `orgid`: those belong to the bank's signed static QR, and a payload that
    carries them with a different amount is rejected by UPI apps as tampered. `pn` / `mc` are left out when unset.

    Limits to keep in mind (why the frontend always shows the fallback UPI ID and bank details with copy
    buttons): UPI apps cap payments from a QR image picked from the phone's gallery (around ₹2,000) and often
    decline web `upi://` deep links for rent-sized amounts. So this QR is meant to be scanned live with the camera,
    from another phone's screen or a printed copy.
    """
    vpa = property.get("upi_vpa")
    if not vpa or amount_paise <= 0:
        return None
    params = [("pa", quote(vpa, safe="@"))]
    if property.get("upi_payee_name"):
        params.append(("pn", quote(property["upi_payee_name"], safe="")))
    if property.get("upi_mcc"):
        params.append(("mc", quote(property["upi_mcc"], safe="")))
    params += [("am", rupees(amount_paise)), ("tn", quote(note[:NOTE_MAX], safe="")), ("cu", "INR")]
    return "upi://pay?" + "&".join(f"{k}={v}" for k, v in params)
