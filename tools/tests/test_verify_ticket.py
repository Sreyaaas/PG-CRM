"""Tests for tools/verify_ticket.py. Run: cd backend && uv run pytest ../tools/tests"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import verify_ticket as v  # noqa: E402

ISSUE = """
## Acceptance criteria
- [ ] **AC1** Cash payment is `recorded`
- [ ] **AC2** Duplicate UTR returns 409
      with the friendly message
- [ ] **AC3** [manual] Logged on a real phone in under 15 s

## Definition of done
- [ ] pytest passes
"""


def test_parse_criteria():
    cs = v.parse_criteria(ISSUE)
    assert [(c.id, c.manual) for c in cs] == [("AC1", False), ("AC2", False), ("AC3", True)]
    assert cs[2].text == "Logged on a real phone in under 15 s"


def test_signoffs_only_ticked():
    body = "- [x] AC3 checked on Redmi\n- [ ] AC4 not yet\n* [X] **AC5** done"
    assert v.parse_signoffs(body) == {"AC3", "AC5"}


def _r(acs, outcome="passed", ticket="BE-31", test="t"):
    return {"test": test, "ticket": ticket, "acs": acs, "outcome": outcome}


def test_evaluate_statuses():
    cs = v.parse_criteria(ISSUE)
    rows, warnings = v.evaluate("BE-31", cs, [_r(["AC1"]), _r(["AC9"]), _r(["AC1"], ticket="BE-30")], set())
    assert [r.status for r in rows] == [v.PASS, v.NO_TEST, v.MANUAL_PENDING]
    assert len(warnings) == 1 and "AC9" in warnings[0]


def test_one_failing_test_fails_the_criterion():
    cs = v.parse_criteria(ISSUE)
    rows, _ = v.evaluate("BE-31", cs, [_r(["AC1"]), _r(["AC1"], "failed", test="t2")], set())
    assert rows[0].status == v.FAIL


def test_verdict_strict_manual_only_in_pr_mode():
    cs = v.parse_criteria(ISSUE)
    rows, _ = v.evaluate("BE-31", cs, [_r(["AC1", "AC2"])], set())
    assert v.verdict([], rows, strict_manual=False) is True
    assert v.verdict([], rows, strict_manual=True) is False
    rows, _ = v.evaluate("BE-31", cs, [_r(["AC1", "AC2"])], {"AC3"})
    assert v.verdict([], rows, strict_manual=True) is True
    assert v.verdict([v.Check("pytest", False, "boom")], rows, strict_manual=True) is False


def test_no_criteria_is_never_verified():
    assert v.verdict([], [], strict_manual=False) is False


def test_load_vitest_and_playwright(tmp_path):
    (tmp_path / "vitest.json").write_text(
        json.dumps(
            {
                "testResults": [
                    {
                        "assertionResults": [
                            {"fullName": "money [FE-01/AC1] formats lakh", "status": "passed"},
                            {"fullName": "untagged", "status": "failed"},
                        ]
                    }
                ]
            }
        )
    )
    (tmp_path / "pw.json").write_text(
        json.dumps(
            {
                "config": {},
                "suites": [
                    {
                        "title": "pay.spec.ts",
                        "specs": [],
                        "suites": [
                            {
                                "title": "Log payment [FE-31/AC1,AC2]",
                                "specs": [
                                    {"title": "cash", "ok": True, "tests": [{"status": "expected"}]},
                                    {"title": "dup utr", "ok": False, "tests": [{"status": "unexpected"}]},
                                ],
                            }
                        ],
                    }
                ],
            }
        )
    )
    res = v.load_results([tmp_path / "vitest.json", tmp_path / "pw.json", tmp_path / "missing.json"])
    assert {"test": "money [FE-01/AC1] formats lakh", "ticket": "FE-01", "acs": ["AC1"], "outcome": "passed"} in res
    pw = [r for r in res if r["ticket"] == "FE-31"]
    assert [(r["acs"], r["outcome"]) for r in pw] == [(["AC1", "AC2"], "passed"), (["AC1", "AC2"], "failed")]


def test_render_mentions_result():
    cs = v.parse_criteria(ISSUE)
    rows, w = v.evaluate("BE-31", cs, [_r(["AC1"])], set())
    out = v.render(
        "BE-31", {"title": "BE-31: Log payment", "number": 23}, [v.Check("ruff", True)], rows, w, False, False
    )
    assert "NOT VERIFIED" in out and "❌ no test" in out and "⏳" in out
