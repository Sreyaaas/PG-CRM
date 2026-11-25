# Mock statements (BE-40)

**These files are mocks.** We made them up to build and test statement reconciliation. They are not real
Paytm Business, PhonePe Business or bank exports, and the real column names, preamble lines, date formats and
credit/debit markers will differ.

| File | Source | What it exercises |
|---|---|---|
| `paytm_business.csv` | `paytm_business` | preamble, `UTR No.` column, `Type` = CREDIT/DEBIT, `10,500.00` amounts, dates with times |
| `phonepe_business.csv` | `phonepe_business` | UTF-8 BOM, `UPI Ref No` column, `Amount (INR)`, a paise amount (`7,250.50`) |
| `bank_narration.csv` | `bank_statement` | no UTR column: the UTR is inside the narration (`UPI/612345678901/NAME/...`), separate Debit / Credit columns, Indian grouping in the balance (`1,10,500.00`) |

All dates are DD/MM/YYYY. Each file has credit and debit rows; only credits are reconciled.

## Before launch

Export a real statement from each source (with the owner's permission, and never committed to the repo) and check:

1. The header row is found, and the date, amount, UTR (or narration) and payer columns are the right ones.
2. Debits, refunds and failed or reversed transactions are skipped, not counted as money received.
3. Amounts and dates parse correctly.

Each source's columns are picked by one small function in `backend/app/statements.py`, so fixing a source is a
change to that function only. Then update the mock here to match the real layout.
