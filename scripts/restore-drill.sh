#!/usr/bin/env bash

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${DATABASE_URL:?DATABASE_URL is required — export it or run through scripts/with-secrets.sh}"

if [ -n "${EPOCHREALTIME:-}" ]; then
  now_ms() { local t="${EPOCHREALTIME/[.,]/}"; echo "${t:0:${#t}-3}"; }
else
  now_ms() { perl -MTime::HiRes -e 'printf("%.0f\n", Time::HiRes::time()*1000)'; }
fi
secs() { awk -v ms="$1" 'BEGIN { printf "%.2f", ms / 1000 }'; }

CHECKSUM="SELECT count(*) || '|' || coalesce(sum(total_cents), 0) FROM orders"

reset_restore() {
  docker compose --profile drill rm -sf restore >/dev/null 2>&1 || true
  local vol
  vol="$(docker volume ls -q -f 'label=com.docker.compose.volume=pgdata-restore' 2>/dev/null || true)"
  [ -n "$vol" ] && docker volume rm -f $vol >/dev/null 2>&1 || true
}

echo "=== 1. Latest dump ==="

DUMP="$(ls -t backups/*.dump 2>/dev/null | head -n 1 || true)"
[ -n "$DUMP" ] || { echo "  no dump in backups/ — run scripts/backup.sh first"; exit 1; }

echo "  $DUMP ($(du -h "$DUMP" | cut -f1))"

echo "=== 2. Checksum of the live DB (before) ==="

BEFORE="$(psql "$DATABASE_URL" -Atc "$CHECKSUM")"

echo "  orders before: $BEFORE  (count|sum(total_cents))"

echo "=== 3. Clean throwaway container (restore, :6433) ==="

reset_restore

docker compose --profile drill up -d --wait restore

EMPTY="$(docker compose exec -T restore psql -U admin -d appdb -Atc \
  "SELECT count(*) FROM pg_tables WHERE tablename = 'orders'")"
[ "$EMPTY" = "0" ] || { echo "  base is not empty (orders exists) — drill is meaningless"; exit 1; }
echo "  orders tables in clean base: $EMPTY (0 = empty, good)"

echo "=== 4. pg_restore + compare ==="
T0=$(now_ms)

docker compose exec -T restore pg_restore -U admin -d appdb --no-owner --no-privileges < "$DUMP"
RESTORE_MS=$(( $(now_ms) - T0 ))
AFTER="$(docker compose exec -T restore psql -U admin -d appdb -Atc "$CHECKSUM")"
echo "  orders after restore: $AFTER"

if [ "$BEFORE" = "$AFTER" ]; then
  echo "  MATCH — data came back byte-for-byte (by checksum)"
else
  echo "  MISMATCH: '$BEFORE' != '$AFTER'"
  reset_restore
  exit 1
fi

echo "=== 5. RTO / RPO ==="
echo "  restore: $(secs "$RESTORE_MS") s  (RTO of this DB ≈ bring the container up + $(secs "$RESTORE_MS") s)"
echo "  RPO of a nightly pg_dump = up to 24 h of data loss. Smaller RPO needs WAL archiving + PITR."

echo "=== 6. Tear down the drill container ==="
reset_restore
echo "  done."
