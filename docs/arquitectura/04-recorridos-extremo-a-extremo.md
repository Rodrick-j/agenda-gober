# Recorridos de extremo a extremo

Seis procesos reales del sistema, narrados en el mismo orden siempre:
**Actor → Pantalla → Petición/evento → Ruta/controlador → Servicio → Entidad
→ Respuesta → Actualización de la interfaz.** Cada uno cita el/los diagramas
que lo respaldan (todos en `diagramas/`, con su guía de lectura en
`diagramas/README.md`) y los archivos de código exactos. Todo
**[verificado en código]** salvo donde se marque lo contrario.

Se eligieron estos seis porque, entre todos, tocan cada capa del sistema al
menos una vez: autenticación, un flujo de aprobación con automatización,
tiempo real, la cadena de mando de Despacho, el módulo más nuevo
(Comunicación), y los dos mecanismos de "no" que tiene el sistema.

---

## 1. Iniciar sesión

| | |
|---|---|
| **Actor** | Cualquier persona con una cuenta activa |
| **Pantalla** | `app/login/page.tsx` → `InstitutionalLogin.tsx` |
| **Petición** | `POST /auth/login { email, password }` |
| **Ruta/controlador** | `AuthController.login()` |
| **Servicio** | `AuthService.login()` → `emitirSesion()` |
| **Entidad** | `usuarios`, `usuario_roles`, `roles`, `sesiones` (sin RLS) |
| **Respuesta** | `200 { user }` + `Set-Cookie: access_token` (60 min) + `Set-Cookie: refresh_token` (30 días, `path=/auth`) |
| **Actualización de UI** | `SessionProvider` guarda `user`; `router.replace('/dashboard')` |

**Diagrama:** [`diagramas/secuencia-login.puml`](diagramas/secuencia-login.puml).

El paso que casi todos los sistemas se saltean y este no: la consulta que
busca al usuario compara `lower(email)=lower($1)` y el propio DTO normaliza
(`trim().toLowerCase()`) antes de validar — un teclado que autocapitaliza o un
espacio pegado no tumban el login. El mensaje de error es **el mismo**
("Credenciales inválidas") tanto si el email no existe como si la contraseña
es incorrecta — nunca se revela cuál de las dos cosas pasó.

Una hora después (o cuando sea que el `access_token` venza), la primera
petición que haga la persona recibe `401`; `apps/web/src/lib/api.ts` lo
intercepta, llama una sola vez a `POST /auth/refresh` (con *single-flight*:
si diez peticiones fallan a la vez, solo se dispara un refresh, no diez) y
reintenta la petición original — la persona nunca ve una sesión cortada
mientras el `refresh_token` (30 días) siga vivo y no haya sido revocado.

---

## 2. Publicar un comunicado (con la automatización nueva)

| | |
|---|---|
| **Actor** | Autor (cualquier rol de secretaría) → Director/Secretario → Secretario |
| **Pantalla** | `InstitutionalDashboard.tsx` (sección Publicaciones de `/dashboard`) |
| **Petición** | `POST /publicaciones` , luego 3× `PATCH /publicaciones/:id/estado` |
| **Ruta/controlador** | `PublicacionesController` |
| **Servicio** | `PublicacionesService.create()` / `.updateEstado()` |
| **Entidad** | `publicaciones` (+ dispara `notificaciones` vía trigger) |
| **Respuesta** | `200`/`201`, o `403` si el trigger rechaza la transición |
| **Actualización de UI** | Optimista por la respuesta HTTP, y en vivo para **otras pestañas/usuarios** vía `publicacion:cambio` (WebSocket) |

**Diagramas:**
[`diagramas/secuencia-crear-publicacion-flujo-aprobacion.puml`](diagramas/secuencia-crear-publicacion-flujo-aprobacion.puml)
(la petición HTTP capa por capa) y
[`diagramas/actividad-flujo-publicacion.puml`](diagramas/actividad-flujo-publicacion.puml)
(el proceso completo con el rechazo y el barrido horario) +
[`diagramas/estados-publicacion.puml`](diagramas/estados-publicacion.puml).

Lo que hace a este recorrido distinto de un CRUD con estados: **nadie tiene
que acordarse de avisarle a nadie**. Cada `PATCH .../estado` dispara, en la
misma transacción, un trigger `AFTER UPDATE`
(`fn_publicaciones_notify_estado`, `021_publicaciones_flujo.sql`) que inserta
en `notificaciones` para el destinatario correcto según hacia dónde se movió
el estado (director+secretario al pedir revisión; el secretario al aprobar;
el autor al publicar o al ser rechazado, con el motivo). Si la publicación
queda estancada — más de 48h en revisión, o aprobada sin publicar — un job
`@Cron` horario (`PublicacionesSweepService` →
`fn_publicaciones_sweep()`, `025_publicaciones_sweep.sql`) manda un
recordatorio, y a las 96h escala al secretario. Ningún aviso se repite (columnas
`*_recordado_at`/`*_escalado_at`).

---

## 3. Actualización en tiempo real (ejemplo genérico, usando Publicaciones)

| | |
|---|---|
| **Actor** | Cualquier usuario con el panel abierto (pasivo — no dispara nada él mismo) |
| **Evento disparador** | Otra persona hace un `PATCH`/`POST`/`DELETE` sobre una fila con tiempo real |
| **Canal** | `pg_notify('publicaciones_cambios', {id, accion})` (u otro de los 7 canales) |
| **Servicio** | `PgListenerService.handleNotification()` |
| **Entidad** | Re-`SELECT` de esa fila, una vez por socket conectado, con el contexto RLS de cada quien |
| **Evento de salida** | `socket.emit('publicacion:cambio', {accion, publicacion})` — o nada, si RLS no le deja ver la fila a ese socket |
| **Actualización de UI** | `useRealtime().onCambio(handler)` actualiza el `useState` de la página sin recargar |

**Diagrama:** [`diagramas/secuencia-realtime-actualizacion.puml`](diagramas/secuencia-realtime-actualizacion.puml).

La idea central, que vale para los 7 canales activos
(`publicaciones_cambios`, `eventos_cambios`, `tareas_cambios`,
`proyectos_cambios`, `compromisos_cambios`, `instrucciones_cambios`,
`notificaciones_cambios`): el filtro de "quién se entera" es **la misma
política RLS** que ya protege el HTTP, vuelta a evaluar por cada socket. No
existe una segunda copia de la regla de negocio escrita en TypeScript que
pueda desincronizarse de la real. **Comunicación (`cobertura`) todavía no
tiene canal** — quien pide/planifica una cobertura hoy se entera por la
campana de notificaciones o refrescando la página, no en vivo.

---

## 4. Despacho: de la instrucción del Gobernador al cierre validado

| | |
|---|---|
| **Actor** | Gobernador → Jefe de Gabinete → Responsable en una secretaría → Jefe de Gabinete |
| **Pantalla** | `/despacho` y `/despacho/[id]` |
| **Petición** | `POST /despacho/instrucciones` → `PATCH .../instrucciones/:id` → `POST .../items` → (responsable) sube evidencia + `POST /despacho/items/:id/solicitar-validacion` → `POST .../items/:id/validar` |
| **Ruta/controlador** | `DespachoController` (instrucción) + `DespachoItemsController` (ítem, *item-scoped* para el responsable) |
| **Servicio** | `DespachoService` |
| **Entidad** | `instrucciones`, `instruccion_items`, `item_evidencias`, `instruccion_bitacora`, y de rebote `tareas`/`proyectos`/`eventos_agenda` |
| **Respuesta** | La instrucción completa (transversales) o solo el ítem (el responsable, que no ve la instrucción madre) |
| **Actualización de UI** | En vivo vía `instrucciones_cambios` para quien puede ver la instrucción; el responsable ve su bloque de validación dentro de `/tareas` |

**Diagramas:**
[`diagramas/secuencia-despacho-emision-validacion.puml`](diagramas/secuencia-despacho-emision-validacion.puml),
[`diagramas/actividad-despacho-ciclo-instruccion.puml`](diagramas/actividad-despacho-ciclo-instruccion.puml),
[`diagramas/estados-instruccion.puml`](diagramas/estados-instruccion.puml),
[`diagramas/estados-instruccion-item.puml`](diagramas/estados-instruccion-item.puml).

Es el recorrido con más pasos automáticos del sistema: `fn_despacho_recalcular`
(SECURITY DEFINER) recalcula `avance_porcentaje`/`en_riesgo`/`estado` de la
instrucción **cada vez** que cambia un ítem o la fila que ese ítem referencia
— nadie edita esas tres columnas a mano, ni siquiera un Gobernador (la API ni
lo expone). El responsable de una tarea puede ver y actuar sobre **su
ítem** sin tener acceso a la instrucción completa (`fn_item_accesible_para_actual`);
pedir la validación exige al menos una evidencia adjunta (si no, `403` de un
trigger); devolver un ítem exige motivo. Un `@Cron` cada 10 minutos
(`DespachoSweepService`) persigue instrucciones vencidas sin cerrar y el SLA
de acuse de recibo (recordatorio a Jefes de Gabinete, luego escalamiento al
Gobernador).

---

## 5. Comunicación: pedir cobertura y conseguir el visto de Gabinete

| | |
|---|---|
| **Actor** | Director de una secretaría (o UNICOM) → UNICOM → Jefe de Gabinete |
| **Pantalla** | `/agenda` (botón "Pedir cobertura") → `/comunicacion` |
| **Petición** | `POST /comunicacion {eventoId}` → `PATCH /comunicacion/:id` (×N) → `POST /comunicacion/:id/gabinete-visto` |
| **Ruta/controlador** | `ComunicacionController` |
| **Servicio** | `ComunicacionService` |
| **Entidad** | `cobertura` (1:1 con `eventos_agenda`) |
| **Respuesta** | `201`, `409` si el evento ya tenía cobertura pedida, `403` si UNICOM intenta dar el visto |
| **Actualización de UI** | Por ahora, solo al recargar / por la campana de notificaciones — sin canal de tiempo real todavía |

**Diagramas:**
[`diagramas/secuencia-cobertura-comunicacion.puml`](diagramas/secuencia-cobertura-comunicacion.puml),
[`diagramas/actividad-cobertura-comunicacion.puml`](diagramas/actividad-cobertura-comunicacion.puml),
[`diagramas/estados-cobertura.puml`](diagramas/estados-cobertura.puml).

El módulo más nuevo del sistema (`026_comunicacion.sql`), construido con el
mismo patrón de sello+notificación que Publicaciones/Tareas/Despacho, pero
**sin** el mismo nivel de rigor en un punto concreto: nadie valida a nivel de
base de datos que los 6 valores de `cobertura.estado` se recorran en orden —
solo el rol está protegido (`unicom`/transversal gestionan, la secretaría
dueña solo mira), no la secuencia. La única transición realmente blindada por
un trigger es que **solo un rol transversal puede poner
`gabinete_visto_at`** (`fn_cobertura_sello`, `RAISE EXCEPTION` si UNICOM lo
intenta) — verificado en el diagrama de secuencia con el caso donde UNICOM
recibe `403`. Ver el hallazgo correspondiente en
`05-hallazgos-y-plan-de-mejoras.md`.

---

## 6. Los dos caminos de "no" (denegado por RLS vs. regla de negocio violada)

| | |
|---|---|
| **Actor** | Cualquier usuario de secretaría intentando algo fuera de su alcance |
| **Petición A** | `GET /proyectos/:id` de un proyecto de otra secretaría |
| **Petición B** | `PATCH /tareas/:id` cambiando `titulo` sin ser director+ |
| **Ruta/controlador** | `ProyectosController` / `TareasController` |
| **Servicio** | `ProyectosService.obtener()` / `TareasService.actualizar()` |
| **Entidad** | `proyectos` / `tareas` |
| **Respuesta A** | `404 Not Found` — "no encontrado", nunca "no autorizado" |
| **Respuesta B** | `403 Forbidden` — con el mensaje literal del trigger |
| **Actualización de UI** | El frontend muestra el mensaje de error; ningún cambio parcial queda aplicado (la transacción entera hace `ROLLBACK`) |

**Diagrama:** [`diagramas/secuencia-rls-denegado.puml`](diagramas/secuencia-rls-denegado.puml).

Este es el recorrido que demuestra por qué el modelo de seguridad de
AGENDA.GOBER es distinto de "si el rol no alcanza, tirar un error": la
política RLS de **lectura** simplemente hace que la fila no exista para ese
contexto (0 filas, sin excepción SQL) — el service lo traduce a `404` porque
no puede distinguir "no existe" de "existe pero no es tuyo", **y esa
ambigüedad es intencional** (no le confirma a nadie la existencia de algo que
no puede ver). La política RLS de **escritura**, en cambio, si se combina con
un trigger `BEFORE UPDATE` que compara la fila vieja contra la nueva
(`fn_validar_edicion_tarea`, `fn_validar_edicion_compromiso`,
`fn_validar_edicion_item`, `fn_validar_transicion_publicacion`), sí puede
distinguir "podés tocar esto, pero no aquello" — y ahí el error es `403` con
el motivo real. Los dos mecanismos conviven en casi todos los módulos de
contenido; cuál aplica depende de si la regla necesita comparar `OLD` contra
`NEW` (solo un trigger puede) o no (RLS alcanza sola).
