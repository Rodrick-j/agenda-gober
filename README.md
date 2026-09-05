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

## Conectarte con un cliente (DBeaver, pgAdmin, psql)

Como superusuario (administración, DDL):
- host: `localhost`, puerto: el de `POSTGRES_PORT` en tu `.env`
- usuario/clave: `POSTGRES_USER` / `POSTGRES_PASSWORD`

Como la aplicación (para probar que RLS funciona de verdad):
- usuario/clave: `APP_DB_USER` / `APP_DB_PASSWORD`

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

## Próximo paso

Con esto ya puedes atacar el contenedor con Kali (nmap, sqlmap, revisar que el
puerto 5432 no quede expuesto fuera de localhost, probar cambiar
`app.current_secretaria_id` por fuera de lo permitido) antes de conectar el
backend en NestJS.
