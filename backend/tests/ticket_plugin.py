"""Link tests to ticket acceptance criteria.

Usage in a test:

    @pytest.mark.ac("BE-31", "AC1", "AC3")
    def test_duplicate_utr_is_409(): ...

`pytest --ac-report=../.verify/pytest.json` writes one record per tagged test, which
`tools/verify_ticket.py` turns into a per-criterion pass/fail report.
"""

import json
import re
from pathlib import Path

import pytest

_TICKET = re.compile(r"^(BE|FE)-\d+$")
_AC = re.compile(r"^AC\d+$")


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--ac-report", default=None, help="write acceptance-criteria test results (JSON) to this path")


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "ac(ticket, *criteria): test proves these acceptance criteria of a ticket")
    config._ac_results = {}  # type: ignore[attr-defined]


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        for mark in item.iter_markers("ac"):
            ticket, *acs = mark.args
            if not _TICKET.match(str(ticket)) or not acs or not all(_AC.match(str(a)) for a in acs):
                raise pytest.UsageError(f'{item.nodeid}: use @pytest.mark.ac("BE-31", "AC1", ...), got {mark.args!r}')


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo):  # noqa: ARG001
    outcome = yield
    report = outcome.get_result()
    marks = list(item.iter_markers("ac"))
    if not marks:
        return
    results = item.config._ac_results  # type: ignore[attr-defined]
    prev = results.get(item.nodeid, "passed")
    if report.failed:
        state = "failed"
    elif report.skipped:
        state = "skipped" if prev == "passed" else prev
    else:
        state = prev
    results[item.nodeid] = state
    item._ac_marks = [(m.args[0], list(m.args[1:])) for m in marks]  # type: ignore[attr-defined]


def pytest_sessionfinish(session: pytest.Session) -> None:
    path = session.config.getoption("--ac-report")
    if not path:
        return
    records = []
    for item in session.items:
        state = session.config._ac_results.get(item.nodeid)  # type: ignore[attr-defined]
        for ticket, acs in getattr(item, "_ac_marks", []):
            records.append({"test": item.nodeid, "ticket": ticket, "acs": acs, "outcome": state or "not_run"})
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"tool": "pytest", "results": records}, indent=1), encoding="utf-8")
