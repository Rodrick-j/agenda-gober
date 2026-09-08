# Gestión de secretos

Estado: **archivos `.env` + validación al arranque + convención `_FILE`**.
Suficiente para producción chica en Docker; el paso siguiente es un gestor
dedicado (ver "Roadmap").

## Dónde viven

| Secreto | Lo lee | Archivo |
|---|---|---|
| `JWT_SECRET` | API (firma/valida el access token) | `apps/api/.env` **y** `.env` raíz — **el mismo valor en los dos** (la API lee `apps/api/.env`, el `docker-compose` lee `.env`) |
| `POSTGRES_PASSWORD` | superusuario de Postgres, migraciones, backups | `.env` raíz |
| `APP_DB_PASSWORD` / `DB_PASSWORD` | rol `app_user` que usa la API | `.env` raíz (`APP_DB_PASSWORD`) y `apps/api/.env` (`DB_PASSWORD`) — mismo valor |
| `SENTRY_DSN` | observabilidad (opcional) | ídem |

`.env`, `apps/api/.env` y `secrets/` están en `.gitignore`. **Nunca** se commitean.

## Validación al arrancar

`apps/api/src/config/secretos.ts` corre en `ConfigModule.forRoot({ validate })`:

- `JWT_SECRET` ausente, de ejemplo (`changeme…`) o de menos de 32 caracteres →
  **la API no arranca** (en dev: advierte y arranca).
- Con `NODE_ENV=production`, una clave de base de ejemplo también **aborta**.

Así no se puede desplegar con `changeme`.

## Generar

```bash
bash scripts/gen-secrets.sh            # muestra secretos fuertes
bash scripts/gen-secrets.sh --write    # rota JWT_SECRET en los dos .env
```

`--write` sólo toca `JWT_SECRET` (seguro, no requiere tocar la base).

## Convención `_FILE` (Docker / K8s secrets)

Para que el secreto **no** quede en `environment:` (visible en `docker inspect`
y en el listado de procesos), la API acepta `JWT_SECRET_FILE`,
`DB_PASSWORD_FILE`, etc.: si están, se lee el **contenido del archivo**.

Ejemplo con `docker compose` (recomendado en producción):

```yaml
services:
  api:
    environment:
      JWT_SECRET_FILE: /run/secrets/jwt_secret
    secrets:
      - jwt_secret

secrets:
  jwt_secret:
    file: ./secrets/jwt_secret.txt   # generá el archivo con gen-secrets.sh
```

## Rotación

### `JWT_SECRET` — impacto casi nulo

1. `bash scripts/gen-secrets.sh --write`
2. Reiniciar la API.

Los access token viejos fallan hasta 15 min; el frontend llama solo a
`/auth/refresh` (el refresh token vive en la tabla `sesiones`, no está firmado
con `JWT_SECRET`) y sigue. **Nadie se desloguea.**

### Clave de Postgres (`app_user`)

1. Elegí una nueva (`scripts/gen-secrets.sh` la sugiere).
2. `ALTER ROLE app_user WITH PASSWORD 'nueva';` en la base.
3. Poné el nuevo valor en `APP_DB_PASSWORD` (`.env`) y `DB_PASSWORD` (`apps/api/.env`).
4. Reiniciá la API. (Hay un corte de segundos hasta el reinicio.)

## Roadmap

1. **Ahora:** `.env` + validación + `_FILE`.
2. **Docker secrets** (`secrets:` en el compose) — quita los valores de `environment:`.
3. **Gestor dedicado** cuando crezca la infra: Infisical / HashiCorp Vault /
   AWS Secrets Manager / GCP Secret Manager, inyectando por `_FILE` o por
   sidecar. El código ya no cambia: sólo de dónde sale el archivo.
