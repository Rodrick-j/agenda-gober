# AGENDA.GOBER — API (NestJS)

Backend que conecta contra el Postgres de `../../db`. La pieza central no es
ningún controller: es `src/context/tenant-context.interceptor.ts`.

## Cómo funciona el aislamiento por secretaría aquí

Cada request HTTP:

1. `JwtAuthGuard` verifica el token y deja `req.user` (userId, rol,
   secretariaId) — ver "Autenticación" abajo.
2. El interceptor abre una transacción (`BEGIN`) y ejecuta
   `set_config('app.current_rol', ...)`, `set_config('app.current_secretaria_id', ...)`
   y `set_config('app.current_user_id', ...)` **parametrizados** (nunca
   concatenando el valor en el SQL).
3. Deja el cliente de esa transacción en un `AsyncLocalStorage` para el resto
   del request.
4. `TxService` es el único punto por el que cualquier servicio toca la base
   de datos — si algo intenta consultar sin pasar por este mecanismo,
   `getRequestContext()` lanza un error en vez de correr la query contra el
   pool "pelado" (sin el contexto seteado, lo que dejaría a las políticas
   RLS sin nada que evaluar).
5. Al terminar el request: `COMMIT` si todo salió bien, `ROLLBACK` si hubo
   una excepción. El cliente siempre se libera de vuelta al pool.

Las políticas RLS reales viven en la base de datos (`db/migrations/`), no
acá — este interceptor solo le da a Postgres el contexto que esas políticas
necesitan para decidir.

## Autenticación

`POST /auth/login` con `{ email, password }` devuelve `{ accessToken }` (JWT,
expira en 2h). El resto de rutas exige `Authorization: Bearer <token>` — lo
verifica `JwtAuthGuard` (global) y lo procesa `JwtStrategy`, que deja
`req.user = { userId, rol, secretariaId }` ya validado. El interceptor de
contexto (arriba) usa esos claims directamente, sin volver a tocar la base de
datos.

Rutas marcadas con `@Public()` (`/health`, `/auth/login`) no pasan por el
guard ni abren transacción.

`/auth/login` tiene rate-limiting: máximo 5 intentos por minuto por IP
(`@Throttle` + `ThrottlerGuard`) — cierra el hallazgo de fuerza bruta del
pentest (`../../pentest/REPORTE.md`), ahora sí en la superficie real
(usuarios finales), no en la credencial interna de Postgres.

Usuarios de prueba (contraseña `Password123!` para todos):
`salud@test.local` (secretario), `salud.director@test.local` (director),
`salud.operador@test.local` (operador), `obras@test.local` (secretario),
`gobernador@test.local` (gobernador).

## Permisos finos (rol × nivel de confidencialidad)

Esto vive en la base de datos (`db/migrations/005_permisos_finos.sql`), no en
la API — así ningún bug de NestJS puede filtrar algo que Postgres ya bloquea.

Rango por rol dentro de una secretaría: `operador(1) < director(2) <
secretario(3)`. Rango requerido por nivel: `publica`/`interna` → 1,
`reservada` → 2, `confidencial` → 3. Un rol solo ve/crea/edita filas cuyo
nivel de confidencialidad esté a su alcance (política RLS
`rol_rango(...) >= nivel_rango(...)`). Los roles transversales (gobernador,
jefe_gabinete, admin) no tienen este límite.

Máquina de estados de `publicaciones.estado`
(`fn_validar_transicion_publicacion`, trigger `BEFORE UPDATE`):

```
borrador --(cualquier rol de la secretaría)--> revision
revision --(director o secretario)-----------> aprobado
aprobado --(solo secretario)------------------> publicado
cualquier estado --(director o secretario)----> borrador   (rechazo)
```

`PATCH /publicaciones/:id/estado` con `{ "estado": "..." }` dispara la
transición; una transición inválida para tu rango responde 403 con el motivo
(lo lanza el trigger, la API solo lo traduce — ver `src/common/pg-error.util.ts`).

## Arrancar

```bash
cp .env.example .env
# completa DB_PASSWORD con el mismo valor que APP_DB_PASSWORD en ../../.env

npm install
npm run start:dev
```

Requiere que la base de datos ya esté arriba (`../../scripts/migrate.sh`).

## Probar

```bash
# Sin token -> 401
curl http://localhost:3001/publicaciones

# Login
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"salud@test.local","password":"Password123!"}' \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).accessToken))")

# Como Salud -> solo ve publicaciones de Salud
curl http://localhost:3001/publicaciones -H "Authorization: Bearer $TOKEN"

curl -X POST http://localhost:3001/publicaciones \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"titulo":"t","contenido":"c","nivelConfidencialidad":"interna"}'
```

Nota: `CreatePublicacionDto` no acepta `secretariaId` desde el cliente a
propósito — el `ValidationPipe` global (`forbidNonWhitelisted`) rechaza con
400 cualquier intento de mandarlo. La secretaría siempre sale del usuario
autenticado, nunca del body.
