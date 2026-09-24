# Arquitectura actual y catálogo de módulos

Todo lo de este documento es **[verificado en código]** salvo donde se marque
lo contrario. Es la descripción del sistema **tal como es hoy**, no de cómo
podría mejorarse (eso vive en `05-hallazgos-y-plan-de-mejoras.md`).

## 1. Vista general

Monorepo con dos aplicaciones y una base de datos, sin backend-for-frontend ni
gateway intermedio: el navegador habla directo con la API.

```
apps/
  api/   NestJS 10 + TypeScript, sin ORM (pg / node-postgres crudo)
  web/   Next.js 16 (App Router) + React 19 + Tailwind 4
db/
  migrations/  esquema versionado a mano (26 archivos, sin tool de migración)
  seeds/       datos de ejemplo (solo secretarías + roles)
infra/
  docker/      Postgres 16.4, y dos docker-compose (solo-DB / stack completo)
```

**Por qué no hay ORM [inferencia, con evidencia fuerte]:** `pg-error.util.ts`
mapea códigos SQLSTATE de Postgres (`42501` RLS, `P0001` trigger) directo a
excepciones HTTP; cada `*.service.ts` escribe SQL parametrizado a mano. La
decisión tiene sentido con el resto de la arquitectura: la autorización vive en
políticas RLS y triggers de Postgres, no en un modelo de objetos — un ORM que
abstrajera eso obligaría a reimplementar la misma lógica dos veces o a pelear
contra el ORM para no hacerlo.

Ver el diagrama de contenedores para la vista C4:
[`diagramas/c4-contenedores.puml`](diagramas/c4-contenedores.puml).

## 2. Cómo se comunican las capas

### 2.1 Petición HTTP típica

1. El navegador hace `fetch()` con `credentials: "include"` (`apps/web/src/lib/api.ts`).
   La sesión vive en dos cookies `httpOnly`: `access_token` (JWT, 60 min) y
   `refresh_token` (opaco, 30 días, `path=/auth`).
2. `helmet()` agrega cabeceras de seguridad; `cookieParser()` decodifica las
   cookies (`apps/api/src/main.ts`).
3. `JwtAuthGuard` (global, `APP_GUARD`) verifica el JWT salvo en rutas
   `@Public()`. Si es válido, `JwtStrategy.validate()` **vuelve a consultar la
   base** (sesión viva + no revocada + usuario activo) y arma `req.user` con el
   rol/secretaría **actuales**, no los que traía el token — así una baja o un
   cambio de rol se aplican en el siguiente request, no al vencer el token.
4. `TenantContextInterceptor` (global, `APP_INTERCEPTOR`) abre una transacción
   (`BEGIN`), ejecuta `set_config('app.current_rol', ...)` /
   `..._secretaria_id` / `..._user_id` **parametrizado** y deja el cliente de
   esa transacción en un `AsyncLocalStorage`.
5. El controller llama al service; el service **nunca** toca el pool
   directamente — pasa siempre por `TxService.query()`, que lee el cliente del
   `AsyncLocalStorage`. Si algo intentara saltarse esto, `getRequestContext()`
   lanza una excepción en vez de correr la consulta contra el pool "pelado"
   (sin contexto, lo que dejaría a RLS sin nada que evaluar y denegaría todo
   silenciosamente en vez de fallar ruidoso).
6. Postgres aplica las políticas RLS de la tabla usando esas variables de
   sesión. El resultado ya viene filtrado — el service no vuelve a filtrar por
   rol/secretaría en el `WHERE`.
7. Al terminar: `COMMIT` si no hubo excepción, `ROLLBACK` si la hubo. El
   cliente siempre vuelve al pool.
8. Errores de Postgres se traducen con `mapPgError()`: `42501` (RLS) y
   `P0001` (`RAISE EXCEPTION` de un trigger) → `403 Forbidden` con el mensaje
   que ya trae la base; cualquier otro código sube tal cual y lo atrapa
   `GlobalExceptionFilter` (que además, si Sentry está activo, lo reporta).

Ver la secuencia completa en
[`diagramas/secuencia-login.puml`](diagramas/secuencia-login.puml) (para el
login en sí) y en cualquiera de los otros `secuencia-*.puml` (para un request
ya autenticado).

### 2.2 Tiempo real (WebSocket)

Una sola conexión Socket.IO por sesión de navegador
(`apps/web/src/lib/realtime-context.tsx`), autenticada con la misma cookie
`httpOnly` (`io(API_URL, { withCredentials: true })`) — no hay un token
separado para el socket.

- `RealtimeGateway.handleConnection` lee la cookie del *handshake*, verifica el
  JWT y vuelve a consultar `sesiones` (mismo criterio que `JwtStrategy`).
- Cada tabla con tiempo real dispara `pg_notify(canal, {id, accion})` desde un
  trigger — **nunca el contenido**, solo el id y si fue INSERT/UPDATE/DELETE.
- `PgListenerService` mantiene una conexión `LISTEN` propia y de larga duración
  (no puede usar el pool, que recicla clientes). Al recibir una notificación,
  por **cada socket conectado** vuelve a pedir esa fila con el contexto de
  sesión de ese usuario particular (`set_config` + `SELECT ... WHERE id = $1`).
  Si RLS bloquea la fila para ese usuario, no le llega nada.
- Esto significa que el filtro de tiempo real es **la misma política RLS**, no
  una reimplementación en TypeScript que se pueda desincronizar.
- `DELETE` es un caso aparte: la fila ya no existe, así que se avisa el `id`
  "pelado" a todos los sockets conectados (no revela contenido).

Canales activos hoy (`apps/api/src/realtime/pg-listener.service.ts`, objeto
`CANALES`): `publicaciones_cambios`, `eventos_cambios`, `tareas_cambios`,
`proyectos_cambios`, `compromisos_cambios`, `instrucciones_cambios`,
`notificaciones_cambios`. **Comunicación (`cobertura`) no tiene canal
todavía** — es el único módulo de contenido sin tiempo real, confirmado por su
ausencia en `CANALES` y en `db/migrations/026_comunicacion.sql` (no hay
`pg_notify` ahí).

### 2.3 Tareas programadas

`@nestjs/schedule` (`ScheduleModule.forRoot()` en `app.module.ts`) corre 3
"barridos" (*sweeps*) horarios/cada-10-min, cada uno con su propio
`pg_try_advisory_lock` (id numérico fijo y distinto por barrido) para que en un
despliegue con más de una instancia de la API solo una lo ejecute:

| Servicio | Frecuencia | Qué hace | Función SQL que llama |
|---|---|---|---|
| `DespachoSweepService` | cada 10 min | Recalcula instrucciones vencidas sin cerrar; SLA de acuse (recordatorio a Gabinete, luego escalamiento al Gobernador) | `fn_despacho_sweep()` |
| `PublicacionesSweepService` | cada hora | Recordatorio/escalamiento de publicaciones estancadas en revisión; recordatorio de aprobadas sin publicar | `fn_publicaciones_sweep()` |
| `VencimientosSweepService` | cada hora | Avisos de "vence pronto" / "vencida" para tareas y compromisos abiertos, con escalamiento al creador/organizador | `fn_vencimientos_sweep()` |

Los tres siguen el mismo patrón: la lógica de negocio vive **en una función
SQL `SECURITY DEFINER`** (corre bypaseando RLS, porque tiene que poder avisar a
gente que no es quien disparó el barrido); el servicio de NestJS solo la
agenda y toma el lock. Cada aviso queda marcado con una columna
`*_recordado_at` / `*_escalado_at` para no repetirse en la siguiente corrida.

### 2.4 Archivos

No hay almacenamiento de objetos externo. Los adjuntos (`documentos`,
`item_evidencias`) se guardan como `bytea` **dentro de la fila** de Postgres, a
propósito: heredan la RLS de su padre (publicación / ítem de instrucción) sin
necesitar una política propia de "quién puede bajar este archivo" — no existe
una URL estática que sirva el archivo sin pasar por la autorización de la API.
El propio comentario de la migración 007 reconoce esto como una decisión de
"primer corte": para archivos grandes, recomienda migrar a object storage
manteniendo la descarga siempre validada contra la visibilidad del padre. Tope
actual: 10 MB por archivo (`MAX_BYTES` en `documentos.controller.ts` y
`despacho.controller.ts`).

### 2.5 Caché

No hay una capa de caché (Redis, in-memory cache de aplicación, etc.). Lo más
cercano es el *rate limiting* de `@nestjs/throttler`
(`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` global, más
`@Throttle` específico en `/auth/login` — 5/min — y `/auth/refresh` — 20/min),
cuyo almacenamiento por defecto es **en memoria del propio proceso** — con más
de una instancia de la API, cada una lleva su propio conteo (ver hallazgo en
`05-hallazgos-y-plan-de-mejoras.md`).

### 2.6 Validación y autorización — dónde vive cada una

| Capa | Qué valida | Ejemplo |
|---|---|---|
| `class-validator` / `class-transformer` (DTOs) | Forma y tipo de la entrada HTTP | `@IsEmail()`, `@IsUUID('4')`, `@MaxLength()` |
| `ValidationPipe` global | Rechaza campos no declarados en el DTO (`forbidNonWhitelisted: true`) | Evita que el cliente mande `secretariaId` en `CreatePublicacionDto` para hacerse pasar por otra secretaría |
| RLS (Postgres) | Quién puede ver/crear/editar/borrar **cada fila** | Casi todo el contenido de negocio |
| Triggers `BEFORE UPDATE`/`INSERT` | Reglas que RLS no puede expresar (comparar fila vieja vs. nueva, exigir un motivo, máquina de estados) | `fn_validar_transicion_publicacion`, `fn_validar_edicion_tarea`, `fn_cobertura_sello` |
| `RolesGuard` + `@Roles()` (NestJS) | Solo en `/admin/*`, porque esas tablas no pueden tener RLS | `AdminController`, `AdminSecretariasController` |
| `rangoDeRol()` en el frontend | **Nada real** — solo evita mostrar un botón que el backend rechazaría | `apps/web/src/lib/roles.ts` |

## 3. Catálogo de módulos (backend)

Convenciones de la tabla: **Entidades** son las tablas que toca directamente
(no cuenta lo que lee de paso). **Roles autorizados** es el resumen de la
política RLS/guard más permisiva del módulo — para el detalle exacto por
operación, ver `01-proposito-alcance-roles.md` §3.1 o la migración citada.

| Módulo | Archivos principales | Rutas | Entidades | Roles autorizados (RLS real) | Tiempo real |
|---|---|---|---|---|---|
| **Auth** | `auth/auth.{controller,service}.ts`, `jwt.strategy.ts`, `jwt-auth.guard.ts` | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `GET/DELETE /auth/sesiones` | `usuarios`, `usuario_roles`, `roles`, `sesiones` (sin RLS, ver §3.2 de 01) | Público (login/refresh/logout); el resto, cualquier sesión válida | — |
| **Admin** | `admin/admin.service.ts`, `admin.controller.ts`, `admin-secretarias.controller.ts` | `GET/POST/PATCH /admin/usuarios`, `POST /admin/usuarios/:id/reset-password`, `POST/PATCH /admin/secretarias` | `usuarios`, `usuario_roles`, `secretarias` | Solo `admin` (`RolesGuard`, no RLS) | — |
| **Secretarías** | `secretarias/secretarias.{controller,service}.ts` | `GET /secretarias`, `GET /secretarias/miembros` | `secretarias` (sin RLS — catálogo público para cualquier autenticado) | Cualquier sesión válida | — |
| **Publicaciones** | `publicaciones/*`, `publicaciones-sweep.service.ts` | `GET/POST /publicaciones`, `PATCH /publicaciones/:id/estado` | `publicaciones` | Secretaría + rango vs. confidencialidad; transversal sin tope | `publicaciones_cambios` |
| **Documentos** | `documentos/*` | `GET/POST .../documentos`, `GET /documentos/:id/descargar`, `DELETE /documentos/:id` | `documentos` (bytea) | Hereda de la publicación padre | (via `publicaciones_cambios`) |
| **Agenda (Eventos)** | `eventos/*` | `GET/POST/PATCH/DELETE /eventos`, `PUT /eventos/:id/responsables` | `eventos_agenda`, `evento_responsables` | Secretaría+rango, o invitado; editar exige `director`+ | `eventos_cambios` |
| **Reuniones** | `reuniones/*`, `compromisos.controller.ts` | `GET/PUT /eventos/:id/acta`, `GET/POST /eventos/:id/compromisos`, `PATCH/DELETE /compromisos/:id` | `reunion_actas`, `compromisos` | Igual que Agenda + responsable del compromiso (solo su estado) | `compromisos_cambios` |
| **Tareas** | `tareas/*` | `GET/POST/PATCH/DELETE /tareas`, `PUT /tareas/:id/asignados` | `tareas`, `tarea_asignados` | Secretaría+rango, o asignado (solo su estado); editar completo exige `director`+ | `tareas_cambios` |
| **Proyectos** | `proyectos/*` | `GET/POST/PATCH/DELETE /proyectos` | `proyectos` | Secretaría+rango; editar exige `director`+ | `proyectos_cambios` |
| **Despacho** | `despacho/despacho.{controller,service}.ts` (2 controllers en el archivo), `despacho-sweep.service.ts` | `despacho/instrucciones/*` (10 rutas) y `despacho/items/*` (6 rutas) | `instrucciones`, `instruccion_items`, `item_evidencias`, `instruccion_bitacora`, `vistos` | Solo transversales ven la instrucción; el responsable del ítem ve/actúa sobre **su** ítem sin ver la instrucción completa | `instrucciones_cambios` |
| **Comunicación** | `comunicacion/*` | `GET/POST /comunicacion`, `GET/PATCH /comunicacion/:id`, `GET /comunicacion/equipo`, `POST /comunicacion/:id/gabinete-visto` | `cobertura` | `unicom` + transversales gestionan; la secretaría dueña del evento solo mira | — (pendiente) |
| **Notificaciones** | `notificaciones/*` | `GET /notificaciones`, `GET /notificaciones/conteo`, `POST /notificaciones/leer-todas`, `POST /notificaciones/:id/leida` | `notificaciones` | Cada usuario ve/marca **solo las suyas** (primera tabla del sistema con RLS por `usuario_id`, no por secretaría) | `notificaciones_cambios` |
| **Pendientes** | `pendientes/pendientes.{controller,service}.ts` | `GET /pendientes` | Lee de `publicaciones`, `tareas`, `compromisos`, `cobertura` (sin tabla propia) | Cualquier sesión válida (el contenido se recorta por rol dentro del propio SQL del servicio, más RLS de cada tabla fuente) | — |
| **Vencimientos** | `vencimientos/vencimientos-sweep.service.ts` | Ninguna (solo el cron) | Lee/escribe `tareas`, `compromisos`, `notificaciones` | N/A (job de sistema, `SECURITY DEFINER`) | — |
| **Auditoría** | `auditoria/auditoria.{controller,service}.ts` | `GET /auditoria`, `GET /auditoria/resumen`, `GET /auditoria/:id`, `GET /auditoria/export.csv` | `auditoria` (poblada por triggers de ~15 tablas) | Solo `gobernador`/`jefe_gabinete`/`admin` | — |
| **Gabinete** | `gabinete/*` | `GET /gabinete/resumen` | Lee `publicaciones`, `eventos_agenda`, `tareas` (rollup, sin tabla propia) | Cualquier sesión (el SQL no filtra por rol; el frontend oculta el panel a no-transversales) | — |
| **Indicadores** | `indicadores/*` | `GET /indicadores/resumen` | Lee `publicaciones`, `tareas`, `proyectos` (rollup) | Cualquier sesión válida | — |
| **Realtime** | `realtime/realtime.gateway.ts`, `pg-listener.service.ts` | WebSocket (mismo puerto que HTTP) | N/A (reenvía filas de las tablas de arriba) | Igual que la tabla reenviada | Es el propio motor |

### 3.1 Módulos transversales (no son "de negocio", pero todo pasa por ellos)

| Pieza | Archivo | Responsabilidad |
|---|---|---|
| `TenantContextInterceptor` | `context/tenant-context.interceptor.ts` | Abre la transacción y setea el contexto RLS por request — **el componente más importante del backend**, según el propio `apps/api/README.md`. |
| `TxService` | `context/tx.service.ts` | Único punto por el que un service toca la base dentro de un request. |
| `DatabaseModule` | `database/database.module.ts` | Pool de conexiones (`pg.Pool`), global, `max: 20`. |
| `RolesGuard` / `@Roles()` | `common/roles.guard.ts`, `roles.decorator.ts` | Única autorización por código (no-RLS), exclusiva de `/admin/*`. |
| `paginacion.ts` | `common/paginacion.ts` | `limites()` + `paginar()` — envelope común `{datos, total, pagina, porPagina, paginas}`, tope duro de 100 por página. |
| `pg-error.util.ts` | `common/pg-error.util.ts` | Traduce SQLSTATE de Postgres a excepciones HTTP de NestJS. |
| Observabilidad | `observability/*` | `AppLogger` (prefija cada log con `[req:xxxxxxxx]`), `request-id.middleware.ts` (ALS, id por request), `global-exception.filter.ts` (reporta 5xx a Sentry si está activo). |
| Secretos | `config/secretos.ts`, `env.ts` | Convención `_FILE` (Docker/K8s secrets); `validarEntorno()` aborta el arranque si `JWT_SECRET` es débil o de ejemplo (siempre) o si las claves de Postgres lo son (solo en producción). |

## 4. Frontend — cómo está organizado

`apps/web/src/`:

- `app/layout.tsx` — layout raíz (fuentes, metadata).
- `app/page.tsx` — redirige siempre a `/dashboard`; no hay lógica de sesión acá.
- `app/login/page.tsx` → `InstitutionalLogin.tsx`.
- `app/(panel)/layout.tsx` — shell autenticado: llama `GET /auth/me` al montar
  (no hay token legible por JavaScript que decodificar), redirige a `/login`
  si falla, y si tiene éxito monta `SessionProvider` + `RealtimeProvider` +
  sidebar + topbar para **todas** las páginas del panel.
- `app/(panel)/<módulo>/page.tsx` — una por módulo (16 páginas + 1 dinámica
  `despacho/[id]`).
- `lib/api.ts` — cliente HTTP único: `fetch` con `credentials: "include"`,
  reintento automático de un 401 vía `POST /auth/refresh` (con *single-flight*
  para no disparar varios refresh en paralelo si caen varias peticiones 401 a
  la vez), y todas las funciones tipadas (`getPublicaciones`, `crearTarea`,
  etc.) que consumen las páginas.
- `lib/realtime-context.tsx` — una sola conexión Socket.IO para todo el panel.
- `lib/session-context.tsx`, `lib/roles.ts` — sesión compartida y espejo
  cosmético de `rol_rango()`.
- `components/` — piezas reusadas entre páginas (paneles, íconos, sidebar,
  tarjetas de publicación, campana de notificaciones, paneles de detalle de
  Auditoría/Cobertura).

Todas las páginas siguen el mismo patrón: `useEffect` dispara un `fetch`
tipado de `lib/api.ts`, un `useState` de carga/error, y (donde aplica) una
suscripción a `useRealtime()` para actualizarse en vivo.

## 5. Discrepancias encontradas entre documentación y código

**[verificado en código]** — estas tres son contrastes directos, no
interpretación:

1. **`apps/api/README.md`, sección "Tiempo real", dice que el cliente se
   conecta con `io(url, { auth: { token: accessToken } })`.** El código real
   (`apps/web/src/lib/realtime-context.tsx:54`) usa
   `io(API_URL, { withCredentials: true })` — la cookie viaja sola, no hay
   ningún token pasado a mano. La propia sección de arriba del mismo README
   ("Autenticación") ya dice correctamente que el gateway lee la cookie del
   *handshake* — es una inconsistencia **dentro del mismo documento**, no solo
   entre doc y código: quedó una frase vieja de antes de que el proyecto
   migrara de JWT-en-header a cookie-httpOnly.
2. **La sección "Probar" del mismo README usa `curl ... -H "Authorization:
   Bearer $TOKEN"`.** Eso ya no funciona: `JwtStrategy` solo extrae el token de
   `req.cookies.access_token` (`extractFromCookie()`), no del header
   `Authorization`. Un `curl` real necesita `-b cookies.txt -c cookies.txt`
   contra `/auth/login`, no un Bearer token.
3. **`apps/web/README.md` está desactualizado en casi todo:**
   - Dice que el token vive en `localStorage` y que la decodificación del JWT
     en el cliente es "no verificada" — el sistema real usa cookies `httpOnly`
     y el frontend no decodifica nada, le pregunta al backend (`GET
     /auth/me`).
   - Lista solo 3 secciones (`/dashboard`, `/secretarias`, `/auditoria`)
     cuando hoy hay 16 páginas de panel.
   - Dice "Sin manejo de expiración de token" y "CORS abierto" — ambos ya están
     resueltos (refresh automático de `lib/api.ts`, y `enableCors({ origin:
     WEB_ORIGIN, credentials: true })` en `main.ts`).
   - Menciona el puerto `3002`; el puerto real (`package.json`, `next dev -p
     8500`) es `8500`.

Estas tres son evidencia directa de que **la documentación de los README no se
actualizó al ritmo del código** — un patrón a tener en cuenta al confiar en
cualquier README de este repo sin contrastarlo (ver recomendación en
`05-hallazgos-y-plan-de-mejoras.md`).

Un contraste menor, no un error funcional: el `Dockerfile` de `web` deja
`EXPOSE 3002` y `ENV PORT=3002` como valor por defecto de la imagen, pero
`docker-compose.full.yml` lo sobreescribe en runtime a `PORT: 8500` — funciona
porque `EXPOSE` es solo documentación para Docker, no una restricción, pero es
una imprecisión cosmética arrastrada de un cambio de puerto anterior.
