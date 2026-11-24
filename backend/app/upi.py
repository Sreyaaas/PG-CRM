"""UPI QR handling.

The owner scans their Soundbox QR once. We keep only the payee details (`pa`, `pn`, `mc`) and drop everything
else, especially `sign=`: a signed QR whose amount we later change is rejected by UPI apps as tampered.
The raw QR text is never stored.
"""

import re
from dataclasses import dataclass
from urllib.parse import parse_qs

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
