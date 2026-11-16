#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

IMAGE="${IMAGE:-rd-course-api:prod}"
DOCKERFILE="docker/Dockerfile"
TOKEN_FILE=".npm_token"

docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "image $IMAGE not found - run npm run image:build" >&2; exit 1; }
[ -s "$TOKEN_FILE" ] || { echo "$TOKEN_FILE is missing - the build secret value is needed to search for it" >&2; exit 1; }
TOKEN="$(cat "$TOKEN_FILE")"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

stages=$(grep -ciE '^[[:space:]]*FROM[[:space:]]' "$DOCKERFILE")

if docker run --rm --entrypoint sh "$IMAGE" -c true >/dev/null 2>&1; then shell_inside=1; else shell_inside=0; fi

runtime_uid=$(docker run --rm --entrypoint /nodejs/bin/node "$IMAGE" -e 'process.stdout.write(String(process.getuid()))' 2>/dev/null)
[ -n "$runtime_uid" ] || runtime_uid=$(docker run --rm --entrypoint id "$IMAGE" -u 2>/dev/null)

in_history=$(docker history --no-trunc --format '{{.CreatedBy}}' "$IMAGE" | grep -cF -- "$TOKEN")
in_config=$(docker image inspect "$IMAGE" | grep -cF -- "$TOKEN")

docker save "$IMAGE" -o "$WORK/image.tar"
mkdir -p "$WORK/image" "$WORK/layers"
tar -xf "$WORK/image.tar" -C "$WORK/image"
index=0
while IFS= read -r blob; do
  if tar -tf "$blob" >/dev/null 2>&1; then
    index=$((index + 1))
    mkdir -p "$WORK/layers/$index"
    tar -xf "$blob" -C "$WORK/layers/$index" 2>/dev/null || true
  fi
done < <(find "$WORK/image" -type f ! -name '*.json' ! -name 'repositories' ! -name 'oci-layout')
in_layers=$(grep -rlaF -- "$TOKEN" "$WORK/image" "$WORK/layers" 2>/dev/null | wc -l | tr -d ' ')

echo "image=$IMAGE"
echo "layers-unpacked=$index"
echo "stages=$stages"
echo "shell-inside=$shell_inside"
echo "runtime-uid=$runtime_uid"
echo "token-in-history=$in_history"
echo "token-in-config=$in_config"
echo "token-in-layers=$in_layers"

[ "$stages" -ge 2 ] && [ "$shell_inside" -eq 0 ] && [ -n "$runtime_uid" ] && [ "$runtime_uid" != "0" ] \
  && [ "$in_history" -eq 0 ] && [ "$in_config" -eq 0 ] && [ "$in_layers" -eq 0 ]
