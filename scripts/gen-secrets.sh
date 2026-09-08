#!/usr/bin/env bash
# Genera secretos fuertes para AGENDA.GOBER.
#
#   bash scripts/gen-secrets.sh            # los muestra (para copiar donde haga falta)
#   bash scripts/gen-secrets.sh --write    # rota JWT_SECRET en .env y apps/api/.env
#
# --write solo toca JWT_SECRET: es seguro y no requiere tocar la base. Rotar
# la clave de Postgres se hace a mano (ver docs/SECRETS.md, sección Rotación).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

gen() { node -e "console.log(require('crypto').randomBytes(${1:-48}).toString('base64url'))"; }

JWT_SECRET="$(gen 48)"
POSTGRES_PASSWORD="$(gen 24)"
APP_DB_PASSWORD="$(gen 24)"

set_kv() { # archivo clave valor
  local f="$1" k="$2" v="$3"
  [ -f "$f" ] || { echo "   (no existe $f, salteado)"; return 0; }
  if grep -qE "^${k}=" "$f"; then
    sed -i.bak -E "s|^${k}=.*|${k}=${v}|" "$f" && rm -f "$f.bak"
  else
    printf '%s=%s\n' "$k" "$v" >> "$f"
  fi
  echo "   $k actualizado en $(basename "$(dirname "$f")")/$(basename "$f")"
}

if [ "${1:-}" = "--write" ]; then
  echo "== rotando JWT_SECRET (mismo valor en los dos .env)"
  set_kv "$ROOT_DIR/.env" JWT_SECRET "$JWT_SECRET"
  set_kv "$ROOT_DIR/apps/api/.env" JWT_SECRET "$JWT_SECRET"
  echo
  echo "Reiniciá la API. Los access token viejos fallan hasta 15 min y el"
  echo "frontend los renueva solo con el refresh token -> nadie se desloguea."
  echo
  echo "Claves de base sugeridas (NO se escribieron, ver docs/SECRETS.md):"
  echo "  POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
  echo "  APP_DB_PASSWORD=$APP_DB_PASSWORD"
else
  cat <<EOF
JWT_SECRET=$JWT_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
APP_DB_PASSWORD=$APP_DB_PASSWORD

  bash scripts/gen-secrets.sh --write   -> escribe JWT_SECRET en los .env
  Docker/K8s secrets                    -> guardá el valor en un archivo y usá JWT_SECRET_FILE
EOF
fi
