#!/usr/bin/env bash
# Migraciones corriendo POR RED (host=postgres), no con `docker compose exec`.
# Misma lógica que scripts/migrate.sh pero pensada para el compose de stack
# completo: se ejecuta una vez, la API espera a que termine OK.
set -euo pipefail

export PGPASSWORD="$POSTGRES_PASSWORD"
PSQL=(psql -v ON_ERROR_STOP=1 -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" -U "$POSTGRES_USER" -d "$POSTGRES_DB")

echo "== esperando a Postgres..."
until "${PSQL[@]}" -c 'SELECT 1' >/dev/null 2>&1; do sleep 1; done

"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());" >/dev/null

role_exists="$("${PSQL[@]}" -tA -c "SELECT 1 FROM pg_roles WHERE rolname = '$APP_DB_USER';")"
if [ "$role_exists" != "1" ]; then
  echo "== creando rol de aplicación: $APP_DB_USER"
  "${PSQL[@]}" -v app_user_name="$APP_DB_USER" -v app_user_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE :"app_user_name" WITH LOGIN PASSWORD :'app_user_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
SQL
else
  echo "== rol de aplicación ya existe: $APP_DB_USER"
fi

for file in /migrations/*.sql; do
  version="$(basename "$file")"
  applied="$("${PSQL[@]}" -tA -c "SELECT 1 FROM schema_migrations WHERE version = '$version';")"
  if [ "$applied" = "1" ]; then
    echo "== ya aplicada: $version"
    continue
  fi
  echo "== aplicando: $version"
  "${PSQL[@]}" -v app_user_name="$APP_DB_USER" -v app_user_password="$APP_DB_PASSWORD" -f "$file"
  "${PSQL[@]}" -c "INSERT INTO schema_migrations (version) VALUES ('$version');" >/dev/null
done

if [ "${RUN_SEEDS:-false}" = "true" ]; then
  for file in /seeds/*.sql; do
    [ -e "$file" ] || continue
    echo "== cargando seed: $(basename "$file")"
    "${PSQL[@]}" -f "$file"
  done
fi

echo "Migraciones al día."
