#!/usr/bin/env python3
"""Verify that a ticket's acceptance criteria are actually met.

    python tools/verify_ticket.py BE-31                  # run checks + tests, report per criterion
    python tools/verify_ticket.py FE-21 --no-run         # only read existing results in .verify/
    python tools/verify_ticket.py BE-31 --pr-body-file pr.md --report out.md   # CI mode

How it works
  1. Reads the ticket's GitHub issue (title starts with "BE-31:") and its acceptance criteria, written as
     `- [ ] **AC1** ...`. Criteria containing `[manual]` need a person to confirm them.
  2. Runs the quality gates for the ticket's track (backend: ruff, pytest, contract freshness; frontend:
     typecheck, build, unit + e2e tests). Any failing gate fails the ticket, including unrelated test
     failures (regressions).
  3. Collects which tests prove which criterion:
       backend  -> @pytest.mark.ac("BE-31", "AC1", "AC2")        (.verify/pytest.json)
       frontend -> test title contains "[FE-21/AC1,AC3]"          (.verify/vitest.json, .verify/playwright.json)
  4. A criterion passes only if at least one tagged test exists and every tagged test passed.
     A manual criterion passes when the PR description has it ticked: `- [x] AC4 ...`.

Exit code 0 = verified. Standard library only (plus the `gh`, `uv` and `npm` CLIs).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERIFY_DIR = ROOT / ".verify"
DEFAULT_REPO = "Sreyaaas/PG-CRM"

TICKET_RE = re.compile(r"^(BE|FE)-\d+$")
AC_LINE = re.compile(r"^\s*[-*]\s*\[[ xX]\]\s*\*\*(AC\d+)\*\*\s*(.*)$")
TITLE_TAG = re.compile(r"\[((?:BE|FE)-\d+)/(AC\d+(?:\s*,\s*AC\d+)*)\]")
SIGNOFF = re.compile(r"^\s*[-*]\s*\[[xX]\].*?\b(AC\d+)\b")
MANUAL = "[manual]"

PASS, FAIL, NO_TEST, MANUAL_OK, MANUAL_PENDING = "pass", "fail", "no_test", "manual_ok", "manual_pending"
ICON = {
    PASS: "✅ proven by tests",
    FAIL: "❌ test failing",
    NO_TEST: "❌ no test",
    MANUAL_OK: "✅ confirmed in PR",
    MANUAL_PENDING: "⏳ needs manual sign-off",
}


@dataclass
class Criterion:
    id: str
    text: str
    manual: bool


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Row:
    criterion: Criterion
    status: str
    evidence: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- parsing


def parse_criteria(issue_body: str) -> list[Criterion]:
    seen: dict[str, Criterion] = {}
    for line in issue_body.splitlines():
        m = AC_LINE.match(line)
        if m and m.group(1) not in seen:
            text = m.group(2).strip()
            seen[m.group(1)] = Criterion(m.group(1), text.replace(MANUAL, "").strip(), MANUAL in text)
    return list(seen.values())


def parse_signoffs(pr_body: str) -> set[str]:
    return {m.group(1) for line in pr_body.splitlines() if (m := SIGNOFF.match(line))}


def _tags(title: str) -> list[tuple[str, list[str]]]:
    return [(m.group(1), [a.strip() for a in m.group(2).split(",")]) for m in TITLE_TAG.finditer(title)]


def _from_pytest(data: dict) -> list[dict]:
    return list(data.get("results", []))


def _from_vitest(data: dict) -> list[dict]:
    out = []
    for file in data.get("testResults", []):
        for t in file.get("assertionResults", []):
            name = t.get("fullName") or t.get("title", "")
            status = {"passed": "passed", "failed": "failed"}.get(t.get("status"), "skipped")
            out += [{"test": name, "ticket": tk, "acs": acs, "outcome": status} for tk, acs in _tags(name)]
    return out


def _from_playwright(data: dict) -> list[dict]:
    out: list[dict] = []

    def walk(suite: dict, prefix: str) -> None:
        title = f"{prefix} {suite.get('title', '')}".strip()
        for spec in suite.get("specs", []):
            full = f"{title} {spec.get('title', '')}".strip()
            tests = spec.get("tests", [])
            if tests and all(t.get("status") == "skipped" for t in tests):
                status = "skipped"
            else:
                status = "passed" if spec.get("ok") else "failed"
            out.extend({"test": full, "ticket": tk, "acs": acs, "outcome": status} for tk, acs in _tags(full))
        for child in suite.get("suites", []):
            walk(child, title)

    for s in data.get("suites", []):
        walk(s, "")
    return out


def load_results(paths: list[Path]) -> list[dict]:
    results: list[dict] = []
    for p in paths:
        if not p.exists():
            continue
        data = json.loads(p.read_text(encoding="utf-8"))
        if data.get("tool") == "pytest":
            results += _from_pytest(data)
        elif "testResults" in data:
            results += _from_vitest(data)
        elif "suites" in data:
            results += _from_playwright(data)
    return results


# --------------------------------------------------------------------------- evaluation


def evaluate(
    ticket: str, criteria: list[Criterion], results: list[dict], signoffs: set[str]
) -> tuple[list[Row], list[str]]:
    by_ac: dict[str, list[dict]] = {}
    known = {c.id for c in criteria}
    warnings = []
    for r in results:
        if r["ticket"] != ticket:
            continue
        for ac in r["acs"]:
            if ac not in known:
                warnings.append(f"`{r['test']}` is tagged {ticket}/{ac}, but the issue has no {ac}")
            by_ac.setdefault(ac, []).append(r)

    rows = []
    for c in criteria:
        tests = by_ac.get(c.id, [])
        evidence = [f"{t['test']} ({t['outcome']})" for t in tests]
        if c.manual and not tests:
            rows.append(Row(c, MANUAL_OK if c.id in signoffs else MANUAL_PENDING, evidence))
        elif not tests:
            rows.append(Row(c, NO_TEST, evidence))
        elif all(t["outcome"] == "passed" for t in tests):
            rows.append(Row(c, PASS, evidence))
        else:
            rows.append(Row(c, FAIL, evidence))
    return rows, warnings


def verdict(checks: list[Check], rows: list[Row], strict_manual: bool) -> bool:
    bad = {FAIL, NO_TEST} | ({MANUAL_PENDING} if strict_manual else set())
    return all(c.ok for c in checks) and bool(rows) and not any(r.status in bad for r in rows)


def render(
    ticket: str, issue: dict, checks: list[Check], rows: list[Row], warnings: list[str], ok: bool, strict_manual: bool
) -> str:
    lines = [f"## Verification: {issue['title']} (#{issue['number']})", ""]
    if checks:
        lines += ["| Quality gate | Result |", "|---|---|"]
        lines += [f"| {c.name} | {'✅' if c.ok else '❌ ' + c.detail} |" for c in checks]
        lines.append("")
    if not rows:
        lines += ["❌ The issue has no numbered acceptance criteria (`- [ ] **AC1** ...`).", ""]
    else:
        lines += ["| AC | Criterion | Status | Evidence |", "|---|---|---|---|"]
        for r in rows:
            text = r.criterion.text if len(r.criterion.text) <= 110 else r.criterion.text[:107] + "..."
            ev = "<br>".join(f"`{e}`" for e in r.evidence) or "—"
            lines.append(f"| {r.criterion.id} | {text.replace('|', '/')} | {ICON[r.status]} | {ev} |")
        lines.append("")
    for w in warnings:
        lines.append(f"> ⚠️ {w}")
    pending = [r.criterion.id for r in rows if r.status == MANUAL_PENDING]
    if pending:
        how = "tick them in the PR description" if strict_manual else "tick them in the PR description when you open it"
        lines.append(f"> 👤 Manual criteria {', '.join(pending)}: check them yourself, then {how} (`- [x] ACn`).")
    lines += ["", f"**Result: {'✅ VERIFIED' if ok else '❌ NOT VERIFIED'}**"]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- running checks


def _run(name: str, cmd: list[str], cwd: Path) -> Check:
    exe = shutil.which(cmd[0])
    if exe is None:
        return Check(name, False, f"`{cmd[0]}` not installed")
    proc = subprocess.run([exe, *cmd[1:]], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode == 0:
        return Check(name, True)
    tail = (proc.stdout + proc.stderr).strip().splitlines()[-3:]
    print(f"\n--- {name} failed ---\n" + (proc.stdout + proc.stderr)[-4000:], file=sys.stderr)
    return Check(name, False, " / ".join(t.strip() for t in tail)[:200].replace("|", "/"))


def run_gates(track: str) -> list[Check]:
    VERIFY_DIR.mkdir(exist_ok=True)
    for f in ("pytest.json", "vitest.json", "playwright.json"):
        (VERIFY_DIR / f).unlink(missing_ok=True)  # never report stale results
    be, fe = ROOT / "backend", ROOT / "frontend"
    checks = []
    if track == "BE":
        checks += [
            _run("ruff lint", ["uv", "run", "ruff", "check", "."], be),
            _run("ruff format", ["uv", "run", "ruff", "format", "--check", "."], be),
            _run("all backend tests pass", ["uv", "run", "pytest", f"--ac-report={VERIFY_DIR / 'pytest.json'}"], be),
            _run(
                "contract/openapi.json up to date", ["uv", "run", "python", "scripts/export_openapi.py", "--check"], be
            ),
        ]
    else:
        pkg = fe / "package.json"
        if not pkg.exists():
            return [Check("frontend exists", False, "frontend/ is not scaffolded yet (FE-00)")]
        scripts = json.loads(pkg.read_text(encoding="utf-8")).get("scripts", {})
        for script, name in (
            ("gen:api", "types generated from contract"),
            ("typecheck", "typecheck"),
            ("lint", "lint"),
            ("build", "build"),
            ("test:unit", "unit tests"),
            ("test:e2e", "e2e tests (mobile)"),
        ):
            if script in scripts:
                checks.append(_run(name, ["npm", "run", script], fe))
            elif script in ("typecheck", "build", "test:unit"):
                checks.append(Check(name, False, f"missing npm script `{script}` (see FE-00)"))
    return checks


def fetch_issue(ticket: str, repo: str) -> dict:
    out = subprocess.run(
        [
            "gh",
            "issue",
            "list",
            "--repo",
            repo,
            "--state",
            "all",
            "--search",
            f'"{ticket}:" in:title',
            "--json",
            "number,title,body",
            "--limit",
            "20",
        ],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout
    for issue in json.loads(out):
        if issue["title"].startswith(f"{ticket}:"):
            return issue
    raise SystemExit(f"No issue titled '{ticket}: ...' in {repo}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ticket", help="e.g. BE-31 or FE-21")
    ap.add_argument("--repo", default=DEFAULT_REPO)
    ap.add_argument("--issue-body-file", type=Path, help="use this file instead of fetching the issue")
    ap.add_argument("--pr-body-file", type=Path, help="PR description; enables strict manual sign-off")
    ap.add_argument("--no-run", action="store_true", help="don't run gates; read existing .verify/*.json")
    ap.add_argument("--results", type=Path, nargs="*", default=[], help="extra result files")
    ap.add_argument("--report", type=Path, help="also write the markdown report here")
    args = ap.parse_args(argv)

    ticket = args.ticket.upper()
    if not TICKET_RE.match(ticket):
        raise SystemExit("ticket must look like BE-31 or FE-21")

    if args.issue_body_file:
        issue = {"number": "?", "title": ticket, "body": args.issue_body_file.read_text(encoding="utf-8")}
    else:
        issue = fetch_issue(ticket, args.repo)
    criteria = parse_criteria(issue["body"])
    checks = [] if args.no_run else run_gates(ticket[:2])
    results = load_results([VERIFY_DIR / f for f in ("pytest.json", "vitest.json", "playwright.json")] + args.results)
    strict = args.pr_body_file is not None
    signoffs = parse_signoffs(args.pr_body_file.read_text(encoding="utf-8")) if strict else set()
    rows, warnings = evaluate(ticket, criteria, results, signoffs)
    ok = verdict(checks, rows, strict)
    report = render(ticket, issue, checks, rows, warnings, ok, strict)
    sys.stdout.buffer.write(report.encode("utf-8"))
    if args.report:
        args.report.write_text(report, encoding="utf-8")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
