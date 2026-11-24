"""Write the API contract to contract/openapi.json.

The frontend generates its TypeScript types from this file:
    npx openapi-typescript ../contract/openapi.json -o src/api/schema.d.ts

Run after every API change and commit the result with the change.
    uv run python scripts/export_openapi.py          # write
    uv run python scripts/export_openapi.py --check  # exit 1 if the committed file is stale (CI)
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "contract" / "openapi.json"

if __name__ == "__main__":
    fresh = json.dumps(app.openapi(), indent=2) + "\n"
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current.replace("\r\n", "\n") != fresh:
            print("contract/openapi.json is stale: run `uv run python scripts/export_openapi.py` and commit it")
            raise SystemExit(1)
        print("contract/openapi.json is up to date")
        raise SystemExit(0)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(fresh, encoding="utf-8", newline="\n")
    print(f"wrote {OUT}")
