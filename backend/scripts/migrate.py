"""Apply db/migrations/*.sql (dbmate format) without installing dbmate.

Compatible with dbmate's `schema_migrations` table, so you can switch between
this script and `docker compose run --rm migrate` freely.

    uv run python scripts/migrate.py            # apply pending migrations
    uv run python scripts/migrate.py --status   # list applied / pending
"""

import argparse
import re
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import get_settings  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[2] / "db" / "migrations"
_UP = re.compile(r"--\s*migrate:up\s*\n(.*?)(?:--\s*migrate:down|\Z)", re.S)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--database-url", default=None)
    args = parser.parse_args()

    url = args.database_url or get_settings().database_url
    files = sorted(MIGRATIONS.glob("*.sql"))
    with psycopg.connect(url, autocommit=True, prepare_threshold=None) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version varchar(128) PRIMARY KEY)")
        applied = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
        for f in files:
            version = f.name.split("_", 1)[0]
            if args.status:
                print(f"{'applied' if version in applied else 'pending'}  {f.name}")
                continue
            if version in applied:
                continue
            match = _UP.search(f.read_text(encoding="utf-8"))
            if not match:
                print(f"!! {f.name}: no '-- migrate:up' section", file=sys.stderr)
                return 1
            with conn.transaction():
                conn.execute(match.group(1))
                conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
            print(f"applied  {f.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
