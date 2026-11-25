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

$PG_DUMP "$BACKUP_DATABASE_URL" --format=custom --no-owner --schema=public --schema=app --schema=api \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" > "$out.partial"
mv "$out.partial" "$out"
echo "wrote $out ($(wc -c < "$out") bytes, encrypted)"
