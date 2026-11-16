#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

NS=marketplace
K=(kubectl --context kind-rd-course -n "$NS")
WORK="$(mktemp -d)"
PROXY_PID=""
cleanup() { [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

"${K[@]}" rollout status deploy/api --timeout=180s >/dev/null

healthy=$("${K[@]}" get pdb api -o jsonpath='{.status.currentHealthy}')
min_available=$("${K[@]}" get pdb api -o jsonpath='{.spec.minAvailable}')
allowed_before=$("${K[@]}" get pdb api -o jsonpath='{.status.disruptionsAllowed}')
read -r -a pods <<< "$("${K[@]}" get pods -l app=api --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.metadata.name}{" "}{end}')"

kubectl --context kind-rd-course proxy --port=0 > "$WORK/proxy.log" 2>&1 &
PROXY_PID=$!
disown "$PROXY_PID"
for _ in $(seq 1 50); do grep -q 'Starting to serve' "$WORK/proxy.log" && break; sleep 0.1; done
PROXY_PORT=$(sed -nE 's/.*127\.0\.0\.1:([0-9]+).*/\1/p' "$WORK/proxy.log" | head -1)

evict() {
  curl -s -o "$WORK/evict-$1.json" -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' \
    --data "{\"apiVersion\":\"policy/v1\",\"kind\":\"Eviction\",\"metadata\":{\"name\":\"$1\",\"namespace\":\"$NS\"}}" \
    "http://127.0.0.1:$PROXY_PORT/api/v1/namespaces/$NS/pods/$1/eviction"
}

evict_1=$(evict "${pods[0]}")
evict_2=$(evict "${pods[1]}")

echo "pods=${#pods[@]}"
echo "healthy=$healthy"
echo "minAvailable=$min_available"
echo "disruptions-allowed-before=$allowed_before"
echo "evict-1=$evict_1"
echo "evict-2=$evict_2"

"${K[@]}" rollout status deploy/api --timeout=180s >/dev/null

[ "$evict_1" = "201" ] && [ "$evict_2" = "429" ]
