#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/infra"

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi}"
export PULUMI_SKIP_UPDATE_CHECK=true
case "$PULUMI_BACKEND_URL" in file://*) mkdir -p "${PULUMI_BACKEND_URL#file://}" ;; esac

[ -d node_modules ] || npm ci --silent

pulumi stack select dev >/dev/null 2>&1 || pulumi stack init dev --secrets-provider passphrase >/dev/null

exec pulumi "$@" --stack dev --non-interactive
