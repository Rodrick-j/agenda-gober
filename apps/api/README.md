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

`POST /auth/login` con `{ email, password }` valida credenciales y devuelve
`{ user: { userId, email, rol, secretariaId } }` — el JWT en sí **no** viaja
en el body. Va en una cookie `access_token` con `httpOnly` (JavaScript, y por
lo tanto un XSS inyectado, no puede leerla), `sameSite: 'lax'` y `secure` en
producción. `GET /auth/me` devuelve el mismo `user` leyendo esa cookie — el
frontend lo usa para restaurar la sesión al recargar la página, ya que no
tiene forma de "decodificar" un token que no puede ver. `POST /auth/logout`
limpia la cookie.

`JwtAuthGuard` (global) + `JwtStrategy` siguen siendo quienes validan cada
request, solo que el extractor ahora lee `req.cookies.access_token` (vía
`cookie-parser`, montado en `main.ts`) en vez de un header `Authorization`.
`req.user = { userId, email, rol, secretariaId }` queda igual de disponible
para el interceptor de contexto (arriba).

CORS ya no está abierto: `app.enableCors({ origin: WEB_ORIGIN, credentials:
true })` — un origin `credentials: true` no puede ser `*` (el navegador
rechaza mandar cookies a un wildcard), así que `WEB_ORIGIN` fija el origen
real del frontend. El gateway de WebSocket usa el mismo criterio y lee el
JWT de la cookie del handshake (`client.handshake.headers.cookie`), no de un
payload de auth armado a mano — el cliente se conecta con
`io(url, { withCredentials: true })` y la cookie viaja sola.

Rutas marcadas con `@Public()` (`/health`, `/auth/login`, `/auth/logout`) no
pasan por el guard ni abren transacción.

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

## Documentos (adjuntos)

Adjuntos por publicación, guardados como `bytea` **dentro** de la fila
(`db/migrations/007_documentos.sql`), a propósito: así el documento hereda la
RLS de su publicación padre y no hay forma de bajarlo por una URL estática
saltándose los permisos. Para archivos grandes, migrar a object storage (R2)
manteniendo la descarga validada contra la visibilidad del padre.

- `GET  /publicaciones/:id/documentos` — metadata (nunca el binario)
- `POST /publicaciones/:id/documentos` — multipart, campo `archivo`, máx 10 MB
- `GET  /documentos/:id/descargar` — descarga autenticada (StreamableFile)
- `DELETE /documentos/:id`

La política `documentos_select/insert/delete` usa
`EXISTS (SELECT 1 FROM publicaciones p WHERE p.id = documentos.publicacion_id)`:
como `publicaciones` tiene RLS, ese `EXISTS` solo encuentra la fila si la
publicación es visible para el usuario. Verificado: Obras no ve/descarga
adjuntos de Salud (404), y un operador no descarga el adjunto de una
publicación confidencial (404) que el secretario sí baja (200). La auditoría
registra alta/baja de documentos **sin** el binario (`to_jsonb(NEW) - 'contenido'`).

## Agenda (eventos institucionales)

`db/migrations/008_eventos_agenda.sql`. Mismo criterio que publicaciones
(secretaría + rango vs. confidencialidad), más una tercera vía: ver el evento
si sos uno de sus `evento_responsables` (invitados), sin importar de qué
secretaría seas — para reuniones inter-secretariales. `secretaria_id NULL` =
evento transversal (gobernador/jefe de gabinete/admin).

- `GET /eventos?desde=&hasta=` — rango de fechas para la vista de calendario
- `GET /eventos/:id` — incluye el listado de invitados
- `POST /eventos`, `PATCH /eventos/:id`, `DELETE /eventos/:id`
- `PUT /eventos/:id/responsables` — reemplaza el set completo de invitados
  (más simple e idempotente que agregar/quitar de a uno)

Editar/cancelar exige rango `director`+ (no solo pertenecer a la secretaría),
para que un operador no pueda reprogramar una reunión por su cuenta.

**Bug real que encontré armando esto, por si sirve de referencia:** hacer que
`evento_responsables` "herede" la visibilidad de `eventos_agenda` con un
`EXISTS` directo (como documentos hereda de publicaciones) generaba
`infinite recursion detected in policy for relation "eventos_agenda"`, porque
`eventos_select` **también** consulta `evento_responsables` (para la vía de
invitado) — ciclo. Se rompe con una función `SECURITY DEFINER`
(`fn_evento_visible_para_actual`): como la crea el rol admin (superusuario en
este entorno), corre bypaseando RLS, así que consultar `eventos_agenda` desde
adentro de la política de `evento_responsables` no vuelve a disparar
`eventos_select`. Además, un invitado necesita poder ver **su propia fila**
de invitación sin pasar por esa función (si no, no hay forma de que
`eventos_select` descubra que está invitado) — por eso la política tiene esa
excepción explícita. Todo el razonamiento queda comentado en la migración.

## Tareas

`db/migrations/009_tareas.sql`. Mismo esqueleto que Agenda: secretaría +
rango vs. confidencialidad, más una vía de "asignado" (`tarea_asignados`,
igual patrón que `evento_responsables`, con el mismo fix de recursión vía
`fn_tarea_visible_para_actual` SECURITY DEFINER) para poder asignarle una
tarea a alguien de otra secretaría.

- `GET /tareas?estado=` — lista (opcionalmente filtrada por estado, para el tablero)
- `GET /tareas/:id` — incluye el listado de asignados
- `POST /tareas`, `PATCH /tareas/:id`, `DELETE /tareas/:id`
- `PUT /tareas/:id/asignados` — reemplaza el set completo de asignados

**Diferencia clave con Agenda:** en eventos, solo rango `director`+ puede
editar. En tareas, un asignado sin ese rango también puede entrar a `UPDATE`
(para poder marcar su propia tarea como en progreso/completada) — pero
`RLS` sola no puede limitar qué columnas toca esa persona, porque no compara
fila vieja vs. nueva. Por eso hay un trigger, `fn_validar_edicion_tarea`
(mismo mecanismo que `fn_validar_transicion_publicacion` en 005): si quien
edita es transversal o director+/secretario de la secretaría dueña, edita la
fila entera; si solo llegó ahí por estar asignado, el trigger revienta con
`RAISE EXCEPTION` en cuanto detecta que cambió algo más que `estado`.
Verificado con curl: un operador asignado puede pasar su tarea a
`en_progreso` (200), pero si en el mismo PATCH intenta cambiar también el
`titulo` la operación entera se rechaza con 403 — no se aplica el cambio de
estado a medias, porque es una sola transacción.

## Proyectos

`db/migrations/010_proyectos.sql`. Mismo criterio base que publicaciones
(secretaría + rango vs. confidencialidad), sin la vía de "asignado" que sí
tienen Agenda/Tareas — un proyecto pertenece a una sola secretaría. Editar
(incluye `avance_porcentaje` y `estado`) exige rango `director`+, igual que
Agenda: un operador no reprograma ni reporta avance de un proyecto por su
cuenta. Verificado con curl: un operador que intenta `PATCH` recibe 404 (RLS
filtra la fila antes de llegar al `UPDATE`, mismo comportamiento ya
documentado en Agenda/Publicaciones), el secretario de la misma secretaría sí
puede.

- `GET /proyectos?estado=`, `GET /proyectos/:id`
- `POST /proyectos`, `PATCH /proyectos/:id`, `DELETE /proyectos/:id`

Tiempo real: canal `proyectos_cambios`, mismo patrón que el resto.

## Indicadores

`GET /indicadores/resumen`. Hermano de Gabinete pero sin restricción de rol:
agrega `publicaciones`/`tareas`/`proyectos` por estado más un puñado de
totales (tasa de tareas completadas, tareas vencidas, avance promedio de
proyectos, eventos del mes). Igual que Gabinete e Indicadores, el SQL no
filtra por rol — cada quien ve sus propios números reflejados por la RLS de
siempre, así que a diferencia de Gabinete **no hace falta ser transversal**
para verlo con sentido: un secretario ve el indicador de su secretaría, un
transversal ve el agregado de todas. Sin tablas propias ni tiempo real (es
un rollup, mismo motivo que Gabinete).

## Gabinete (panel agregado)

`GET /gabinete/resumen`. Sin tablas propias: agrega `publicaciones`,
`eventos_agenda` y `tareas` (conteos por secretaría, tareas vencidas/por
vencer, próximos 7 días). Mismo criterio que `auditoria.service.ts`: el SQL
no filtra por rol — cada subquery corre bajo la RLS de siempre, así que un
secretario que le pegue a este endpoint no ve un error, ve el panel
"reflejando" solo su propia secretaría (las demás aparecen en la lista
porque `secretarias` no tiene RLS, pero sus conteos dan 0 porque las
subqueries a `publicaciones`/`tareas` de otra secretaría no le devuelven
filas). El frontend igual lo oculta del sidebar y bloquea la página para
roles no transversales, coherente con cómo ya se maneja Auditoría — no es la
barrera real, es solo para no mostrar un panel "vacío" y confuso.

Sin tiempo real acá a propósito: es un rollup (conteos y agregados), no una
fila puntual que el patrón `CANALES` de `pg-listener.service.ts` pueda
re-consultar por id. Se actualiza con el botón "Actualizar" o al volver a
entrar a la página.

## Reuniones (actas y compromisos)

`db/migrations/011_reuniones.sql`. No hay tabla "reuniones": una reunión ES
un `eventos_agenda` (008). Esto agrega su *resultado* — el acta (minuta) y
los compromisos (acuerdos con responsable y fecha) que salen de ella.

- `GET /eventos/:id/acta`, `PUT /eventos/:id/acta` (upsert, se sobreescribe)
- `GET /eventos/:id/compromisos`, `POST /eventos/:id/compromisos`
- `PATCH /compromisos/:id`, `DELETE /compromisos/:id`

Visibilidad completa (`fn_evento_visible_completo`, SECURITY DEFINER nueva —
**no** reutiliza `fn_evento_visible_para_actual` de 008 porque esa a
propósito no incluye la vía de invitado, y acá cualquier invitado sí debe
poder leer el acta): transversal, secretaría + rango vs. confidencialidad, o
invitado al evento. Editar (acta, crear/borrar compromisos) exige rango
`director`+ del evento (`fn_evento_editable_por_actual`).

**Mismo mecanismo que Tareas para compromisos:** el responsable de un
compromiso puede entrar a `UPDATE` aunque no tenga rango de director ni sea
de la secretaría dueña (para marcar su propio compromiso como cumplido), y
un trigger (`fn_validar_edicion_compromiso`, calcado de
`fn_validar_edicion_tarea`) le bloquea tocar cualquier otra columna.
Verificado con curl: el responsable puede pasar su compromiso a `cumplido`
(200), pero si en el mismo `PATCH` intenta cambiar la `descripcion` la
operación entera se rechaza con 403.

**Selector de responsable sin endpoint de "listar usuarios":** `GET
/eventos/:id` ahora también devuelve `creador` (antes solo devolvía
`responsables`) — el frontend arma el selector con ese universo pequeño y ya
visible (creador + invitados), en vez de necesitar un directorio completo de
usuarios.

**Bug real que encontré armando esto:** el trigger de auditoría genérico
(`fn_auditoria_publicaciones`, 001) usa `COALESCE(NEW.id, OLD.id)` — pero
`reunion_actas` no tiene columna `id` (su PK es `evento_id`), así que
cualquier `INSERT`/`UPDATE` fallaba con `record "new" has no field "id"`.
Se resolvió con una función de auditoría dedicada
(`fn_auditoria_reunion_actas`) que usa `evento_id` en su lugar — el resto de
tablas de este proyecto sí tienen `id`, por eso no había aparecido antes.

Tiempo real solo para compromisos (canal `compromisos_cambios`) — el acta es
un documento largo que se edita de a ratos, no una fila puntual que valga la
pena empujar en vivo.

## Tiempo real

WebSocket (`socket.io`) en el mismo puerto. El cliente se conecta con
`io(url, { auth: { token: accessToken } })` — sin token válido, se
desconecta al toque (`RealtimeGateway.handleConnection`).

Cuando cambia una fila de `publicaciones` o `eventos_agenda` (INSERT/UPDATE),
un trigger hace `pg_notify(canal, { id, accion })` — nunca contenido
(`006_notify_publicaciones.sql`, `008_eventos_agenda.sql`). `PgListenerService`
mantiene una conexión propia con `LISTEN` en ambos canales (no puede usar el
pool: necesita una conexión de larga duración) y, por cada socket conectado,
vuelve a consultar esa fila **con el contexto de sesión de ese usuario**
(`set_config` igual que en HTTP). Si RLS la bloquea, no llega nada — el
filtro de tiempo real es la misma política que ya existe, no una copia en
TypeScript que se pueda desincronizar. Agregar un módulo nuevo con tiempo
real es sumar una entrada al mapa `CANALES` de `pg-listener.service.ts`, no
tocar el resto de la clase.

**DELETE es un caso aparte:** la fila ya no existe, así que no hay nada que
re-consultar bajo RLS para decidir a quién le llega. Para ese caso se avisa
el `id` "pelado" (sin contenido) a **todos** los sockets conectados — no
revela nada sensible, solo que ese id dejó de existir — y cada cliente lo
saca de su vista si lo tenía cargado.

Eventos emitidos: `publicacion:cambio`, `evento:cambio`, `tarea:cambio`,
`proyecto:cambio` y `compromiso:cambio`, todos con la forma
`{ accion, <clave>?, id? }` (el objeto de datos solo viene en INSERT/UPDATE;
en DELETE solo viene `id`).

Pruebas manuales:

```bash
npm run start   # en una terminal
node test-realtime.manual.js             # publicaciones: secretaría + confidencialidad
node test-realtime-eventos.manual.js     # eventos: creación y borrado (aviso sin contenido)
node test-realtime-tareas.manual.js      # tareas: creación y borrado, aislado por secretaría
node test-realtime-proyectos.manual.js   # proyectos: creación, avance y borrado
node test-realtime-compromisos.manual.js # compromisos: creación y cambio de estado
```

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
