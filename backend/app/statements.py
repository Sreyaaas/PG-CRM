"""Read Paytm Business / PhonePe Business / bank statement CSVs into credit rows (BE-40).

The Paytm, PhonePe and bank layouts are MOCKS (backend/tests/fixtures/statements/README.md): check them against real
exports before launch. Each source has one small function below that picks its columns from the header row, so
fixing a source is a change to that function only. `other` uses the generic header keywords.

Only credits are returned. Amounts are parsed with Decimal into integer paise, never floats.
"""

import csv
import io
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
UTR = re.compile(r"\b\d{12}\b")
_PREAMBLE_LINES = 30  # the header row must be within the first 30 lines
_DATE_FORMATS = (
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%d/%m/%Y",
    "%d-%m-%Y %H:%M:%S",
    "%d-%m-%Y %H:%M",
    "%d-%m-%Y",
    "%d/%m/%y",
    "%d-%b-%Y",
    "%d %b %Y",
)
_CREDIT_WORDS = {"CR", "CREDIT", "C", "RECEIVED"}


class StatementError(ValueError):
    """The file can't be read as a statement (message is shown to the owner)."""


@dataclass(frozen=True)
class Columns:
    """Column positions in the header row. A UTR column, a narration column, or both."""

    date: int
    amount: int
    utr: int | None = None
    narration: int | None = None
    payer: int | None = None
    direction: int | None = None  # CREDIT / DEBIT marker; when present, only credit values are kept


@dataclass(frozen=True)
class StatementRow:
    utr: str | None
    amount_paise: int
    txn_at: datetime
    payer_name: str | None
    raw: dict[str, str]


def _find(header: list[str], *keywords: str) -> int | None:
    """First column whose name contains a keyword (case-insensitive); earlier keywords win."""
    names = [name.strip().lower() for name in header]
    for keyword in keywords:
        for i, name in enumerate(names):
            if keyword in name:
                return i
    return None


def _columns(header: list[str], **keywords: tuple[str, ...]) -> Columns | None:
    found = {field: _find(header, *words) for field, words in keywords.items()}
    if found.get("date") is None or found.get("amount") is None:
        return None
    if found.get("utr") is None and found.get("narration") is None:
        return None
    return Columns(**found)


# ---- One function per source: swap in the real column names here ------------------------------------------------


def _paytm_business(header: list[str]) -> Columns | None:
    # Mock: Transaction Date, Order ID, UTR No., Customer Name, Amount, Type (CREDIT / DEBIT)
    return _columns(
        header,
        date=("transaction date",),
        amount=("amount",),
        utr=("utr",),
        payer=("customer name",),
        direction=("type",),
    )


def _phonepe_business(header: list[str]) -> Columns | None:
    # Mock: Date, Transaction ID, UPI Ref No, Payer Name, Payer VPA, Transaction Type, Amount (INR)
    return _columns(
        header, date=("date",), amount=("amount",), utr=("upi ref",), payer=("payer name",), direction=("type",)
    )


def _bank_statement(header: list[str]) -> Columns | None:
    # Mock: Date, Narration (UPI/<UTR>/<NAME>/...), Chq/Ref No, Value Date, Debit, Credit, Balance.
    # A debit row has an empty Credit cell, so it is skipped.
    return _columns(header, date=("date",), amount=("credit",), narration=("narration",))


def _other(header: list[str]) -> Columns | None:
    # Generic: any statement whose header names contain these words. A credit / deposit column wins over a plain
    # amount column, so "Withdrawal Amount, Deposit Amount" reads deposits.
    return _columns(
        header,
        date=("date", "time"),
        amount=("credit", "deposit", "amount"),
        utr=("utr", "rrn", "upi ref", "reference"),
        narration=("narration", "description", "remarks", "particulars"),
        payer=("name", "payer", "from"),
        direction=("dr/cr", "cr/dr"),
    )


SOURCES: dict[str, Callable[[list[str]], Columns | None]] = {
    "paytm_business": _paytm_business,
    "phonepe_business": _phonepe_business,
    "bank_statement": _bank_statement,
    "other": _other,
}

# ---- Parsing --------------------------------------------------------------------------------------------------------


def to_paise(text: str) -> int | None:
    """'10,500.00' -> 1050000. None for blanks, text, or more than two decimal places."""
    cleaned = text.upper().replace(",", "").replace("₹", "").replace("INR", "").replace("RS.", "").strip()
    if not cleaned:
        return None
    try:
        paise = Decimal(cleaned) * 100
    except InvalidOperation:
        return None
    if not paise.is_finite() or paise != paise.to_integral_value():
        return None
    return int(paise)


def _date(text: str) -> datetime | None:
    text = " ".join(text.split())
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=IST)
        except ValueError:
            continue
    return None


def _payer_from_narration(narration: str, utr: str | None) -> str | None:
    """`UPI/412345678901/ANIKA RAO/...` -> 'ANIKA RAO'."""
    parts = [p.strip() for p in narration.split("/")]
    if utr and utr in parts:
        after = parts[parts.index(utr) + 1 :]
        if after and after[0] and not after[0].isdigit():
            return after[0]
    return None


def _raw(header: list[str], row: list[str]) -> dict[str, str]:
    raw: dict[str, str] = {}
    for i, value in enumerate(row):
        name = (header[i].strip() if i < len(header) else "") or f"column {i + 1}"
        raw[name if name not in raw else f"{name} ({i + 1})"] = value
    return raw


def _rows(text: str, columns_for: Callable[[list[str]], Columns | None]) -> list[StatementRow] | None:
    """None if no header row is found with this delimiter."""
    candidates = [",", ";", "\t", "|"]
    try:
        sniffed = csv.Sniffer().sniff(text[:4096], delimiters="".join(candidates)).delimiter
        candidates.insert(0, sniffed)
    except csv.Error:
        pass
    for delimiter in dict.fromkeys(candidates):
        lines = list(csv.reader(io.StringIO(text), delimiter=delimiter))
        for i, header in enumerate(lines[:_PREAMBLE_LINES]):
            cols = columns_for(header)
            if cols is not None:
                return [r for r in (_row(cols, header, line) for line in lines[i + 1 :]) if r is not None]
    return None


def _row(cols: Columns, header: list[str], line: list[str]) -> StatementRow | None:
    def cell(index: int | None) -> str:
        return line[index].strip() if index is not None and index < len(line) else ""

    if not any(v.strip() for v in line):
        return None
    if cols.direction is not None and cell(cols.direction).upper() not in _CREDIT_WORDS:
        return None  # debit, or anything not clearly a credit
    amount = to_paise(cell(cols.amount))
    if amount is None or amount <= 0:
        return None  # debit row (empty credit column, or negative), or a footer such as "Total"
    when = _date(cell(cols.date))
    if when is None:
        return None  # not a transaction row
    narration = cell(cols.narration)
    match = UTR.search(cell(cols.utr)) or UTR.search(narration)
    utr = match.group() if match else None
    payer = cell(cols.payer) or _payer_from_narration(narration, utr)
    return StatementRow(utr=utr, amount_paise=amount, txn_at=when, payer_name=payer or None, raw=_raw(header, line))


def parse(data: bytes, source: str) -> list[StatementRow]:
    """Credit rows of a statement file. Raises StatementError if it isn't a readable statement."""
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    rows = _rows(text.lstrip("﻿"), SOURCES[source])
    if rows is None:
        raise StatementError(
            "Couldn't find the column headings in this file (it needs a date, an amount, and a UTR / reference "
            "or narration column). Check that you picked the right source."
        )
    return rows
