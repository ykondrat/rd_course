#!/usr/bin/env bash
set -uo pipefail
URL="$1"; DURATION="$2"; WORKERS="$3"; OUT="$4"

rm -f "$OUT" "$OUT".w* "$OUT".errors "$OUT".done
END=$(( $(date +%s) + DURATION ))

for worker in $(seq 1 "$WORKERS"); do
  (
    while [ "$(date +%s)" -lt "$END" ]; do
      code=$(curl -s -o /dev/null --max-time 2 -w '%{http_code}' "$URL" 2>/dev/null)
      exit_code=$?
      echo "${code:-000}" >> "$OUT.w$worker"
      [ "${code:-000}" = "200" ] || echo "$(date +%s) worker=$worker http=${code:-000} curl-exit=$exit_code" >> "$OUT.errors"
    done
  ) &
done
wait
cat "$OUT".w* > "$OUT" 2>/dev/null
rm -f "$OUT".w*
touch "$OUT".done
