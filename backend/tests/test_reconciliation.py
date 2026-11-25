"""BE-40: statement reconciliation (Paytm / PhonePe / bank CSV)."""

from pathlib import Path

import pytest
from conftest import World, api_client, as_user, rand_utr

from app import statements
from app.security import create_access_token

client = api_client()
FIXTURES = Path(__file__).parent / "fixtures" / "statements"
URL = "/api/v1/reconciliation"

# UTRs printed in the mock files, in file order (debit rows included).
PAYTM = ["412345678901", "412345678902", "412345678903", "412345678904", "412345678905"]
BANK = ["612345678901", "612345678902", "612345678903", "612345678904"]


def _h(user, org) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user)[0]}", "X-Org-Id": str(org)}


@pytest.fixture
def w(world: World):
    world.owner_h = _h(world.owner, world.org)
    world.ct_a_h = _h(world.caretaker_a, world.org)
    return world


def _statement(name: str, utrs: list[str]) -> tuple[bytes, dict[str, str]]:
    """A mock file with fresh random UTRs (the UTR index is unique across all orgs and test runs)."""
    data = (FIXTURES / name).read_bytes()
    fresh = {old: rand_utr() for old in utrs}
    for old, new in fresh.items():
        data = data.replace(old.encode(), new.encode())
    return data, fresh


def _upload(w, data: bytes, source: str, headers=None, name="statement.csv"):
    return client.post(
        f"{URL}/imports",
        files={"file": (name, data, "text/csv")},
        data={"source": source},
        headers=headers or w.owner_h,
    )


def _log(w, utr: str, amount_paise: int, method="upi") -> str:
    body = {"resident_id": str(w.resident_a), "amount_paise": amount_paise, "method": method, "utr_number": utr}
    r = client.post("/api/v1/payments", json=body, headers=w.ct_a_h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _payment(w, payment_id) -> dict:
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "SELECT status::text AS status, verified_by, verified_at, csv_import_row_id FROM payments WHERE id = %s",
            (payment_id,),
        )
        return cur.fetchone()


def _rows(w, import_id) -> dict[str, dict]:
    r = client.get(f"{URL}/imports/{import_id}/rows", headers=w.owner_h)
    assert r.status_code == 200, r.text
    return {row["utr_number"]: row for row in r.json()}


# ---- AC1 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-40", "AC1")
@pytest.mark.parametrize(
    ("name", "source", "expected"),
    [
        (
            "paytm_business.csv",
            "paytm_business",
            [
                ("412345678901", 10_500_00),
                ("412345678902", 9_000_00),
                ("412345678903", 8_500_00),
                ("412345678905", 12_000_00),
            ],
        ),
        (
            "phonepe_business.csv",
            "phonepe_business",
            [("512345678901", 10_500_00), ("512345678902", 9_000_00), ("512345678904", 7_250_50)],
        ),
        (
            "bank_narration.csv",
            "bank_statement",
            [("612345678901", 10_500_00), ("612345678902", 9_000_00), ("612345678904", 8_500_00)],
        ),
    ],
)
def test_mock_statements_exist_and_parse(name, source, expected):
    readme = (FIXTURES / "README.md").read_text(encoding="utf-8")
    assert "mocks" in readme.lower() and "before launch" in readme.lower()
    data = (FIXTURES / name).read_bytes()
    lines = data.decode("utf-8-sig").splitlines()
    header = next(i for i, line in enumerate(lines) if "Amount" in line or "Credit" in line)
    assert header >= 3  # preamble lines before the header row
    assert '"10,500.00"' in lines[header + 1] and "/11/2026" in lines[header + 1]  # Indian amounts, DD/MM/YYYY
    assert any("DEBIT" in line or ',,"' in line for line in lines[header + 1 :])  # has debit rows
    rows = statements.parse(data, source)
    assert [(r.utr, r.amount_paise) for r in rows] == expected
    assert all(r.txn_at.tzinfo is not None and r.txn_at.year == 2026 and r.txn_at.month == 11 for r in rows)
    assert all(r.raw for r in rows)


# ---- AC2, AC3, AC4 ----------------------------------------------------------------------------------


@pytest.mark.ac("BE-40", "AC2", "AC3", "AC4")
def test_upload_verifies_flags_and_lists_unlogged_money(w):
    data, utr = _statement("paytm_business.csv", PAYTM)
    exact = _log(w, utr[PAYTM[0]], 10_500_00)  # statement: 10,500.00
    short = _log(w, utr[PAYTM[1]], 8_000_00)  # statement: 9,000.00

    r = _upload(w, data, "paytm_business", name="paytm-nov.csv")
    assert r.status_code == 201, r.text
    result = r.json()
    assert {k: v for k, v in result.items() if k != "import_id"} == {
        "row_count": 4,
        "matched_count": 1,
        "mismatch_count": 1,
        "unmatched_count": 2,
    }
    rows = _rows(w, result["import_id"])

    # AC2: same UTR and amount -> matched, payment verified and linked to the row
    assert rows[utr[PAYTM[0]]]["match"] == "matched"
    assert rows[utr[PAYTM[0]]]["resident_name"] == "Anika Rao"
    assert rows[utr[PAYTM[0]]]["payment_status"] == "verified"
    p = _payment(w, exact)
    assert p["status"] == "verified" and p["verified_by"] == w.owner and p["verified_at"] is not None
    assert str(p["csv_import_row_id"]) == rows[utr[PAYTM[0]]]["id"]

    # AC3: same UTR, different amount -> amount_mismatch, payment flagged
    mismatch = rows[utr[PAYTM[1]]]
    assert (mismatch["match"], mismatch["amount_paise"], mismatch["payment_amount_paise"]) == (
        "amount_mismatch",
        9_000_00,
        8_000_00,
    )
    assert _payment(w, short)["status"] == "flagged" and _payment(w, short)["verified_at"] is None

    # AC4: UTR with no payment -> unmatched (money arrived but nobody logged it)
    for u in (PAYTM[2], PAYTM[4]):
        assert rows[utr[u]]["match"] == "unmatched" and rows[utr[u]]["payment_id"] is None
    assert rows[utr[PAYTM[2]]]["payer_name"] == "Priya Shetty"
    assert rows[utr[PAYTM[2]]]["raw"]["Order ID"] == "PTM20261103002"

    listed = client.get(f"{URL}/imports", headers=w.owner_h).json()
    assert listed[0]["id"] == result["import_id"] and listed[0]["file_name"] == "paytm-nov.csv"
    assert (listed[0]["source"], listed[0]["matched_count"], listed[0]["uploaded_by_name"]) == (
        "paytm_business",
        1,
        "Owner",
    )


@pytest.mark.ac("BE-40", "AC2")
def test_flagged_payment_is_verified_when_a_later_statement_matches(w):
    data, utr = _statement("paytm_business.csv", PAYTM)
    pid = _log(w, utr[PAYTM[0]], 10_000_00)
    _upload(w, data, "paytm_business")
    assert _payment(w, pid)["status"] == "flagged"
    fixed = data.replace(b'"10,500.00"', b'"10,000.00"', 1)
    assert _upload(w, fixed, "paytm_business").json()["matched_count"] == 1
    assert _payment(w, pid)["status"] == "verified"


# ---- AC5 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-40", "AC5")
def test_utr_inside_bank_narration_is_extracted(w):
    data, utr = _statement("bank_narration.csv", BANK)
    pid = _log(w, utr[BANK[0]], 10_500_00, method="bank_transfer")
    result = _upload(w, data, "bank_statement").json()
    assert result["matched_count"] == 1 and result["row_count"] == 3
    rows = _rows(w, result["import_id"])
    assert rows[utr[BANK[0]]]["match"] == "matched" and rows[utr[BANK[0]]]["payer_name"] == "ANIKA RAO"
    assert rows[utr[BANK[0]]]["raw"]["Narration"].startswith(f"UPI/{utr[BANK[0]]}/ANIKA RAO/")
    assert _payment(w, pid)["status"] == "verified"


@pytest.mark.ac("BE-40", "AC5")
def test_narration_utr_with_generic_source():
    csv = b"Txn Date,Description,Withdrawal Amount,Deposit Amount\n02/11/2026,UPI/412345678901/MEERA/x,,500.00\n"
    [row] = statements.parse(csv, "other")
    assert (row.utr, row.amount_paise, row.payer_name) == ("412345678901", 500_00, "MEERA")


# ---- AC6 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-40", "AC6")
def test_debits_ignored_and_indian_amounts_parse_exactly(w):
    assert statements.to_paise("10,500.00") == 1050000
    assert statements.to_paise("₹1,10,500.50") == 11050050
    assert statements.to_paise("0.29") == 29  # a float would give 28.999...
    assert statements.to_paise("12.345") is None and statements.to_paise("") is None

    data, utr = _statement("paytm_business.csv", PAYTM)
    refund = _log(w, utr[PAYTM[3]], 1_000_00)  # the DEBIT row's UTR and amount
    result = _upload(w, data, "paytm_business").json()
    assert utr[PAYTM[3]] not in _rows(w, result["import_id"])
    assert _payment(w, refund)["status"] == "provisional"

    bank, bank_utr = _statement("bank_narration.csv", BANK)
    debit = _log(w, bank_utr[BANK[2]], 1_800_00, method="bank_transfer")  # the "Groceries" debit row
    rows = _rows(w, _upload(w, bank, "bank_statement").json()["import_id"])
    assert bank_utr[BANK[2]] not in rows and _payment(w, debit)["status"] == "provisional"
    assert rows[bank_utr[BANK[0]]]["amount_paise"] == 1050000


# ---- AC7 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-40", "AC7")
def test_uploading_the_same_file_again_changes_nothing(w):
    data, utr = _statement("paytm_business.csv", PAYTM)
    payments = [_log(w, utr[PAYTM[0]], 10_500_00), _log(w, utr[PAYTM[1]], 8_000_00)]
    _upload(w, data, "paytm_business")
    before = [_payment(w, p) for p in payments]

    again = _upload(w, data, "paytm_business").json()
    assert again["matched_count"] == 0 and again["row_count"] == 4
    rows = _rows(w, again["import_id"])
    assert rows[utr[PAYTM[0]]]["match"] == "already_verified"
    assert rows[utr[PAYTM[1]]]["match"] == "amount_mismatch"  # still wrong, still flagged
    assert [_payment(w, p) for p in payments] == before


def test_same_utr_twice_in_one_file_verifies_once(w):
    data, utr = _statement("paytm_business.csv", PAYTM)
    pid = _log(w, utr[PAYTM[0]], 10_500_00)
    lines = data.splitlines()  # LF or CRLF, depending on how git checked the file out
    doubled = b"\n".join([*lines, lines[6]])  # the first credit row again at the end
    result = _upload(w, doubled, "paytm_business").json()
    assert (result["row_count"], result["matched_count"]) == (5, 1)
    with as_user(w.owner, w.org) as cur:
        cur.execute(
            "SELECT match::text AS match FROM csv_import_rows WHERE import_id = %s AND utr_number = %s ORDER BY id",
            (result["import_id"], utr[PAYTM[0]]),
        )
        assert sorted(r["match"] for r in cur.fetchall()) == ["already_verified", "matched"]
    assert _payment(w, pid)["status"] == "verified"


# ---- AC8 --------------------------------------------------------------------------------------------


@pytest.mark.ac("BE-40", "AC8")
def test_caretaker_gets_403_everywhere(w):
    data, utr = _statement("paytm_business.csv", PAYTM)
    pid = _log(w, utr[PAYTM[0]], 10_500_00)
    r = _upload(w, data, "paytm_business", headers=w.ct_a_h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert _payment(w, pid)["status"] == "provisional"

    import_id = _upload(w, data, "paytm_business").json()["import_id"]
    for path in ("/imports", f"/imports/{import_id}/rows", "/unverified-payments"):
        assert client.get(URL + path, headers=w.ct_a_h).status_code == 403, path


# ---- AC9 --------------------------------------------------------------------------------------------


def _backdated(w, utr: str, days: int, method="upi") -> str:
    with as_user(w.owner, w.org) as cur:  # only the owner can set received_at
        cur.execute(
            """INSERT INTO payments (org_id, property_id, resident_id, amount_paise, method, utr_number, status,
                                     received_by, received_at)
               VALUES (%s, %s, %s, 500000, %s, %s, 'provisional', %s, now() - make_interval(days => %s))
               RETURNING id""",
            (w.org, w.prop_a, w.resident_a, method, utr, w.owner, days),
        )
        return str(cur.fetchone()["id"])


@pytest.mark.ac("BE-40", "AC9")
def test_unverified_payments_lists_old_provisional_payments_seen_in_no_statement(w):
    data, utr = _statement("paytm_business.csv", PAYTM)
    _upload(w, data, "paytm_business")  # PAYTM[2] arrives in a statement before anyone logs it
    old = _backdated(w, rand_utr(), 5)
    recent = _backdated(w, rand_utr(), 1)
    seen = _backdated(w, utr[PAYTM[2]], 5)
    flagged = _backdated(w, rand_utr(), 5)
    with as_user(w.owner, w.org) as cur:
        cur.execute("UPDATE payments SET status = 'flagged' WHERE id = %s", (flagged,))

    def listed(**params):
        r = client.get(f"{URL}/unverified-payments", params=params, headers=w.owner_h)
        assert r.status_code == 200, r.text
        return [p["id"] for p in r.json()]

    assert listed() == [old]
    assert listed(older_than_days=0) == [old, recent]
    assert seen not in listed(older_than_days=0)
    assert (
        client.get(f"{URL}/unverified-payments", params={"older_than_days": -1}, headers=w.owner_h).status_code == 422
    )
    [item] = client.get(f"{URL}/unverified-payments", headers=w.owner_h).json()
    assert item["resident_name"] == "Anika Rao" and item["whatsapp_url"].startswith("https://wa.me/")


# ---- Bad files --------------------------------------------------------------------------------------


def test_file_over_5_mb_is_413(w):
    r = _upload(w, b"x" * (5 * 1024 * 1024 + 1), "other")
    assert r.status_code == 413


@pytest.mark.parametrize("data", [b"just,some,text\n1,2,3\n", b"\x89PNG\r\n\x1a\n\x00\x00", b""])
def test_unreadable_file_is_422_and_stores_nothing(w, data):
    r = _upload(w, data, "paytm_business")
    assert r.status_code == 422 and "column headings" in r.json()["error"]["message"]
    assert client.get(f"{URL}/imports", headers=w.owner_h).json() == []


def test_wrong_source_and_bad_source_are_422(w):
    data, _ = _statement("bank_narration.csv", BANK)
    assert _upload(w, data, "paytm_business").status_code == 422  # no UTR column in a bank statement
    assert _upload(w, data, "gpay").status_code == 422


def test_semicolon_delimited_file():
    csv = "Date;UTR;Payer Name;Amount\n01/11/2026;412345678901;Anika;10500.00\n02/11/2026;412345678902;Ravi;250\n"
    rows = statements.parse(csv.encode(), "other")
    assert [(r.utr, r.amount_paise, r.payer_name) for r in rows] == [
        ("412345678901", 10_500_00, "Anika"),
        ("412345678902", 250_00, "Ravi"),
    ]


def test_rows_of_unknown_import_is_404(w):
    assert client.get(f"{URL}/imports/00000000-0000-0000-0000-000000000000/rows", headers=w.owner_h).status_code == 404
