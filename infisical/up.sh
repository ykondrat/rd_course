#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

command -v infisical >/dev/null || {
  echo "✗ infisical CLI not found. Install: npm i -g @infisical/cli" >&2
  exit 1
}
[ -f .env ] || {
  echo "✗ infisical/.env missing — copy infisical/.env.example and set ENCRYPTION_KEY + AUTH_SECRET." >&2
  exit 1
}

echo "── bringing up the self-hosted Infisical stack (backend + postgres + redis) ──"

docker compose up -d --wait

echo "── filling the store via REST API ──"
node bootstrap.mjs

echo
echo "Stand ready. Next:"
echo "  npm run infisical:run          # app with dev secrets injected from the store"
echo "  npm run infisical:run:prod     # same binary, prod values"
echo "  npm run infisical:down         # tear down + wipe .secrets/"