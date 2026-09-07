#!/usr/bin/env bash
set -euo pipefail

ROLE="app_user"
DB="${PGDATABASE:-appdb}"
SECRET_FILE="secrets/db_password"
NEW_PASSWORD="app-$(openssl rand -hex 12)"

echo "Rotating password for role '$ROLE' (as admin)..."

docker compose exec -T postgres \
  psql -U admin -d "$DB" -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE $ROLE WITH PASSWORD '$NEW_PASSWORD';" >/dev/null

printf '%s' "$NEW_PASSWORD" > "$SECRET_FILE"
echo "Updated $SECRET_FILE."

echo -n "Terminated backends: "
docker compose exec -T postgres \
  psql -U admin -d "$DB" -tA -v ON_ERROR_STOP=1 \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = '$ROLE';"

echo "Rotation complete. The API keeps running; new DB connections use the new password."