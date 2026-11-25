"""Statement reconciliation (BE-40): threat #5, reused / fake UPI screenshots.

UPI and bank payments logged at the desk are only `provisional`. The owner uploads their real Paytm Business /
PhonePe Business / bank statement; every credit row whose UTR matches a logged payment with the same amount verifies
it, a different amount flags it, and money that nobody logged is listed as `unmatched`. There is no public API to
check a UTR, so this is the only real verification.

Owner only (also enforced by RLS and `app.csv_imports_guard`). The payments trigger allows the owner to change only
the status / verification columns and records `verified_by` / `verified_at` itself.
"""

from collections import Counter
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from psycopg import Cursor
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from app import statements
from app.deps import Org, require_owner
from app.routers.payments import PAYMENT_SELECT, payment_out
from app.schemas import CsvImport, CsvImportResult, CsvImportRow, CsvSource, Payment

router = APIRouter(prefix="/reconciliation", tags=["reconciliation"])

MAX_BYTES = 5 * 1024 * 1024
_OWNER_ONLY = "Only the owner can reconcile statements."
_NOT_FOUND = {404: {"description": "Not found"}}


def _payment_for(cur: Cursor[DictRow], utr: str | None) -> dict | None:
    if utr is None:
        return None
    cur.execute(
        """SELECT id, amount_paise, status::text AS status FROM payments
            WHERE utr_number = %s AND voided_at IS NULL FOR UPDATE""",
        (utr,),
    )
    return cur.fetchone()


def _match(row: statements.StatementRow, payment: dict | None) -> str:
    if payment is None:
        return "unmatched"
    if payment["status"] == "verified":
        return "already_verified"
    return "matched" if payment["amount_paise"] == row.amount_paise else "amount_mismatch"


@router.post(
    "/imports",
    response_model=CsvImportResult,
    status_code=201,
    responses={413: {"description": "File larger than 5 MB"}, 422: {"description": "Not a readable statement"}},
)
def upload_statement(
    ctx: Org,
    file: Annotated[UploadFile, File(description="Statement CSV, at most 5 MB")],
    source: Annotated[CsvSource, Form()],
) -> CsvImportResult:
    """Read the statement's credit rows and reconcile them against logged UPI / bank payments, in one transaction."""
    with ctx.tx() as cur:
        require_owner(cur, _OWNER_ONLY)
        data = file.file.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "The file is larger than 5 MB.")
        try:
            rows = statements.parse(data, source)
        except statements.StatementError as e:
            raise HTTPException(422, str(e)) from e

        cur.execute(
            "INSERT INTO csv_imports (org_id, source, file_name) VALUES (%s, %s, %s) RETURNING id",
            (ctx.org_id, source, (file.filename or "statement.csv")[:255]),
        )
        import_id = cur.fetchone()["id"]
        counts: Counter[str] = Counter()
        for row in rows:
            payment = _payment_for(cur, row.utr)
            match = _match(row, payment)
            counts[match] += 1
            cur.execute(
                """INSERT INTO csv_import_rows (org_id, import_id, utr_number, amount_paise, txn_at, payer_name, raw,
                                                match, payment_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (
                    ctx.org_id,
                    import_id,
                    row.utr,
                    row.amount_paise,
                    row.txn_at,
                    row.payer_name,
                    Jsonb(row.raw),
                    match,
                    payment["id"] if payment else None,
                ),
            )
            row_id = cur.fetchone()["id"]
            if match == "matched":
                cur.execute(
                    "UPDATE payments SET status = 'verified', csv_import_row_id = %s WHERE id = %s",
                    (row_id, payment["id"]),
                )
            elif match == "amount_mismatch" and payment["status"] != "flagged":
                cur.execute("UPDATE payments SET status = 'flagged' WHERE id = %s", (payment["id"],))

        result = CsvImportResult(
            import_id=import_id,
            row_count=len(rows),
            matched_count=counts["matched"],
            mismatch_count=counts["amount_mismatch"],
            unmatched_count=counts["unmatched"],
        )
        cur.execute(
            """UPDATE csv_imports SET row_count = %s, matched_count = %s, mismatch_count = %s, unmatched_count = %s
                WHERE id = %s""",
            (result.row_count, result.matched_count, result.mismatch_count, result.unmatched_count, import_id),
        )
    return result


@router.get("/imports", response_model=list[CsvImport])
def list_imports(ctx: Org) -> list[CsvImport]:
    """Newest first."""
    with ctx.tx() as cur:
        require_owner(cur, _OWNER_ONLY)
        cur.execute(
            """SELECT i.id, i.source::text AS source, i.file_name, i.row_count, i.matched_count, i.mismatch_count,
                      i.unmatched_count, i.uploaded_by, u.full_name AS uploaded_by_name, i.created_at
                 FROM csv_imports i JOIN users u ON u.id = i.uploaded_by
                ORDER BY i.created_at DESC, i.id"""
        )
        return [CsvImport(**r) for r in cur.fetchall()]


@router.get("/imports/{import_id}/rows", response_model=list[CsvImportRow], responses=_NOT_FOUND)
def import_rows(import_id: UUID, ctx: Org) -> list[CsvImportRow]:
    """Every credit row of one upload with its match, and the payment and resident it matched."""
    with ctx.tx() as cur:
        require_owner(cur, _OWNER_ONLY)
        cur.execute("SELECT 1 FROM csv_imports WHERE id = %s", (import_id,))
        if cur.fetchone() is None:
            raise HTTPException(404, "Import not found")
        cur.execute(
            """SELECT r.id, r.utr_number, r.amount_paise, r.txn_at, r.payer_name, r.match::text AS match, r.raw,
                      r.payment_id, p.amount_paise AS payment_amount_paise, p.status::text AS payment_status,
                      p.resident_id, res.full_name AS resident_name
                 FROM csv_import_rows r
                 LEFT JOIN payments p ON p.id = r.payment_id
                 LEFT JOIN residents res ON res.id = p.resident_id
                WHERE r.import_id = %s
                ORDER BY r.txn_at, r.utr_number NULLS LAST, r.id""",
            (import_id,),
        )
        return [CsvImportRow(**r) for r in cur.fetchall()]


@router.get("/unverified-payments", response_model=list[Payment])
def unverified_payments(
    ctx: Org,
    older_than_days: Annotated[int, Query(ge=0, le=365, description="Logged at least this many days ago")] = 3,
) -> list[Payment]:
    """Provisional UPI / bank payments that no uploaded statement has ever contained: likely fake screenshots.
    Oldest first."""
    with ctx.tx() as cur:
        require_owner(cur, _OWNER_ONLY)
        cur.execute(
            PAYMENT_SELECT
            + """ WHERE pm.status = 'provisional' AND pm.voided_at IS NULL
                    AND pm.received_at <= now() - make_interval(days => %s)
                    AND NOT EXISTS (SELECT 1 FROM csv_import_rows r WHERE r.utr_number = pm.utr_number)
                  ORDER BY pm.received_at""",
            (older_than_days,),
        )
        return [payment_out(r) for r in cur.fetchall()]
