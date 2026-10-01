#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${DATABASE_URL:?DATABASE_URL is required — export it or run through scripts/with-secrets.sh}"

BACKUP_DIR="$(pwd)/backups"
mkdir -p "$BACKUP_DIR"

OUT="$BACKUP_DIR/appdb-$(date +%Y-%m-%d_%H%M%S).dump"

echo "=== pg_dump -Fc appdb (through PgBouncer) ==="

pg_dump "$DATABASE_URL" -Fc -f "$OUT"

echo "  size: $(du -h "$OUT" | cut -f1)  ->  $OUT"

echo "=== TOC — proof this is a valid -Fc archive ==="

pg_restore --list "$OUT"
