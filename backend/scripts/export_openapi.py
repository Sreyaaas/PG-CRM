"""Write the API contract to contract/openapi.json.

The frontend generates its TypeScript types from this file:
    npx openapi-typescript ../contract/openapi.json -o src/api/schema.d.ts

Run after every API change and commit the result with the change.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "contract" / "openapi.json"

if __name__ == "__main__":
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")
