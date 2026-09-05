# AGENDA.GOBER — Base de datos

Postgres corriendo en Docker (Linux), con el modelo de seguridad completo desde
la primera migración: roles (RBAC), aislamiento por secretaría (ABAC) y Row
Level Security real — el backend nunca se conecta como superusuario, así que
las políticas no se pueden saltar por accidente.

## Primer arranque

```bash
cp .env.example .env
# edita .env y pon tus propias contraseñas (no dejes las de ejemplo)

docker compose --env-file .env -f infra/docker/docker-compose.yml up -d
./scripts/migrate.sh
./scripts/seed.sh   # opcional: carga secretarías y roles de ejemplo
```

## Estructura

```
infra/docker/docker-compose.yml   → Postgres 16, puerto solo en localhost
db/migrations/                    → esquema versionado, se aplica en orden
db/seeds/                         → datos de ejemplo para desarrollo/demo
scripts/migrate.sh                → aplica migraciones pendientes
scripts/seed.sh                   → carga los seeds
```

## TLS obligatorio

La conexión por red exige TLS siempre (`pg_hba.conf` solo tiene reglas
`hostssl`, no `host`). Cualquier cliente externo debe conectarse con
`sslmode=require` (o `verify-full` en producción, con un certificado real en
vez del autofirmado que se genera para desarrollo). Los scripts de este
proyecto ya lo hacen automáticamente vía `PGSSLMODE=require` en el entorno
del contenedor.

## Conectarte con un cliente (DBeaver, pgAdmin, psql)

Como superusuario (administración, DDL):
- host: `localhost`, puerto: el de `POSTGRES_PORT` en tu `.env`
- usuario/clave: `POSTGRES_USER` / `POSTGRES_PASSWORD`

Como la aplicación (para probar que RLS funciona de verdad):
- usuario/clave: `APP_DB_USER` / `APP_DB_PASSWORD`

En ambos casos, en DBeaver/pgAdmin configura el modo SSL como `require`
(o el equivalente "Require" en la pestaña SSL) — la conexión sin TLS es
rechazada.

## Comprobar que el RLS realmente aisla las secretarías

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml \
  exec postgres psql -U app_user -d agenda_gober
```

Dentro de esa sesión de psql:

```sql
-- Sin haber seteado nada, no deberías ver ninguna fila (deniega por defecto):
SELECT * FROM publicaciones;

-- Simula ser un usuario de la secretaría de Salud:
SELECT set_config('app.current_rol', 'secretario', false);
SELECT set_config('app.current_secretaria_id', (SELECT id::text FROM secretarias WHERE slug = 'salud'), false);

-- Ahora solo deberías ver publicaciones de Salud, nunca de Obras o Finanzas.
SELECT * FROM publicaciones;

-- Simula ser el gobernador: debería ver todo.
SELECT set_config('app.current_rol', 'gobernador', false);
SELECT * FROM publicaciones;
```

En producción, el backend hace esto mismo con `set_config(..., true)` dentro de
la transacción de cada request (el tercer argumento `true` = `SET LOCAL`, vale
solo para esa transacción), parametrizado con el usuario autenticado — nunca
concatenando el valor directo en el SQL, y nunca a mano.

## Pentest

Este entorno ya fue atacado desde Kali (nmap, hydra, intentos de bypass de
RLS y de TLS) — ver [`pentest/REPORTE.md`](pentest/REPORTE.md) para el
detalle y cómo reproducirlo.

## Backend

El backend NestJS que implementa este patrón (`set_config` por request,
dentro de la misma transacción) vive en [`apps/api`](apps/api/README.md).
Probado en vivo: aislamiento por secretaría a través de HTTP real, rechazo
de intentos de forzar `secretariaId` desde el cliente, y 401 sin usuario
válido.
