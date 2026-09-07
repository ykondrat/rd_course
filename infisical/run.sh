#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CREDS="$HERE/.secrets/machine-identity.env"

if [ ! -f "$CREDS" ]; then
  echo "✗ No $CREDS — bring up the store first: npm run infisical:up" >&2
  exit 1
fi

set -a; . "$CREDS"; set +a

ENV_SLUG="${1:-dev}"
shift || true
[ "$#" -gt 0 ] || set -- npm run start

TOKEN_CACHE="$HERE/.secrets/machine-token"

if [ -f "$TOKEN_CACHE" ] && [ -n "$(find "$TOKEN_CACHE" -mmin -60 2>/dev/null)" ]; then
  INFISICAL_TOKEN="$(cat "$TOKEN_CACHE")"
else
  INFISICAL_TOKEN="$(infisical login --method=universal-auth \
    --client-id="$INFISICAL_CLIENT_ID" \
    --client-secret="$INFISICAL_CLIENT_SECRET" \
    --domain="$INFISICAL_URL" --silent --plain)"
  (umask 077; printf '%s' "$INFISICAL_TOKEN" > "$TOKEN_CACHE")
fi
export INFISICAL_TOKEN

unset INFISICAL_CLIENT_ID INFISICAL_CLIENT_SECRET

exec infisical run \
  --domain="$INFISICAL_URL" \
  --projectId="$INFISICAL_PROJECT_ID" \
  --project-config-dir="$HERE" \
  --env="$ENV_SLUG" \
  --silent \
  -- "$@"