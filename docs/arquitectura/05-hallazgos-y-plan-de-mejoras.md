# Hallazgos y plan de mejoras

Todo lo de este documento es **[propuesta]** — ninguno de los cambios
descritos existe hoy en el código; si algo ya está resuelto se dice
explícitamente como tal. Se separa a propósito del resto de
`docs/arquitectura/`, que describe el estado **actual**, para no mezclar
"cómo es" con "cómo debería ser". Cada hallazgo trae su evidencia
**[verificado en código]** — nada de esta lista es una sospecha genérica de
"buenas prácticas".

Los hallazgos están ordenados por prioridad (1 = más urgente). La columna
"Depende de" marca cuándo conviene resolver algo antes que otra cosa.

---

## 1. TLS de base de datos sin verificación de certificado en producción

**Problema y evidencia:** tanto `apps/api/src/database/database.module.ts`
como `apps/api/src/realtime/pg-listener.service.ts` conectan a Postgres con
`ssl: { rejectUnauthorized: false }` — cifra el tráfico pero no valida que el
servidor sea quien dice ser (vulnerable a *man-in-the-middle* si alguien
intercepta la red entre la API y la base). Es el mismo certificado
autofirmado que genera `infra/docker/initdb/00-enable-ssl.sh` para
desarrollo. El propio `README.md` raíz ya dice explícitamente: *"En
producción con CA propia, pasar a `sslmode=verify-full`"* — es una deuda
reconocida, no un descuido silencioso.

**Impacto:** alto si la API y la base algún día corren en máquinas
distintas conectadas por una red que no es de confianza total (hoy no es el
caso: todo vive en `localhost`, ver `diagramas/despliegue.puml`). Bajo
mientras el despliegue siga siendo un solo host con Docker Compose.

**Solución propuesta:** emitir (o pedir) un certificado real para el host de
Postgres de producción; cambiar `ssl: { rejectUnauthorized: false }` por
`ssl: { rejectUnauthorized: true, ca: <contenido del CA> }` en los dos
archivos, usando la misma convención `_FILE` que ya existe para secretos
(`apps/api/src/config/secretos.ts`) para no dejar el certificado en una
variable de entorno plana.

**Prioridad y dependencias:** Alta, pero **solo bloqueante si se decide
desplegar la API y la base en hosts separados**. No depende de nada más de
esta lista.

**Criterio de aceptación:** con `sslmode=verify-full` y un certificado real,
la API arranca; con un certificado auto-firmado o vencido, la conexión falla
al arrancar (no en silencio).

---

## 2. Adjuntos y evidencias como `bytea` dentro de la fila, sin object storage

**Problema y evidencia:** `documentos.contenido` (`007_documentos.sql`) e
`item_evidencias.contenido` (`016_despacho_validacion.sql`) son `bytea NOT
NULL` — el archivo entero vive dentro de la fila de Postgres. Tope duro de
10 MB por archivo (`MAX_BYTES` en `documentos.controller.ts` y
`despacho.controller.ts`). El propio comentario de la migración 007 ya lo
reconoce como decisión de "primer corte".

**Impacto:** cada backup de base de datos (`scripts/backup.sh`) carga con
todos los binarios adjuntos; restaurar es más pesado de lo necesario; el
tope de 10 MB queda bajo para informes con fotos o PDFs escaneados grandes;
el `pg.Pool` mueve más bytes por conexión de los que debería para una
consulta que ni siquiera pidió el archivo (mitigado hoy porque los
`SELECT` de listado nunca incluyen `contenido`, pero el riesgo de que
alguien agregue sin querer un `SELECT *` sigue latente).

**Solución propuesta:** migrar a object storage (ej. Cloudflare R2 o S3),
guardando en la fila solo la referencia (`storage_key`) y la metadata que ya
existe; la descarga sigue pasando por la API (nunca una URL pública directa
al bucket) para no perder la validación de RLS del padre — el propio
comentario de 007 ya deja esta ruta marcada. Subir el tope de tamaño una vez
resuelto el almacenamiento.

**Prioridad y dependencias:** Media. No es urgente mientras el volumen de
adjuntos siga siendo bajo; se vuelve urgente si crece mucho el uso de
Despacho (evidencias) o Publicaciones (documentos).

**Criterio de aceptación:** subir/descargar un documento sigue funcionando
igual desde el frontend; un usuario sin acceso a la publicación/ítem padre
sigue sin poder bajar el archivo (mismo criterio de RLS, ahora aplicado antes
de generar la URL firmada de descarga en vez de en el propio `SELECT`).

---

## 3. Rate limiting y estado de Socket.IO en memoria del proceso

**Problema y evidencia:** `ThrottlerModule.forRoot([{ttl:60000, limit:100}])`
(global) y el `@Throttle` de `/auth/login` usan el almacenamiento por
defecto de `@nestjs/throttler`, que es un mapa en memoria del proceso
Node — no hay `ThrottlerStorageRedisService` ni configuración equivalente.
`RealtimeGateway.getAuthenticatedSockets()` itera `this.server.sockets.sockets`,
también en memoria local.

**Impacto:** con una sola instancia de la API (el caso de hoy, ver
`diagramas/despliegue.puml`) no pasa nada. Con más de una instancia detrás
de un balanceador, cada una llevaría su propio conteo de intentos de login
(el límite de 5/min se volvería, en la práctica, 5×N intentos) y un socket
conectado a la instancia A nunca recibiría los eventos de tiempo real
generados por una notificación procesada en la instancia B.

**Solución propuesta:** Redis como *storage* del Throttler
(`@nestjs/throttler` lo soporta con un adaptador) y como adaptador de
Socket.IO (`@socket.io/redis-adapter`) el día que se decida correr más de
una instancia de la API.

**Prioridad y dependencias:** Baja hoy (no hay evidencia de que el sistema
corra con más de una instancia); se vuelve **Alta y bloqueante** en el
momento en que se decida escalar horizontalmente la API.

**Criterio de aceptación:** con 2 instancias de la API detrás de un
balanceador, el rate-limit de `/auth/login` sigue siendo 5/min *en total*, y
un evento de tiempo real generado en cualquiera de las dos instancias llega
a todos los sockets conectados, sin importar a cuál instancia esté cada uno
conectado.

---

## 4. Sin pruebas unitarias — toda la cobertura automatizada es de integración

**Problema y evidencia:** `apps/api/src/` no tiene ningún archivo
`*.spec.ts` (confirmado por búsqueda); el `package.json` de `apps/api`
declara `"test": "jest"` y un job de CI ("Tests unitarios") que corre
`npm test -- --passWithNoTests` — es decir, **hoy pasa trivialmente porque no
hay nada que ejecutar**, no porque algo esté probado a ese nivel. Toda la
cobertura real es `apps/api/test/*.e2e-spec.ts` (`app`, `despacho`, `rls`),
que sí es sustancial y corre contra Postgres real como `app_user` sin
`BYPASSRLS`.

**Impacto:** medio. La cobertura e2e/RLS es de hecho la más valiosa para
este sistema en particular (prueba la autorización real, no una simulación),
pero funciones puras como `paginar()`, `limites()`, `mapPgError()` o los
cálculos de fecha de `lib/comunicacion.ts`/`lib/auditoria.ts` en el frontend
no tienen ninguna red de seguridad rápida — un cambio ahí solo se detecta
corriendo la suite completa contra Docker.

**Solución propuesta:** agregar pruebas unitarias puntuales para la lógica
sin efectos secundarios (paginación, mapeo de errores, formateo de fechas),
sin intentar mockear Postgres/RLS — esa parte ya está bien cubierta por los
e2e y mockearla le restaría valor a la prueba (el propio criterio del
proyecto, visible en cómo está armada la suite de RLS, es no mockear la base
para esto). Cuando existan, quitar `--passWithNoTests` del job de CI para
que una regresión real bloquee el merge.

**Prioridad y dependencias:** Media. No depende de nada más de esta lista.

**Criterio de aceptación:** `npm test` (sin `--passWithNoTests`) falla si se
borra o rompe una de las funciones puras cubiertas; el job de CI ya no
necesita la bandera de "aprobar aunque no haya tests".

---

## 5. Los tres README quedaron desactualizados respecto al código

**Problema y evidencia:** ya documentado con evidencia línea por línea en
`02-arquitectura-modulos.md` §5 — `apps/api/README.md` tiene una
contradicción interna sobre cómo se autentica el WebSocket, y su sección
"Probar" usa `Authorization: Bearer` cuando el sistema real usa cookies;
`apps/web/README.md` describe una versión del frontend con `localStorage`,
3 páginas y CORS abierto, ninguna de las cuales es cierta hoy (hay 16
páginas, cookies `httpOnly`, y CORS acotado a `WEB_ORIGIN`).

**Impacto:** medio — no afecta el funcionamiento del sistema, pero cualquiera
(incluida una futura sesión de trabajo con un asistente de IA) que confíe en
esos README sin contrastarlos contra el código va a perder tiempo o sacar
conclusiones equivocadas sobre cómo autenticarse o qué existe.

**Solución propuesta:** corregir las secciones puntuales señaladas en
`02-arquitectura-modulos.md` §5 (son ediciones acotadas, no una reescritura);
a futuro, considerar que `apps/api/README.md` y `apps/web/README.md` dejen de
describir el detalle de cada módulo (eso es lo que ahora cubre
`docs/arquitectura/`) y se limiten a "cómo arrancar esto en tu máquina",
enlazando a `docs/arquitectura/` para el resto — un solo lugar que mantener
al día en vez de tres.

**Prioridad y dependencias:** Baja en urgencia, alta en costo-beneficio (es
barato de arreglar). No depende de nada más de esta lista.

**Criterio de aceptación:** ningún comando de la sección "Probar" de
`apps/api/README.md` falla por estar desactualizado; `apps/web/README.md`
menciona el puerto y el mecanismo de sesión reales.

---

## 6. `instruccion_items.ref_id` es una referencia polimórfica sin FK real

**Problema y evidencia:** `db/migrations/015_despacho.sql` declara `ref_id
uuid NOT NULL` (sin `REFERENCES`) porque apunta a `eventos_agenda`, `tareas`
o `proyectos` según el valor de `tipo` — Postgres no tiene claves foráneas
polimórficas nativas. La integridad depende enteramente de que
`DespachoService` sea la única puerta de escritura y no se equivoque.

**Impacto:** bajo en la práctica (no se encontró ningún camino en el código
que inserte en `instruccion_items` fuera de `DespachoService.agregarItem`),
pero significa que un `DELETE` directo sobre `tareas`/`proyectos`/
`eventos_agenda` hecho por fuera de la aplicación (una migración manual, un
script de limpieza) podría dejar un `instruccion_items.ref_id` "colgado"
apuntando a nada, sin que ninguna restricción de la base lo impida ni lo
avise.

**Solución propuesta:** un trigger `BEFORE INSERT/UPDATE` en
`instruccion_items` que valide, según `NEW.tipo`, que `NEW.ref_id` exista de
verdad en la tabla correspondiente (`fn_validar_ref_id_item`, mismo estilo
que las funciones `fn_validar_*` que ya existen) — no se puede resolver con
una FK declarativa, pero sí con la misma herramienta (trigger) que el
sistema ya usa para todo lo que RLS no puede expresar.

**Prioridad y dependencias:** Baja — es una red de seguridad para un caso
que hoy no ocurre por cómo está escrito el código, no un bug activo.

**Criterio de aceptación:** intentar `INSERT INTO instruccion_items` con un
`ref_id` que no existe en la tabla que le corresponde según `tipo` falla con
un mensaje claro, en vez de insertarse silenciosamente.

---

## 7. `cobertura.estado` no tiene el mismo rigor que el resto de las máquinas de estado

**Hallazgo propio de esta revisión**, surgido al construir
`diagramas/estados-cobertura.puml` y contrastarlo con
`diagramas/estados-publicacion.puml`/`estados-instruccion-item.puml`.

**Problema y evidencia:** `publicaciones.estado`
(`fn_validar_transicion_publicacion`, 005) e
`instruccion_items.estado_validacion` (`fn_validar_edicion_item`, 016)
tienen un trigger que rechaza una transición fuera de la lista permitida.
`cobertura.estado` (`026_comunicacion.sql`) **no** — `fn_cobertura_sello`
solo protege la columna `gabinete_visto_at`, nunca compara
`OLD.estado`/`NEW.estado`. El `ActualizarCoberturaDto` acepta cualquiera de
los 6 valores del enum vía `@IsEnum(CoberturaEstado)`, así que UNICOM (o
cualquier transversal) puede, vía API, mandar una cobertura de `solicitada`
directo a `publicada`, o de `publicada` de vuelta a `solicitada`, sin que
nada lo impida a nivel de base de datos — solo la interfaz "sugiere" el
orden (`COBERTURA_SIGUIENTES` en `apps/web/src/lib/comunicacion.ts`), que es
el mismo tipo de protección cosmética que `apps/web/src/lib/roles.ts` (no
autorización real).

**Impacto:** bajo hoy (Comunicación recién se está usando), pero es
exactamente el tipo de inconsistencia que, si el patrón se sigue copiando
para el próximo módulo nuevo sin revisar este, se vuelve la norma en vez de
la excepción.

**Solución propuesta:** agregar `fn_cobertura_validar_transicion` (trigger
`BEFORE UPDATE`), calcado del de Publicaciones, con la lista de transiciones
que ya sugiere `COBERTURA_SIGUIENTES` en el frontend — moviendo esa regla de
"sugerencia visual" a "regla exigible", igual que en el resto del sistema.

**Prioridad y dependencias:** Media — es rápido de escribir (el patrón ya
existe 3 veces en el código) y cierra una inconsistencia real antes de que el
módulo tenga más uso y más datos que migrar si se decide más adelante.

**Criterio de aceptación:** un `PATCH /comunicacion/:id {estado:'publicada'}`
sobre una cobertura en `'solicitada'` responde `403`, igual que ya responde
un intento de transición inválida en Publicaciones.

---

## 8. Sin autoservicio de recuperación de contraseña

**Problema y evidencia:** no existe tabla de tokens de recuperación ni ruta
`/auth/forgot-password` o similar. El único camino documentado
(`apps/api/README.md`) es que un `admin` resetee la contraseña a mano desde
`/admin/usuarios` (`POST /admin/usuarios/:id/reset-password`).

**Impacto:** bajo para un sistema interno de una organización con un
administrador siempre disponible (el caso actual); se vuelve una fricción
real si la base de usuarios crece o el administrador no está disponible de
inmediato.

**Solución propuesta:** flujo estándar de recuperación por email (token de
un solo uso, expiración corta) — esto es lo único de esta lista que
**requiere el primer integración externa real del sistema** (un proveedor de
envío de email), algo que hoy no existe (ver `diagramas/c4-contexto.puml`).

**Prioridad y dependencias:** Baja. Depende de decidir e integrar un
proveedor de email, que hoy no está ni evaluado.

**Criterio de aceptación:** una persona con email registrado puede recuperar
el acceso sin intervención de un admin, y el token de recuperación no sirve
dos veces ni después de su expiración.

---

## 9. Sin documentación OpenAPI/Swagger de la API

**Problema y evidencia:** `apps/api/package.json` no tiene
`@nestjs/swagger` (ni ningún generador de OpenAPI) entre sus dependencias;
no hay ningún archivo `swagger.ts`/`openapi.json` en el repositorio.

**Impacto:** bajo para el equipo actual (que conoce el código), medio para
integrar un cliente nuevo o una herramienta externa contra la API — hoy la
única forma de saber la forma exacta de un endpoint es leer el DTO y el
controller.

**Solución propuesta:** `@nestjs/swagger` con los DTOs existentes
(`class-validator` ya provee la mayoría de los decoradores que Swagger
reutiliza) — es agregar decoradores, no reescribir nada; sirve además como
verificación cruzada de que la tabla de rutas de
`02-arquitectura-modulos.md` sigue vigente con el tiempo.

**Prioridad y dependencias:** Baja.

**Criterio de aceptación:** `GET /docs` (o la ruta que se elija) sirve una
página Swagger navegable con los DTOs reales de cada endpoint.

---

## 10. CI construye y prueba, pero no despliega a ningún entorno

**Problema y evidencia:** `.github/workflows/ci.yml` tiene 3 jobs (`api`,
`web`, `docker`) que instalan, construyen, corren migraciones/tests, y
construyen las imágenes Docker — pero ninguno hace `push` de la imagen a un
registro ni un `docker compose up`/`kubectl apply` contra un servidor real.
No hay ningún workflow de `deploy.yml` ni de `cd.yml`.

**Impacto:** ninguno hoy (no hay un entorno de producción real desplegado,
ver `diagramas/despliegue.puml`) — es una constatación, no un bug. Se
vuelve relevante en el momento en que exista un servidor de verdad al que
publicar.

**Solución propuesta:** cuando exista un destino real, agregar un job que
haga `docker push` a un registro (GHCR, por ejemplo) y dispare el despliegue
(SSH + `docker compose pull && up -d`, o el mecanismo que corresponda al
proveedor elegido) solo en `main` y solo si los jobs de `api`/`web` pasaron.

**Prioridad y dependencias:** Depende enteramente de que se decida **dónde**
va a vivir la producción — no es una tarea de código hasta que exista esa
decisión.

**Criterio de aceptación:** un merge a `main` que pasa CI termina, sin
intervención manual, con la nueva versión corriendo en el entorno elegido.

---

## Resumen de prioridad

| # | Hallazgo | Prioridad | Bloquea a |
|---|---|---|---|
| 1 | TLS `verify-full` en producción | Alta (condicional) | — |
| 3 | Redis para Throttler/Socket.IO | Alta (condicional) | Escalar horizontalmente la API |
| 2 | Object storage para adjuntos | Media | — |
| 4 | Pruebas unitarias | Media | — |
| 7 | Trigger de transición para `cobertura.estado` | Media | — |
| 5 | Corregir los 3 README | Baja (barato) | — |
| 6 | Validar `ref_id` polimórfico con trigger | Baja | — |
| 8 | Recuperación de contraseña | Baja | Elegir proveedor de email |
| 9 | OpenAPI/Swagger | Baja | — |
| 10 | CD a un entorno real | Sin definir | Elegir dónde vive producción |

"Alta (condicional)" significa: no urge en el despliegue de hoy (un solo
host, todo en `localhost`), pero es **bloqueante** el día que cambien esas
condiciones — no conviene escalar a más de una instancia, o separar la API
de la base en distintos hosts, sin resolver el hallazgo correspondiente
primero.
