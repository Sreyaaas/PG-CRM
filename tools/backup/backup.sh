#!/usr/bin/env bash
# Encrypted database backup (BE-53). Used by .github/workflows/backup.yml and by hand.
#
#   BACKUP_DATABASE_URL=postgresql://pgcrm_migrator...  BACKUP_AGE_RECIPIENT=age1...  tools/backup/backup.sh [out-file]
#
# Dumps only our schemas (public, app, api), not the hosting provider's own. The dump holds resident KYC data,
# so it is encrypted with `age` to the owner's public key before it touches disk; only the owner's private key
# (kept offline) can read it. Needs pg_dump >= the server version (17): set PG_DUMP to e.g.
# "docker run --rm -i postgres:17 pg_dump" when the local one is older.
set -euo pipefail
: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL (the migrator role, session or direct connection)}"
: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT (age public key of the owner: age1...)}"
out="${1:-pgcrm-$(date -u +%Y%m%dT%H%MZ).dump.age}"
PG_DUMP="${PG_DUMP:-pg_dump}"

# Say which login and port this is (never the password), so a wrong URL is obvious in the log. The API login
# (pgcrm_api) has no rights of its own and the transaction pooler (6543) can't run pg_dump: refuse both clearly
# instead of failing later with "permission denied".
read -r db_user db_port < <(python3 -c 'import os, urllib.parse as u
p = u.urlsplit(os.environ["BACKUP_DATABASE_URL"])
print(p.username or "?", p.port or 5432)')
echo "backing up as ${db_user} on port ${db_port}"
if [[ "$db_user" == pgcrm_api* || "$db_port" == "6543" ]]; then
  echo "error: BACKUP_DATABASE_URL must be the migrator login (pgcrm_migrator) on the session pooler (port 5432)," \
    "not ${db_user} on port ${db_port}. Use the same value as MIGRATOR_DATABASE_URL." >&2
  exit 1
fi

$PG_DUMP "$BACKUP_DATABASE_URL" --format=custom --no-owner --schema=public --schema=app --schema=api \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" > "$out.partial"
mv "$out.partial" "$out"
echo "wrote $out ($(wc -c < "$out") bytes, encrypted)"
