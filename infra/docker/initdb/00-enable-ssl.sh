#!/bin/bash
set -euo pipefail

# Se ejecuta una sola vez, durante la inicializacion del cluster (initdb),
# como script de arranque oficial de la imagen de Postgres.

openssl req -new -x509 -days 3650 -nodes -text \
  -subj "/CN=agenda-gober-local" \
  -keyout "$PGDATA/server.key" \
  -out "$PGDATA/server.crt"
chmod 600 "$PGDATA/server.key"

cat >> "$PGDATA/postgresql.conf" <<'EOF'

# TLS obligatorio (agregado por infra/docker/initdb/00-enable-ssl.sh)
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
EOF

cat > "$PGDATA/pg_hba.conf" <<'EOF'
# Generado por infra/docker/initdb/00-enable-ssl.sh
# El socket unix (solo alcanzable desde dentro del propio contenedor) no exige TLS.
local   all             all                                     trust
# Toda conexion por red exige TLS: no hay ninguna regla "host" (sin ssl) definida.
hostssl all             all             0.0.0.0/0               scram-sha-256
hostssl all             all             ::0/0                   scram-sha-256
EOF
