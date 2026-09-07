#!/usr/bin/env bash
# Restaura un backup y VERIFICA que quedó bien.
#
#   bash scripts/restore.sh                      # el mas reciente -> base de prueba
#   bash scripts/restore.sh latest
#   bash scripts/restore.sh backups/agenda_gober_2026-09-06_....dump
#   bash scripts/restore.sh latest --into-main   # ENCIMA de la base real (pide confirmacion)
#
# Sin --into-main restaura en RESTORE_DB (default agenda_gober_restore_test),
# corre unas consultas de control e informa. La base real no se toca.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/infra/docker/docker-compose.yml"
BACKUP_DIR="$ROOT_DIR/backups"

[ -f "$ENV_FILE" ] || { echo "Falta .env" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a
compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

SRC="${1:-latest}"
INTO_MAIN=false
[ "${2:-}" = "--into-main" ] && INTO_MAIN=true

if [ "$SRC" = "latest" ]; then
  SRC="$(ls -1t "$BACKUP_DIR"/agenda_gober_*.dump 2>/dev/null | head -1 || true)"
  [ -n "$SRC" ] || { echo "No hay backups en $BACKUP_DIR — corré scripts/backup.sh primero." >&2; exit 1; }
fi
[ -f "$SRC" ] || { echo "No existe: $SRC" >&2; exit 1; }
echo "== fuente: $(basename "$SRC")"

if [ -f "$SRC.sha256" ]; then
  ( cd "$(dirname "$SRC")" && sha256sum -c "$(basename "$SRC").sha256" ) \
    || { echo "!! El checksum NO coincide: el backup está corrupto." >&2; exit 1; }
fi

if $INTO_MAIN; then
  TARGET="$POSTGRES_DB"
  echo
  echo "!! Vas a RESTAURAR ENCIMA de '$TARGET'. Se pierde su contenido actual."
  read -r -p "   Escribí 'restaurar' para continuar: " ans
  [ "$ans" = "restaurar" ] || { echo "Cancelado."; exit 1; }
else
  TARGET="${RESTORE_DB:-agenda_gober_restore_test}"
fi

echo "== recreando base '$TARGET'"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS \"$TARGET\" WITH (FORCE);" \
  -c "CREATE DATABASE \"$TARGET\" OWNER \"$POSTGRES_USER\";"

echo "== restaurando ($(du -h "$SRC" | cut -f1))"
compose exec -T postgres pg_restore --no-owner --exit-on-error \
  -U "$POSTGRES_USER" -d "$TARGET" < "$SRC"

echo "== verificando contenido"
compose exec -T postgres psql -tA -U "$POSTGRES_USER" -d "$TARGET" <<'SQL'
SELECT 'migraciones aplicadas : ' || count(*) FROM schema_migrations;
SELECT 'ultima migracion      : ' || coalesce(max(version), '(ninguna)') FROM schema_migrations;
SELECT 'secretarias           : ' || count(*) FROM secretarias;
SELECT 'usuarios              : ' || count(*) FROM usuarios;
SELECT 'publicaciones         : ' || count(*) FROM publicaciones;
SELECT 'instrucciones         : ' || count(*) FROM instrucciones;
SELECT 'auditoria (filas)     : ' || count(*) FROM auditoria;
SQL

echo
echo "RESTORE OK -> base '$TARGET'"
$INTO_MAIN || echo "(prueba: la base real '$POSTGRES_DB' no se tocó; borrá '$TARGET' cuando quieras)"
