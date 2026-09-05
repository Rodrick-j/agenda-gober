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

for file in "$ROOT_DIR"/db/seeds/*.sql; do
  echo "== cargando seed: $(basename "$file")"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < "$file"
done

echo "Seeds cargados."
