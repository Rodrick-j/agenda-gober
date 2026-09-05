#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/infra/docker/docker-compose.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Falta .env — copia .env.example a .env y completa los valores." >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

run_psql() {
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}

run_psql -c "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());" >/dev/null

# El rol de aplicación se crea aparte (no como migración numerada). Nota: psql
# solo interpola variables (:'var') cuando el SQL llega por stdin, no con -c.
role_exists="$(run_psql -tA -c "SELECT 1 FROM pg_roles WHERE rolname = '$APP_DB_USER';")"
if [ "$role_exists" != "1" ]; then
  echo "== creando rol de aplicación: $APP_DB_USER"
  run_psql -v app_user_name="$APP_DB_USER" -v app_user_password="$APP_DB_PASSWORD" -f - <<'SQL'
CREATE ROLE :"app_user_name" WITH LOGIN PASSWORD :'app_user_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
SQL
else
  echo "== rol de aplicación ya existe: $APP_DB_USER"
fi

for file in "$ROOT_DIR"/db/migrations/*.sql; do
  version="$(basename "$file")"
  applied="$(run_psql -tA -c "SELECT 1 FROM schema_migrations WHERE version = '$version';")"
  if [ "$applied" = "1" ]; then
    echo "== ya aplicada: $version"
    continue
  fi
  echo "== aplicando: $version"
  run_psql -v app_user_name="$APP_DB_USER" -v app_user_password="$APP_DB_PASSWORD" -f - < "$file"
  run_psql -c "INSERT INTO schema_migrations (version) VALUES ('$version');" >/dev/null
done

echo "Migraciones al día."
