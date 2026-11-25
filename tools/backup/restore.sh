#!/usr/bin/env bash
# Restore an encrypted backup (BE-53 restore drill, or a real recovery).
#
#   AGE_IDENTITY_FILE=pgcrm-backup.key  RESTORE_DATABASE_URL=postgresql://...  tools/backup/restore.sh backup.dump.age
#
# Restore into an EMPTY database whose roles exist already (db/prod/roles.sql, or the local dev database's
# pgcrm_app role). Ownership is not restored: everything ends up owned by the connecting role, so connect as the
# migrator in production. Never restore over the live database; restore next to it, check, then switch.
set -euo pipefail
: "${AGE_IDENTITY_FILE:?set AGE_IDENTITY_FILE (age private key file of the owner)}"
: "${RESTORE_DATABASE_URL:?set RESTORE_DATABASE_URL (an empty database)}"
in="${1:?usage: restore.sh <backup.dump.age>}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"

# Decrypt into a private temporary folder that is always deleted, even on failure.
tmp="$(mktemp -d)"; chmod 700 "$tmp"; trap 'rm -rf "$tmp"' EXIT
age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$tmp/dump" "$in"

# Every database already has a `public` schema: skip creating it (and its comment), restore everything else.
$PG_RESTORE --list "$tmp/dump" | grep -vE '^[0-9]+; [0-9]+ [0-9]+ (SCHEMA|COMMENT) - (SCHEMA )?public ' > "$tmp/list"
$PG_RESTORE --no-owner --exit-on-error --single-transaction --use-list "$tmp/list" \
  --dbname "$RESTORE_DATABASE_URL" "$tmp/dump"
echo "restored $in"
