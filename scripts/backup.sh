#!/usr/bin/env bash
# Backup de la base AGENDA.GOBER.
#
#   bash scripts/backup.sh
#
# Deja en ./backups/ :
#   agenda_gober_<fecha>.dump         pg_dump formato custom (-Fc, comprimido)
#   agenda_gober_<fecha>.dump.sha256  checksum de integridad
#   roles_<fecha>.sql                 roles del cluster (para restaurar en uno vacío)
#
# Conserva los ultimos BACKUP_KEEP (default 14) de cada tipo.
# El backup sale por el socket unix del contenedor: no necesita TLS ni clave.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/infra/docker/docker-compose.yml"
BACKUP_DIR="$ROOT_DIR/backups"
KEEP="${BACKUP_KEEP:-14}"

[ -f "$ENV_FILE" ] || { echo "Falta .env — copia .env.example a .env." >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y-%m-%d_%H%M%S)"
DUMP="$BACKUP_DIR/agenda_gober_${TS}.dump"
ROLES="$BACKUP_DIR/roles_${TS}.sql"

echo "== respaldando '$POSTGRES_DB' -> $(basename "$DUMP")"
compose exec -T postgres pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$DUMP"

echo "== respaldando roles del cluster -> $(basename "$ROLES")"
compose exec -T postgres pg_dumpall --roles-only -U "$POSTGRES_USER" > "$ROLES"

( cd "$BACKUP_DIR" && sha256sum "$(basename "$DUMP")" > "$(basename "$DUMP").sha256" )

echo "== ok: $(du -h "$DUMP" | cut -f1)"

prune() {
  local files
  files="$(ls -1t "$BACKUP_DIR"/$1 2>/dev/null || true)"
  [ -z "$files" ] && return 0
  echo "$files" | tail -n +"$((KEEP + 1))" | while read -r old; do
    [ -n "$old" ] || continue
    echo "== podando $(basename "$old")"
    rm -f "$old"
  done
}
prune 'agenda_gober_*.dump'
prune 'agenda_gober_*.dump.sha256'
prune 'roles_*.sql'

echo
echo "Backups en $BACKUP_DIR (se conservan $KEEP):"
ls -1t "$BACKUP_DIR"/agenda_gober_*.dump | head -5
