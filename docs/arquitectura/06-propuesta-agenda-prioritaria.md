# Propuesta: la Agenda como punto de entrada del trabajo diario

Todo lo de este documento es **[propuesta]**, salvo donde se indique
explícitamente **[verificado en código]**, **[documentado sin verificar]** o
**[inferencia]** (mismas marcas que el resto de `docs/arquitectura/`, definidas
en `00-inventario-y-cobertura.md`). No se modificó código ni datos para
producirlo. Es la continuación directa de `01`–`05`; no repite lo que ya está
descrito ahí salvo para contrastarlo con lo nuevo.

**Versión revisada:** rama `chore/deploy-ci-hardening`, HEAD en `90d6b89`, más
el árbol de trabajo con cambios sin commitear descrito en `git status` al
2026-09-12 (el mismo estado que fotografía `00-inventario-y-cobertura.md`).
En particular, esta revisión encontró **trabajo en curso no documentado
todavía en la auditoría anterior**: `apps/api/src/eventos/agenda-automation.service.ts`,
`apps/api/src/eventos/dto/conflictos-evento.dto.ts` y la migración
`db/migrations/027_agenda_automatica.sql` (tipo de evento, recordatorios 24h/2h/15min,
detector de cruces de horario). Es decir: **la dirección de este pedido —
"la agenda como entrada, con alertas de cruce" — ya empezó a construirse antes
de este análisis**, y esta propuesta parte de ahí, no de cero.

**Método:** lectura de las 27 migraciones (`008`, `011`, `015`–`018`, `022`–`027`),
los módulos `eventos`, `reuniones`, `despacho`, `comunicacion`, `pendientes`,
`vencimientos`, `documentos`, `admin`, `auth`, `realtime` completos
(controller+service+DTO), la página `apps/web/src/app/(panel)/agenda/page.tsx`
completa, `apps/web/src/lib/roles.ts`, `apps/web/src/components/InstitutionalSidebar.tsx`
y `apps/web/package.json`. Todo lo citado abajo con ruta de archivo fue leído
línea por línea, no inferido.

---

## Mapa de este documento contra el pedido

| Pedido | Sección de este documento |
|---|---|
| 1. Objetivo y alcance de la 1ª entrega | §1 |
| 2. Capacidades existentes y brechas | §2 |
| 3. Flujo solicitud→programación→realización | §3 |
| 4. Matriz de permisos | §4 |
| 5. Diseño de tabla, calendario y ficha | §5 |
| 6. Pantallas por persona | §6 |
| 7. Relaciones de datos y reutilización | §7 |
| 8. Alertas, notificaciones y adjuntos | §8 |
| 9. Plan por lotes | §9 |
| 10. Protocolo de validación con la jefa | §10 |
| 11. Preguntas indispensables y material de Excel | §11 |
| 12. Primer lote recomendado | §12 |

---

## 1. Objetivo y alcance de la primera entrega

**Objetivo:** que la Jefa de Gabinete pueda registrar, ver y reprogramar la
agenda del Gobernador **sin volver a Excel**, y que el Gobernador llegue a
cada actividad sabiendo quién coordina, quién asiste y qué se espera de él —
sin construir todavía nada de Secretarías/UNICOM que no sea estrictamente
necesario para esto (esos módulos ya existen y se conservan intactos, ver §2).

**Alcance de esta etapa (solo diseño, sin tocar código/datos):**
- Un flujo de eventos con **estado propio** (hoy no existe: todo evento
  `eventos_agenda` nace ya "firme", ver §3).
- Un rol **`apoyo`** nuevo, distinto de `jefe_gabinete` y de los roles de
  secretaría (hoy no existe, ver §4.1).
- Reutilización explícita de Reuniones (acta/compromisos), Tareas y Despacho
  para no duplicar registros (el pedido lo exige explícitamente; ver §7).
- Dos vistas de calendario (Día/Semana) priorizadas sobre una tabla estilo
  Excel completa, con una objeción justificada en §5.1.

**Fuera de alcance de esta etapa:** todo lo de Secretarías/UNICOM que no sea
una dependencia directa (Comunicación ya está construida como capa sobre
`eventos_agenda` — ver `026_comunicacion.sql` — y **no se toca**, salvo que el
nuevo estado del evento la afecte, lo cual se señala explícitamente en §7.3).

---

## 2. Capacidades existentes y brechas (con evidencia)

### 2.1 Ya existe y se reutiliza tal cual

| Capacidad | Evidencia | Cómo se comprobó |
|---|---|---|
| CRUD de eventos con secretaría/rango/confidencialidad + invitados internos | `db/migrations/008_eventos_agenda.sql`, `apps/api/src/eventos/eventos.service.ts` | Lectura de código |
| Clasificación por tipo (reunión/audiencia/inspección/acto/conferencia/otro) | `027_agenda_automatica.sql:8-10`, `create-evento.dto.ts:15-22` | Lectura de código |
| Recordatorios automáticos 24h/2h/15min, idempotentes, re-armados al reprogramar | `027_agenda_automatica.sql` completo, `agenda-automation.service.ts` (`@Cron('*/5 * * * *')`) | Lectura de código |
| Detección de cruces de horario al crear/editar (aviso, no bloqueo — con opción explícita "crear de todos modos") | `EventosService.buscarConflictos()` (`eventos.service.ts:61-80`), UI en `agenda/page.tsx:342-352,915-965` | Lectura de código; **ver brecha crítica en §8.1** |
| Reunión = evento + acta (`reunion_actas`, PK=`evento_id`) + compromisos con responsable/fecha/estado | `011_reuniones.sql` | Lectura de código |
| Compromiso → notifica al responsable, sella `cumplido_at`, sweep de vencidos | `022_compromisos_avisan.sql`, `024_vencimientos_sweep.sql` | Lectura de código |
| Vínculo Despacho↔Agenda ya existe: un `instruccion_items.tipo` puede ser `'evento'` o `'reunion'`, con `ref_id` apuntando a `eventos_agenda` | `despacho/dto/create-item.dto.ts:15-20`, `despacho.service.ts:61-64` (detalle del ítem según tipo) | Lectura de código |
| "Mi bandeja" (`/pendientes`) agregando pendientes de varios módulos por usuario | `apps/api/src/pendientes/pendientes.service.ts` | Lectura de código (ver memoria de sesión anterior, no releída línea por línea en esta pasada) |
| Tiempo real por RLS re-evaluada por socket, 7 canales incluido `eventos_cambios` | `pg-listener.service.ts`, `008_eventos_agenda.sql:158-160` | Lectura de código |
| Auditoría inmutable de cada cambio a `eventos_agenda` (trigger genérico) | `008_eventos_agenda.sql:142-144` | Lectura de código |
| Adjuntos con bytea + RLS heredada del padre (patrón ya usado 2 veces) | `007_documentos.sql`, `016_despacho_validacion.sql` (`item_evidencias`) | Lectura de código |
| Notificaciones vía trigger `SECURITY DEFINER`, nunca "a todo el mundo" | Repetido en `021`, `022`, `023`, `026`, `027` | Lectura de código |

**Ninguna de estas piezas se reconstruye.** El diseño de abajo se apoya en
ellas.

### 2.2 Existe, pero parcial

| Capacidad | Qué falta | Evidencia |
|---|---|---|
| Calendario | Solo **Mes** (grilla) + panel del **día seleccionado** (lista, no grilla horaria). No hay vista **Semana**. | `agenda/page.tsx` — el componente entero es un calendario mensual con un panel lateral de agenda del día; no hay ninguna grilla por horas. |
| Ficha del evento | Un solo formulario modal con: tipo, título, fecha, confidencialidad, hora inicio/fin, duración, lugar, recordatorios, descripción, invitados internos, "solicitar cobertura". **No** tiene estado, prioridad, organización solicitante, contacto externo, coordinador, antecedentes, resultado esperado. | `agenda/page.tsx:155-1331` (leído completo), `create-evento.dto.ts` |
| Adjuntos | El patrón (bytea + RLS heredada + descarga controlada) existe **dos veces** (Publicaciones, Despacho) pero **no aplica a eventos** — `documentos.publicacion_id` es `NOT NULL`. | `007_documentos.sql:9` |
| Historial de una reprogramación | Cada `UPDATE` de `eventos_agenda` sí queda en `auditoria` (antes/después), pero **nadie que no sea `gobernador`/`jefe_gabinete`/`admin` puede leer `auditoria`** — un director dueño del evento no puede ver quién lo reprogramó. | `01-proposito-alcance-roles.md` §3.2 (tabla de excepciones); `auditoria` RLS restringida a transversales |
| Multi-día / cruce de medianoche | La base de datos **sí** lo permite (`CHECK (fecha_fin >= fecha_inicio)`, sin tope de días — `008_eventos_agenda.sql:15`), pero el formulario web fuerza `fechaInicio`/`fechaFin` al mismo día seleccionado (`agenda/page.tsx:331-334`). Hoy es imposible crear desde la UI un evento de todo el día o que cruce medianoche. | Lectura de código |
| Zona horaria institucional | `America/La_Paz` aparece **hardcodeado dos veces**, en features distintas, no como una constante compartida: `027_agenda_automatica.sql:89` (texto del recordatorio) y `auditoria.service.ts` (export CSV, según `project-tech-audit` de memoria — no releído en esta pasada). No hay una tercera copia todavía, pero tampoco una fuente única. | Lectura de código |

### 2.3 Falta por completo

- **Estado del evento** (solicitud → … → realizada). Hoy `eventos_agenda` no
  tiene columna `estado`: todo evento nace "firme" en el sentido de que ocupa
  el calendario desde el `INSERT`.
- **Organización solicitante / contacto externo.** Búsqueda explícita en todo
  `db/migrations/` y `apps/api/src/`: no existe ninguna tabla ni columna
  `organizacion`/`contacto` fuera de Despacho/Auditoría (que no son esto).
  Registrar a alguien externo hoy exigiría crearle una cuenta de usuario real
  — lo cual el pedido prohíbe explícitamente.
- **Rol `apoyo`.** Los 7 roles de `roles` (`001`, `026`) son
  `operador, director, secretario, unicom, jefe_gabinete, gobernador, admin`
  — verificado también en `apps/web/src/lib/roles.ts:5,9` y en el enum
  `RolNombre` de `admin/dto/usuario.dto.ts:13-21`. No hay ningún rol para
  "persona de apoyo del Gabinete".
- **Coordinador de un evento** distinto de `creado_por` y de los invitados.
- **Confirmación de participante externo** (quién confirmó, cuándo, por qué
  medio) — no existe ningún campo así en ninguna tabla.
- **Grabación/adjunto de audio.** Búsqueda de `MediaRecorder`/`getUserMedia`
  en todo `apps/web/src`: cero resultados.
- **Importación desde Excel.** No existe ningún endpoint ni componente de
  import; `documentos`/`despacho` evidencias son subida de un archivo a la
  vez, no un CSV/XLSX masivo.
- **Vista tabla editable** de eventos. `apps/web/package.json` no tiene
  ninguna librería de grillas (`ag-grid`, `handsontable`, `@tanstack/table`,
  etc.) — cualquier tabla con pegado desde Excel y navegación por teclado se
  construye desde cero.
- **Recurrencia** de eventos.
- **Desconexión forzada de sockets** al revocar sesión/cambiar rol (ver
  hallazgo detallado en §8.3 — es una brecha de seguridad real, no solo de
  producto).

### 2.4 Decisiones institucionales — ya tomadas en esta sesión

1. **Rol del Gobernador — resuelto.** El Gobernador **no** confirma,
   reprograma ni cancela directamente: consulta su agenda y **emite
   indicaciones** (con texto y adjuntos) que la Jefa recibe, coordina y
   aplica. Esto se exige **a nivel de permisos de base de datos, no solo de
   interfaz** — ver §4.2, que describe el mecanismo nuevo (`evento_indicaciones`)
   y el cambio de RLS, **acotado a `eventos_agenda`** (Despacho conserva
   exactamente sus atribuciones actuales, ver el callout de alcance en §4.2).
2. **`tentativo` y cruces — resuelto.** Un evento `tentativo` sí ocupa el
   horario para el chequeo de conflictos (ver §3.2, sin cambios).
3. **Alcance de `apoyo` — resuelto**, con una corrección de diseño respecto a
   la versión anterior de este documento: participación (asistir),
   consulta (ver el detalle) y trabajo delegado (poder editar) son tres cosas
   separadas — estar invitado a un evento **nunca** da permiso de edición,
   ni para `apoyo` ni para nadie más (así ya funciona el resto del sistema; la
   versión anterior de este documento lo conflacionaba para `apoyo` por
   error). Todo lo que no le fue asignado/compartido explícitamente se
   muestra únicamente como bloque "ocupado"/"reserva tentativa", sin asunto,
   organización, participantes, lugar, notas ni adjuntos, en API, base de
   datos, notificaciones, búsquedas, exportaciones y tiempo real. Ver §4.1 y
   §4.4.
4. **Contactos externos — resuelto: sí llevan snapshot congelado.** Nombre,
   organización y cargo con los que alguien participó en un evento quedan
   fijos aunque el contacto "vivo" se actualice después — ver el mecanismo
   exacto (copy-on-write + congelamiento al `realizado`) en §7.2.

**Sigue abierta, no bloqueante para el diseño (se puede decidir en el primer
lote sin afectar el resto):**

- ¿Vale la pena una vista tabla estilo Excel completa (pegado + navegación
  por teclado) en el primer lote, o conviene medirlo primero? (§5.1 — traigo
  una objeción concreta).
- ¿`jefe_gabinete` también puede emitir una "indicación" (por ejemplo, para
  pedirle algo a un `apoyo` sin ella misma ejecutarlo), o el mecanismo es
  exclusivo del Gobernador? Este documento lo deja exclusivo del Gobernador
  por ahora (es lo único que pediste); ampliarlo es un cambio pequeño si hace
  falta más adelante (agregar un rol emisor más a la misma tabla).

---

## 3. Flujo de solicitud, programación y realización

### 3.1 Las cinco dimensiones que hoy están mezcladas (o no existen)

El pedido (§5 del enunciado) exige no concentrar todo esto en una sola
columna. Hoy `eventos_agenda` no tiene **ninguna** de las cinco:

| Dimensión | Hoy | Propuesta |
|---|---|---|
| 1. Estado del evento | No existe (implícito: todo evento = confirmado) | Columna `estado evento_estado` (enum, §3.2) |
| 2. Participación del Gobernador | No existe | Columna `participacion_gobernador` (`no_aplica / prevista / confirmada / representante / cancelada`) |
| 3. Confirmación de participantes externos | No existe (no hay tabla de externos) | Por fila, en `evento_participantes_externos` (§7.2) |
| 4. Preparación logística | No existe | Se deriva de tareas ligadas al evento (`tareas.evento_id`, §7.3) — no es un campo del evento, es un conteo |
| 5. Comunicación de cambios | Existe **de facto** vía `notificaciones`, pero sin un lugar donde se vea "esto se avisó / esto no" | Se resuelve con la matriz de notificaciones (§8.2), no con una columna nueva |

### 3.2 Máquina de estados propuesta

```
solicitud → en_coordinacion → tentativo → confirmado → realizado
                                              ↓              
                                          cancelado / no_realizado
```

- **`solicitud`**: existe el pedido, no hay fecha todavía (o hay una
  "propuesta", sin comprometer el calendario).
- **`en_coordinacion`**: alguien de apoyo está buscando horario/lugar; puede
  o no tener ya una fecha tentativa cargada.
- **`tentativo`**: ya tiene fecha/hora, **ocupa el calendario para detectar
  cruces**, pero se muestra visualmente distinto ("a confirmar") y no exige
  todos los requisitos de un evento firme.
- **`confirmado`**: es un compromiso firme. Exige coordinador asignado (ver
  regla en §5.2) y pasó el chequeo de conflictos (o fue autorizado
  explícitamente, como ya hace hoy `permitirConflicto` en el frontend).
- **`realizado` / `cancelado` / `no_realizado`**: estados terminales. Los dos
  últimos exigen motivo (mismo patrón que `publicaciones.motivo_rechazo`,
  `021_publicaciones_flujo.sql:94-112`).

**Reprogramación** no es un estado nuevo — es un `UPDATE` de
`fecha_inicio`/`fecha_fin` sobre un evento `tentativo` o `confirmado`, que ya
queda en `auditoria` (antes/después). La única pieza que falta es **quién
puede leer ese historial sin ser transversal** — ver la propuesta puntual en
§7.2 (función `SECURITY DEFINER` que exponga el historial de auditoría de
*ese* evento a quien puede *ver* ese evento, sin abrirle toda la tabla
`auditoria`, exactamente lo que pide la sección 12 del enunciado).

Este enum reemplaza al "todo evento nace firme" de hoy, pero **no rompe nada
existente**: los eventos ya creados (y los que cree cualquier código que no
sepa de este cambio, si algo quedó sin actualizar) reciben `DEFAULT
'confirmado'` — es decir, siguen comportándose exactamente igual que hoy.

### 3.3 Por qué NO conviene una tabla "solicitudes" separada

El enunciado sugiere un recorrido `Solicitud → … → realizada` como si fueran
pasos de una entidad. **Propongo no crear una tabla `solicitudes` aparte de
`eventos_agenda`** — sería exactamente la duplicación que el propio pedido
pide evitar ("Evita duplicar registros entre Agenda, Reuniones, Tareas y
Despacho"). Una solicitud **es** un evento en estado `solicitud`, con
`fecha_inicio`/`fecha_fin` en `NULL` (hoy son `NOT NULL`, hace falta
relajarlas — ver §7.3) y quizás una `fecha_tentativa` de referencia. Cuando
avanza, no "se convierte" en otra cosa: es la misma fila cambiando de estado
y completando campos. Esto es coherente con cómo ya funciona el resto del
sistema (una publicación no salta de tabla al aprobarse, ver
`021_publicaciones_flujo.sql`).

---

## 4. Matriz de permisos

### 4.1 El rol `apoyo` — participación, consulta y trabajo delegado son tres
cosas distintas

**Corrección respecto a la versión anterior de este documento:** la primera
versión de esta sección reutilizaba `evento_responsables` (la tabla de
invitados) también como mecanismo para dar a `apoyo` permiso de **edición**.
Eso está mal, y de hecho **contradice cómo ya funciona el resto del sistema**:
hoy, para `operador`/`director`/`secretario`, estar invitado a un evento
(`evento_responsables`) **nunca** otorga permiso de escritura — el permiso de
editar sale exclusivamente de `secretaria_id`+rango (`eventos_update`,
`008_eventos_agenda.sql:71-86`), nunca de la lista de invitados. Diseñar
`apoyo` de otra forma habría introducido, silenciosamente, la primera
excepción a esa regla. Se corrige separando tres cosas que el pedido pide
distinguir explícitamente:

| Concepto | Tabla | Qué habilita | Quién la administra |
|---|---|---|---|
| **Participación** (quién asiste) | `evento_responsables` (ya existe) | Solo visibilidad del evento completo — igual que hoy para cualquier rol. **Nunca** edición. | Quien puede editar el evento (`fn_evento_editable_por_actual`, sin cambios) |
| **Consulta** (quién puede ver el detalle sin asistir) | Se resuelve con la unión de las dos tablas de abajo — no hace falta una tercera tabla de "permisos de lectura" | Ver el evento completo | — |
| **Trabajo delegado / coordinación** (quién puede *actuar* sobre el evento) | `evento_colaboradores` (**nueva**: `evento_id`, `usuario_id`, `asignado_por`, `asignado_at`) | Editar el evento **mientras su estado sea `solicitud`/`en_coordinacion`/`tentativo`** (nunca sobre uno `confirmado`/`realizado` — ver más abajo) | La Jefa / `jefe_gabinete` / `admin` — nuevo endpoint `PUT /eventos/:id/colaboradores`, mismo patrón que el `PUT /eventos/:id/responsables` ya existente (`eventos.controller.ts:52-58`), pero **tabla separada** |

**Decisión de diseño clave para el rol en sí:** `apoyo` **no** puede ser una
variante de `operador`/`director`/`secretario` (esos están atados a
`secretaria_id` y a comparaciones de rango pensadas para confidencialidad
**departamental**). Tampoco puede heredar de `jefe_gabinete`. Es un octavo
rol, `ambito_secretaria=false`, que — a diferencia de `unicom`, que sí ve
*todo* lo no-confidencial de *todas* las secretarías para su propio dominio —
**no** entra en la rama "transversal ve todo" de `eventos_select`.

**Visibilidad de detalle de `apoyo` = está invitado (asiste) O es
colaborador (trabaja en él) O lo creó él mismo.** Esto exige extender
`eventos_select` (o, más limpio, la función `fn_evento_visible_para_actual`
que ya centraliza esta lógica) para que también consulte
`evento_colaboradores`, no solo `evento_responsables` — un cambio acotado a
esa función, no una regla nueva paralela.

**Retirar acceso** ("la Jefa... retira ese acceso cuando corresponda", tu
redacción): un `DELETE` sobre la fila de `evento_colaboradores` — inmediato,
porque `eventos_select` (vía `fn_evento_visible_para_actual`) se vuelve a
evaluar en cada request y en cada re-consulta de tiempo real; no hay caché
que limpiar aparte del socket ya cerrado si estaba conectado (ver §8.3, el
mismo mecanismo de desconexión forzada aplica acá si se le retira acceso a
alguien con la pestaña abierta — a diferencia de una revocación de sesión,
esto no exige forzar el disconnect del socket entero, alcanza con que la
próxima re-consulta bajo RLS ya no devuelva la fila, que es lo que el canal
`eventos_cambios` ya hace en cada evento).

**Para todo lo que no le fue compartido de ninguna de las dos formas**,
`apoyo` necesita ver igual que esa franja horaria está ocupada — eso lo
resuelve la vista de disponibilidad de §4.4 (`fn_disponibilidad_gabinete`),
que expone **solo** el bloque horario, nunca la fila completa, y es un
mecanismo completamente separado de `eventos_select`.

**Regla de negocio de edición** (mismo patrón que
`fn_validar_edicion_tarea`/`fn_validar_edicion_compromiso`): `apoyo` **colaborador**
de un evento puede editarlo libremente mientras su estado sea
`solicitud`/`en_coordinacion`/`tentativo`; mover un evento a `confirmado`,
cancelarlo, o editar uno que ya está `confirmado`/`realizado`, exige
`jefe_gabinete`/`admin` (ver la nueva `eventos_update`/`eventos_delete` en
§4.2 — ya **no** incluye a `gobernador` tampoco, por la razón que sigue).
Ser invitado (participación) o ser colaborador (trabajo delegado) **nunca**
habilita, por sí solo, a confirmar/cancelar/reprogramar un evento
`confirmado` — esa regla la impone el mismo trigger, comparando `estado` OLD
contra `rol` del actor, sin importar si el actor está en
`evento_responsables` o en `evento_colaboradores`.

`coordinador_id` (el campo de la ficha, §5.2, "responsable principal") es
distinto de `evento_colaboradores` (el conjunto de quienes tienen acceso de
trabajo) — puede haber varios colaboradores y un solo `coordinador_id`. Regla
simple: asignar `coordinador_id` agrega automáticamente a esa persona a
`evento_colaboradores` si no estaba ya (uno implica el otro; lo inverso no).

### 4.2 El Gobernador no edita la agenda directamente — mecanismo de
"indicaciones"

Tu respuesta cambia el punto de partida original de este documento: no
alcanza con que el frontend no le muestre botones de confirmar/reprogramar/
cancelar al Gobernador — **la propia base de datos debe negarle esa
escritura**, igual que hoy le niega a un `operador` editar el evento de otra
secretaría. Esto es coherente con la filosofía ya explicada en
`01-proposito-alcance-roles.md` §3.2 ("qué es un candado real y qué es solo
un botón oculto"), solo que ahora se le aplica al rol que hoy **sí** tenía
ese candado abierto: `gobernador` está en la rama "siempre permitido, sin
restricción" de `eventos_update`/`eventos_insert`/`eventos_delete`
(`008_eventos_agenda.sql:58-96`) — hay que sacarlo de ahí.

**Cambio de RLS necesario (el único punto de este documento que modifica,
en vez de solo extender, una política existente):**

```
-- eventos_insert / eventos_update / eventos_delete, rama "transversal":
-- ANTES: rol IN ('gobernador', 'jefe_gabinete', 'admin')
-- DESPUÉS: rol IN ('jefe_gabinete', 'admin')
```

`eventos_select` **no cambia** — el Gobernador sigue viendo absolutamente
todo, tal como hoy ("consulta su agenda, revisa antecedentes"). Lo único que
pierde es la escritura directa.

> **Alcance del cambio — solo `eventos_agenda`, Despacho queda intacto.**
> Este `IN ('jefe_gabinete', 'admin')` reemplaza a `gobernador` **únicamente**
> en las tres políticas de `eventos_agenda` citadas arriba. No toca ninguna
> política de `instrucciones`/`instruccion_items`
> (`015_despacho.sql`/`016_despacho_validacion.sql`) — ahí `gobernador`
> conserva exactamente lo que tiene hoy: emitir instrucción, organizar/validar
> ítems, reabrir (`01-proposito-alcance-roles.md` §3.1). Tampoco toca
> `reunion_actas`/`compromisos` (`011_reuniones.sql`), donde `gobernador` sigue
> en la rama transversal sin cambios. Es un recorte de una tabla, no un
> recorte del rol.

**Qué reemplaza esa escritura — inspirado en Despacho, sin reusar su tabla:**
el sistema ya tiene, en Despacho, exactamente el patrón "el Gobernador emite
algo → Gabinete lo recibe, coordina y ejecuta → queda trazado con
autor/fecha/estado" (`instrucciones`/`instruccion_items`, `015_despacho.sql`).
La pregunta obvia es por qué no usar literalmente esa misma tabla en vez de
crear `evento_indicaciones` — la respuesta, con evidencia concreta de por qué
no encaja:

- **`CreateItemDto` hoy exige `refId` de un evento/proyecto ya existente** para
  `tipo IN ('evento','proyecto')` — solo `tipo=TAREA` puede crearse sin
  `refId` (`despacho.service.ts:207-211`, mensaje literal: *"para eventos o
  proyectos, pasá refId de uno existente"*). Una indicación de **crear** una
  actividad nueva no tiene ese `refId` todavía — habría que ampliar Despacho
  para que `tipo=EVENTO` también soporte auto-creación, lo cual es en sí
  mismo un cambio a un módulo que hoy funciona y está probado (30/30 e2e).
- **`fn_despacho_recalcular` calcula `avance_porcentaje`/`en_riesgo`
  ponderado** sobre los ítems de una instrucción — un concepto pensado para
  tareas/proyectos con progreso medible, que no tiene sentido para "mové esta
  reunión al jueves" (no hay "% de avance" de una reprogramación).
- Validación de cierre, evidencia adjunta con `peso`, y SLA de acuse
  (`016`–`018`) son maquinaria construida para el desglose de trabajo hacia
  las secretarías — una indicación puntual sobre un evento no necesita nada
  de eso.

Igual que Publicaciones/Tareas/Reuniones/Vencimientos **no comparten una
tabla** aunque todas repiten el mismo patrón sello+notificación+sweep (ver
`03-modelo-de-datos.md` §4), `evento_indicaciones` reutiliza el **patrón**
de Despacho (autor/fecha/estado/trazabilidad, notificación
`SECURITY DEFINER`, misma tabla `notificaciones`, mismo trigger genérico de
auditoría `fn_auditoria_publicaciones` reusado tal cual porque la tabla sí
tiene columna `id`) sin forzar sus datos dentro de una tabla diseñada para
otra cosa. Es la misma decisión de diseño que ya tomó el propio repo, no una
excepción nueva.

**Tabla nueva `evento_indicaciones`:**

| Columna | Para qué |
|---|---|
| `evento_id` (FK, `ON DELETE CASCADE`) | A qué actividad se refiere. Si `tipo='crear'`, se autocompleta: un trigger `BEFORE INSERT` crea un `eventos_agenda` placeholder en `estado='solicitud'` (mismo truco que ya usa Despacho al crear una tarea nueva sin `refId`, `despacho.service.ts:207-211`) |
| `tipo` | `crear / reprogramar / cancelar / prioridad / otro` |
| `autor_id` | Siempre el Gobernador (o `admin`, para soporte) |
| `texto` | La indicación en palabras |
| `fecha_propuesta_inicio`/`fecha_propuesta_fin` | Si aplica (crear/reprogramar) |
| `estado` | `pendiente / aplicada / descartada` |
| `atendida_por`, `atendida_at`, `resultado_nota` | Quién la resolvió, cuándo, y con qué nota (si la descarta, `resultado_nota` es obligatoria — mismo patrón que `publicaciones.motivo_rechazo`) |

**Cómo se distingue "pendiente" de "programación vigente" (tu requisito
explícito):** la indicación **nunca** escribe directamente
`fecha_inicio`/`fecha_fin`/`estado` del evento — esos campos los sigue
tocando únicamente la Jefa con el `PATCH /eventos/:id` de siempre (ella sí
sigue en la rama de `eventos_update`). Cuando ella aplica el cambio que la
indicación pedía, un solo request hace las dos cosas en una transacción:
actualiza el evento **y** marca la indicación como `aplicada`
(`atendida_por`/`atendida_at`). Hasta ese momento, la UI muestra la
indicación como una franja aparte ("El Gobernador pidió mover esto al
jueves — pendiente"), nunca reemplazando el bloque real del calendario.

**Adjuntos de una indicación:** se reutiliza `evento_adjuntos` (§7.2)
agregándole una columna `indicacion_id` nullable — así "texto y adjuntos"
comparte exactamente el mismo almacenamiento/RLS/descarga que cualquier otro
adjunto del evento, sin tabla de archivos nueva.

**Notificaciones (mismo patrón sello+trigger `SECURITY DEFINER` que todo el
resto del sistema):** al crear una indicación, avisa a todos los
`jefe_gabinete` ("El Gobernador pidió: {texto}"); al marcarla
aplicada/descartada, avisa al Gobernador (autor).

**"Vinculadas al evento o solicitud, con recepción, estado de atención y
resultado" (tu redacción, punto por punto):** `evento_id` cubre ambos casos
sin distinción especial — una solicitud **es** un evento en `estado='solicitud'`
(§3.3), así que una indicación sobre una solicitud es, técnicamente, una
indicación sobre un evento como cualquier otra. "Recepción" no es una columna
aparte: es la notificación al crearla (arriba) más el hecho de que aparece en
la bandeja de la Jefa apenas se inserta (visible por su propio rol en
`SELECT`, sin esperar ninguna acción de ella). "Estado de atención" =
`estado`. "Resultado" = `resultado_nota` + el propio cambio aplicado en
`eventos_agenda` (verificable comparando ambos). Si más adelante hace falta
medir cuánto tarda la Jefa en atender una indicación, se agrega una columna
`recibida_at` — no hace falta ahora, y no bloquea nada agregarla después.

### 4.3 Matriz de capacidades (Gobernador / Jefa / Apoyo)

`Sí` = puede directo. `Indicación` = no edita directo; emite una indicación
que la Jefa aplica. `Sí¹` = solo sobre lo propio/asignado. `—` = no.

| Acción | Apoyo | Jefa de Gabinete | Gobernador |
|---|---|---|---|
| Registrar solicitud (sin fecha) | Sí | Sí | Indicación (`tipo='crear'`) |
| Consultar agenda y disponibilidad | Sí¹ (lo suyo + bloques "ocupado" del resto, §4.4) | Sí | Sí (todo, sin restricción) |
| Consultar detalle reservado/confidencial | — | Sí | Sí |
| Proponer horario (`tentativo`) | Sí¹ (lo que se le asignó) | Sí | Indicación |
| Asignar coordinación (`coordinador_id`) / agregar-quitar colaboradores de apoyo (`evento_colaboradores`) | — | Sí | — |
| Confirmar / rechazar | — | Sí | Indicación (la Jefa aplica) |
| Reprogramar / cancelar un evento `confirmado` | — | Sí | Indicación (`tipo='reprogramar'`/`'cancelar'`) |
| Adjuntar antecedentes (documento/imagen/audio) | Sí¹ (lo suyo) | Sí | Sí (vía la indicación, si la trae; o directo si el evento ya lo tiene compartido por lectura — a definir en implementación, no bloqueante) |
| Registrar resultado (acta/compromisos) | Sí¹ (si es el coordinador) | Sí | Ver (no redacta el acta él mismo) |
| Aprobar acta/resultado | — | Sí | Sí |
| Consultar historial de un evento (reprogramaciones) | Sí¹ (lo suyo) | Sí | Sí |

La fila de secretarías/UNICOM **no cambia** — sigue siendo la de
`01-proposito-alcance-roles.md` §3.1, que no se toca.

### 4.4 Disponibilidad "ocupado" sin detalle — brecha real encontrada, y el
mecanismo que ahora necesita `apoyo` para todo lo que no le compartieron

El pedido pide: *"Cuando alguien necesite consultar disponibilidad sin
permiso para conocer el detalle, evalúa mostrar únicamente 'ocupado'"*. Hoy
**esto no es posible ni como aviso**: la política `eventos_select`
(`008_eventos_agenda.sql:40-53`) hace que la fila **no exista en absoluto**
para quien no tiene acceso — ni el título, ni siquiera el bloque horario. Esto
es intencional y correcto para *ver el contenido* (es la misma filosofía de
"404 en vez de 403" documentada en `04-recorridos-extremo-a-extremo.md` §6),
pero tiene una consecuencia que **hoy nadie está mitigando**:

> **Hallazgo [verificado en código]:** `EventosService.buscarConflictos()`
> (`eventos.service.ts:61-80`) consulta `eventos_agenda` con el mismo
> contexto RLS de quien pregunta. Si el Gobernador tiene una reunión
> `confidencial` de una secretaría a la que un miembro de `apoyo` (o
> cualquier otro rol) no tiene acceso, ese evento **no aparece como
> conflicto** al proponer un nuevo horario para el Gobernador a esa misma
> hora — el sistema deja crear el cruce sin avisar, porque la fila
> confidencial ni siquiera entra al `WHERE` que ve `apoyo`.

Esto es exactamente el escenario que el pedido quiere evitar (§9: "Cruces de
horario del Gobernador"). **Propuesta — dos funciones `SECURITY DEFINER`**
(mismo patrón ya usado 6 veces en el repo para romper la recursión de RLS —
`fn_evento_visible_para_actual`, `fn_evento_editable_por_actual`,
`fn_tarea_visible_para_actual`, `fn_item_accesible_para_actual`,
`fn_evento_de_mi_secretaria`, `fn_evento_visible_completo` — esta sería la
séptima y la octava, no un mecanismo nuevo en espíritu):

1. **`fn_disponibilidad_gobernador(desde, hasta)`** — devuelve **solo**
   `fecha_inicio`/`fecha_fin` de todos los eventos donde el Gobernador es
   invitado/creador, **sin importar confidencialidad ni secretaría dueña**,
   para que el detector de conflictos (`buscarConflictos`) los cuente aunque
   quien pregunta no pueda "ver" esas filas por RLS normal. Esencial para
   el piloto — es la brecha más directa entre "lo que ya existe" y "lo que
   el pedido pide" en materia de alertas.
2. **`fn_disponibilidad_gabinete(desde, hasta)`** — la que ahora hace falta
   por tu respuesta sobre `apoyo`: devuelve, para **todo** evento transversal
   (`secretaria_id IS NULL`, es decir, "la agenda que coordina Gabinete" — a
   propósito **no** incluye las agendas departamentales de las secretarías),
   un bloque `{fecha_inicio, fecha_fin, estado_proyectado: 'ocupado' |
   'reserva_tentativa'}` sin ninguna otra columna. La usa `apoyo` para ver,
   detrás de sus propios eventos asignados, que el resto del calendario de
   Gabinete tiene algo ahí — sin que el navegador reciba nunca el título, el
   lugar, los participantes ni las notas de lo que no le compartieron (tu
   requisito explícito: "los datos reservados no deben llegar al navegador
   para luego ocultarse visualmente" — por eso esto es una función SQL con
   una proyección de columnas reducida, no un filtro en la respuesta HTTP).

**Notificaciones/búsquedas/exportaciones/tiempo real deben respetar el mismo
recorte** para `apoyo`: cualquier endpoint nuevo de búsqueda o exportación de
la jornada tiene que construirse sobre `eventos_select` (o
`fn_disponibilidad_gabinete` para lo no compartido), nunca sobre una consulta
que traiga todo y filtre después en TypeScript. Para tiempo real, el canal
`eventos_cambios` ya re-consulta por RLS en cada socket (`04-recorridos-extremo-a-extremo.md`
§3) — eso ya protege el detalle. Lo que **no** cubre ese canal es un aviso en
vivo de "algo cambió en un bloque ocupado que no puedo ver en detalle": para
el piloto alcanza con refrescar la vista de disponibilidad al reabrir/enfocar
la pestaña (mismo patrón `visibilitychange` que ya usa
`components/MisPendientes.tsx`); un canal dedicado a disponibilidad queda
como **siguiente mejora**, no esencial.

### 4.5 Edición simultánea / bloqueo optimista

Hoy no hay ningún mecanismo — dos personas editando el mismo evento a la vez
terminan con "el último `UPDATE` gana" silenciosamente, igual que en el resto
del sistema (no es una regresión introducida por este pedido, es el estado
actual de *todo* el CRUD). El pedido pide explícitamente no aceptar esto para
decisiones sensibles.

**Propuesta mínima (sin librerías nuevas):** un patrón de *bloqueo optimista*
con `updated_at` como token de versión — el frontend manda el `updated_at`
que tenía cuando abrió el formulario; `EventosService.actualizar()` agrega
`AND updated_at = $n` al `WHERE` y, si `rowCount === 0` pero el `id` sí
existe, devuelve un error específico ("Este evento cambió mientras lo
editabas") en vez de aplicar el cambio a ciegas. Es una modificación acotada
(un parámetro más en la query existente, `eventos.service.ts:172-184`), no
una reescritura. Solo se exige para transiciones **sensibles** (confirmar,
reprogramar un `confirmado`, cancelar) — para ediciones triviales (agregar una
nota) no vale la pena la fricción.

---

## 5. Diseño de tabla, calendario y ficha del evento

### 5.1 Las tres vistas — qué existe, qué falta, y una objeción

| Vista | Estado hoy | Esfuerzo para completarla | Utilidad directa para "organizar una jornada real" |
|---|---|---|---|
| **Mes** | Existe (`agenda/page.tsx`) | Bajo (agregar color/badge por `estado`) | Media — sirve para panorama, no para detectar cruces de hora |
| **Día** | Existe *parcialmente* (lista lateral, no grilla horaria) | Medio (una grilla de horas reutilizable) | **Alta** — es literalmente "Mi jornada" del Gobernador (§6) |
| **Semana** | No existe | Medio (mismo componente que Día, ×7 columnas) | **Alta** — es la única vista que muestra huecos y cruces de un vistazo al proponer horario |
| **Tabla editable estilo Excel** (edición in-place, pegado desde Excel, navegación por teclado, selección de columnas) | No existe; no hay librería de grillas en `package.json` | **Alto** — no hay nada que reutilizar; hay que resolver selección de celdas, validación de pegado, deshacer, o adoptar una librería nueva | Media-alta, pero **no es lo que resuelve el problema central del pedido** (coordinar sin chocar) |

**Mi objeción, explícita, a la tabla editable como primer paso:** el
enunciado la presenta como la vista "A" (primera de la lista). La cuestiono
por dos razones concretas:

1. **El costo real es alto.** No hay ninguna pieza para reutilizar (a
   diferencia de Día/Semana, que reutilizan datos ya cargados por
   `getEventos()` y solo cambian el layout). Pegado desde Excel con vista
   previa/validación y navegación por teclado tipo hoja de cálculo es, en la
   práctica, escribir un mini-Excel — o adoptar una librería nueva con su
   propia curva de aprendizaje y superficie de bugs.
2. **El volumen no lo justifica todavía.** El equipo descrito es 1 Jefa + 1
   Gobernador + ~5 personas de apoyo. Con probablemente 5-20 eventos/día,
   el cuello de botella de "organizar una jornada real" no es cuántas filas
   se pueden tipear por minuto — es **ver de un vistazo si algo choca** y
   **saber quién coordina qué**. Eso lo resuelve mejor una vista Semana con
   el detector de conflictos ya existente que una grilla de edición masiva.

**Propuesta de orden (utilidad/esfuerzo), sujeta a que la validación con la
Jefa —§10— la confirme o la corrija:**

1. Ficha del evento con estado + campos nuevos (base de todo lo demás) — **esencial**.
2. Vista Día en grilla horaria (reutilizable para "Mi jornada" del Gobernador
   y para "preparar la jornada" de la Jefa) — **esencial**.
3. Vista Semana (mismo componente, generalizado a 7 columnas) — **siguiente
   mejora inmediata**, no el mismo lote que 1-2 pero justo después.
4. Tabla de trabajo simple: lista ordenable/filtrable de eventos con edición
   rápida *de campos puntuales* (estado, prioridad, coordinador) por fila,
   sin pegado ni navegación de hoja de cálculo — cubre el pedido de "Jefa:
   tabla de trabajo" (§6) sin pagar el costo completo de (5) — **siguiente
   mejora**.
5. Tabla con pegado desde Excel y navegación tipo hoja de cálculo completa —
   **futuro**, y solo si la prueba con la Jefa (§10) muestra que de verdad
   la usaría así (por ejemplo, si carga 20+ filas de una sola vez desde su
   Excel actual con frecuencia).

### 5.2 Ficha del evento por etapas

| Etapa | Campos | Obligatorios para... |
|---|---|---|
| **Solicitud** | `titulo`*, `motivo` (nuevo), `organizacion_id` (nuevo, opcional), `contacto_id` (nuevo, opcional), `origen` (nuevo: instrucción / solicitud de organización / coordinación telefónica / invitación / recurrente / otro), `fecha_solicitud` (=`created_at`, ya existe), `fecha_tentativa` (nuevo, opcional, no ocupa el calendario) | **Registrar**: `titulo` + (`organizacion_id` **o** `contacto_id` **o** texto libre en `motivo`) — nada de fecha exigida |
| **Programación** | `fecha_inicio`/`fecha_fin`* (ya existen, ahora nullable hasta `tentativo`), `lugar`* (ya existe), `modalidad` (nuevo: presencial/virtual/híbrida), `participacion_gobernador` (nuevo), `evento_responsables` (invitados internos, ya existe), `evento_participantes_externos` (nuevo), `margen_previo_min`/`margen_posterior_min` (nuevo, enteros simples — ver §8.1 sobre por qué no calculamos traslado real) | **Proponer** (`tentativo`): fecha_inicio+fin. **Confirmar**: + lugar-o-modalidad + `coordinador_id` (ver abajo) |
| **Coordinación** | `coordinador_id`* (nuevo), `prioridad` (nuevo: baja/media/alta, mismo enum que ya usa Despacho en `ItemTareaPrioridad`), pendientes de preparación (no es campo — son `tareas` con `evento_id`, §7.3), confirmaciones (no es campo — se lee de `evento_participantes_externos.confirmado`), `notas_internas` (nuevo, visible solo director+/transversal — filtrado en el service, mismo patrón que `documentos.contenido` nunca sale en `SELECT *`), `nivel_confidencialidad`* (ya existe) | **Confirmar**: `coordinador_id` obligatorio — regla nueva, motivada por la alerta "actividad sin responsable de coordinación" (§8) |
| **Preparación** | `antecedentes` (nuevo, texto), `resultado_esperado` (nuevo, texto — es lo que el Gobernador necesita para llegar informado), adjuntos (`evento_adjuntos`, nuevo, §7.2) | Ninguno obligatorio — se completa progresivamente |
| **Resultado** | `estado` final (`realizado`/`cancelado`/`no_realizado`), `motivo_cierre` (nuevo, obligatorio si no fue `realizado` — mismo patrón que `publicaciones.motivo_rechazo`), acta (`reunion_actas`, ya existe, reutilizable para cualquier evento no solo "reuniones"), compromisos (`compromisos`, ya existe), vínculo con tareas/instrucciones (ya existe vía `tareas.evento_id` propuesto y `instruccion_items.ref_id` existente) | **Cerrar**: `motivo_cierre` si no fue `realizado` |

**Organizaciones y contactos reutilizables:** catálogos ligeros nuevos
(`organizaciones_externas`, `contactos_externos`, detalle en §7.2) para no
reescribir el nombre de la misma ONG/ministerio/persona cada vez — exactamente
lo que pide el enunciado.

---

## 6. Pantallas por persona

Reutiliza el patrón ya existente de "un panel por audiencia" (sidebar con
`roles?: string[]`, `apps/web/src/components/InstitutionalSidebar.tsx:19-20`)
y el patrón agregador de `/pendientes` (`apps/api/src/pendientes/`).

**Jefa de Gabinete** — extiende lo que ya existe (`/agenda`) en vez de crear
una pantalla nueva desde cero:
- Vista Semana (nueva) como entrada principal, con acceso a Mes/Día.
- Tabla de trabajo simple (§5.1 punto 4) para las solicitudes/tentativos.
- Bloque "Solicitudes pendientes" y "Por confirmar" — se resuelve con un
  filtro `estado IN (...)` sobre el mismo endpoint de listar, no hace falta
  una tabla nueva.
- Bloque "Cambios que requieren autorización" — eventos `confirmado` con un
  `UPDATE` reciente hecho por `apoyo` sobre algo que solo `apoyo` puede
  *proponer*, no confirmar (se detecta comparando `estado` actual contra el
  último cambio en `auditoria`, o más simple: un nuevo bucket en
  `/pendientes` — reutiliza el patrón exacto que ya existe para
  Publicaciones/Comunicación en `pendientes.service.ts`).
- Bloque "Preparación incompleta" — conteo de `tareas` abiertas con
  `evento_id` = eventos de los próximos N días.
- Exportar la jornada (ver §7 y §13 del enunciado — PDF/imprimible, marcado
  como siguiente mejora, no esencial para el piloto).

**Gobernador** — pantalla nueva "Mi jornada":
- Reutiliza la vista Día (misma grilla horaria que la Jefa), filtrada a sus
  propios eventos (`evento_responsables` + eventos que él creó), ordenada por
  hora.
- Por cada bloque: lugar, `coordinador_id` (con nombre), participantes
  (`evento_responsables` + `evento_participantes_externos`), `antecedentes` +
  `resultado_esperado`, adjuntos.
- "Cambios recientes relevantes" — reutiliza `notificaciones` filtradas por
  `origen_tipo='evento'` de las últimas N horas, no una tabla nueva.

**Apoyo** — pantalla nueva, pero **reutiliza el patrón de `/pendientes`
al 100%**: agregar un bucket `misEventos` (eventos donde el usuario actual
está en `evento_colaboradores` — trabajo delegado, no `evento_responsables`,
ver §4.1 — con `estado NOT IN ('realizado','cancelado','no_realizado')`) al
`PendientesService` existente, igual que ya se hizo para Comunicación (ver
`project-tech-audit` de memoria — patrón "Lote 3: bucket nuevo en
pendientes"). No hace falta un módulo nuevo para esto.

---

## 7. Relaciones de datos y reutilización entre módulos

### 7.1 Qué se reutiliza sin tocar

`evento_responsables` (invitados internos — participación, nunca edición, ver
§4.1), `reunion_actas`, `compromisos`,
`instruccion_items` (vínculo con Despacho, ya soporta `tipo='evento'`),
`notificaciones` + su patrón sello-trigger-sweep, `pendientes` (agregador),
`auditoria` (registro de cambios), los 7 canales de tiempo real existentes,
`cobertura`/Comunicación (capa sobre `eventos_agenda`, no se toca — ver nota
en §7.3 sobre el único punto de contacto), y el patrón
`instrucciones`/`instruccion_items` de Despacho como **plantilla** (no como
tabla reutilizada literal) para `evento_indicaciones` — ver §4.2.

### 7.2 Tablas nuevas (mínimas, seleccionadas por lo que la fila `evento_id`
ya resuelve del resto del modelo)

| Tabla | Para qué | RLS propuesta |
|---|---|---|
| `organizaciones_externas` (id, nombre, categoría, activa) | Catálogo reutilizable | Sin RLS especial — visible a cualquier autenticado, mismo criterio que `secretarias` |
| `contactos_externos` (id, organizacion_id nullable, nombre, cargo, medio_contacto, activo) | Catálogo reutilizable — **el registro "vivo"**, se puede actualizar libremente | Igual que arriba |
| `evento_participantes_externos` (evento_id FK CASCADE, contacto_id nullable, `nombre_snapshot`, `cargo_snapshot`, `organizacion_snapshot`, `confirmado`, `confirmado_por`, `confirmado_at`, `medio_confirmacion`, `notas`) | Externos sin cuenta de sistema + confirmación como dimensión separada + **historia congelada** (ver abajo) | `EXISTS` directo contra la visibilidad del evento (`fn_evento_visible_para_actual`) — **sin** riesgo de recursión, porque a diferencia de `evento_responsables`, esta tabla nunca la consulta `eventos_select` para decidir visibilidad |
| `evento_colaboradores` (evento_id FK CASCADE, usuario_id FK, asignado_por, asignado_at) | Trabajo delegado — distinto de participación, ver §4.1 | INSERT/DELETE: `fn_evento_editable_por_actual`. SELECT: igual que `evento_responsables_select` |
| `evento_adjuntos` (id, evento_id FK CASCADE, `indicacion_id` FK nullable, tipo `documento/imagen/audio`, nombre_archivo, mime, tamano_bytes, contenido bytea, descripcion, subido_por, created_at) | Documentos/imágenes/audio del evento **y** de una indicación del Gobernador (§4.2) | Copia exacta del patrón de `item_evidencias` (`016_despacho_validacion.sql`), heredando de `fn_evento_visible_para_actual`/`fn_evento_editable_por_actual` ya existentes |
| `evento_indicaciones` (id, evento_id FK CASCADE, tipo, autor_id, texto, `fecha_propuesta_inicio`/`fin`, estado, atendida_por/at, resultado_nota) | Que el Gobernador indique sin editar directo — detalle completo en §4.2 | INSERT: solo `gobernador`/`admin`. SELECT: `autor_id=yo` o `jefe_gabinete`/`admin`. UPDATE (resolverla): solo `jefe_gabinete`/`admin` |

**Snapshot de contacto — decidido (ya no es pregunta abierta):** `nombre_snapshot`/
`cargo_snapshot`/`organizacion_snapshot` se copian desde `contactos_externos`/
`organizaciones_externas` **en el momento en que se agrega el participante al
evento** (copy-on-write, no una referencia viva). Actualizar
`contactos_externos.cargo` más adelante **no** toca ninguna fila ya creada en
`evento_participantes_externos` — son columnas de texto planas, no hay
trigger de propagación ni FK que arrastre el cambio hacia atrás. Antes de que
el evento pase a `realizado`, quien coordina puede pedir explícitamente
"actualizar desde el contacto" (una acción, no algo automático) si el dato
cambió antes de la reunión; una vez `realizado`, un trigger
`BEFORE UPDATE` (mismo estilo que `fn_validar_edicion_compromiso`) bloquea
tocar las columnas `_snapshot` — el registro de "quién participó y con qué
cargo" queda fijo igual que un acta. Nota de consistencia interna: el sistema
hoy **no** hace este congelado para `usuarios` en Auditoría (rol/área que
muestra `obtener(id)` es el actual, no el histórico) — para contactos
externos sí se pide, y con razón: a diferencia de un cambio de rol interno
(que pasa por `AdminService` y queda auditado), un cambio de cargo en una
organización externa no pasa por el sistema en absoluto, así que la única
forma de no perderlo es congelarlo en el momento.

### 7.3 Columnas nuevas en tablas existentes (todas nullable/con default —
mismo estilo que `027_agenda_automatica.sql`, nunca rompe filas existentes)

- `eventos_agenda`: `estado` (default `'confirmado'`), `origen`,
  `participacion_gobernador`, `coordinador_id`, `prioridad`, `notas_internas`,
  `modalidad`, `margen_previo_min`, `margen_posterior_min`, `antecedentes`,
  `resultado_esperado`, `motivo_cierre`, `organizacion_id`, `contacto_id`,
  `fecha_tentativa`. Y **relajar** `fecha_inicio`/`fecha_fin` a `NULLABLE`
  (con un `CHECK` nuevo: ambas nulas o ninguna, y `fecha_fin >= fecha_inicio`
  cuando existen) — es el único cambio no-aditivo, y solo afecta a filas en
  estado `solicitud`.
- `tareas`: `evento_id` (FK nullable a `eventos_agenda`, `ON DELETE SET
  NULL`) — para que "pendientes de preparación de un evento" sean tareas
  reales del módulo Tareas ya existente, no una lista nueva. Esto también
  resuelve gratis la alerta "eventos próximos con preparación incompleta"
  (§8) con un `COUNT` sobre `tareas` filtradas por `evento_id`.

**Único punto de contacto con Comunicación (que no se toca):** `cobertura`
tiene `evento_id UNIQUE` — un evento en estado `solicitud` (sin fecha) técnicamente
podría pedir cobertura hoy sin que nada lo impida a nivel de esquema. Vale la
pena, cuando se implemente, exigir en el service que `estado` sea al menos
`tentativo` antes de permitir `POST /comunicacion` (una condición nueva en
`ComunicacionService.pedir()`, no un cambio de esquema).

---

## 8. Reglas de alertas, notificaciones y adjuntos

### 8.1 Cruces y márgenes

- Cruce de horario del Gobernador: **ya implementado como aviso no
  bloqueante** (`buscarConflictos`, ver §2.1) — falta cerrar la brecha de
  RLS de §4.4.
- Conflictos de participantes internos/salas: **no modelados** (no hay tabla
  de salas/recursos). Coincido con el enunciado en no prometerlo: se puede
  extender `buscarConflictos` a "conflicto de agenda de un invitado interno
  específico" (cruzar contra los eventos donde ese `usuario_id` está en
  `evento_responsables`) sin tabla nueva — **siguiente mejora**, no esencial.
- Margen de traslado: **márgenes explícitos** (`margen_previo_min`,
  `margen_posterior_min`, enteros que carga quien programa), nunca un cálculo
  de distancia/tráfico real — tal como pide el enunciado.
- Día completo / cruce de medianoche: la base ya lo permite; falta la UI
  (toggle "todo el día" + selector de fecha de fin independiente) —
  **siguiente mejora**, prioridad a confirmar con la muestra de Excel (si
  la Jefa nunca carga actividades de varios días, no vale la pena ahora).
- Recurrencia: **futuro** — necesitaría `serie_id` + regla + semántica de
  "editar una ocurrencia vs. la serie", que es una pieza de diseño en sí
  misma; no se fuerza en el piloto.
- Zona horaria institucional: formalizar `America/La_Paz` como una constante
  compartida (`INSTITUTIONAL_TZ`) en vez de las 2 copias hardcodeadas
  actuales — barato, y evita que una tercera feature nueva la vuelva a copiar.

### 8.2 Matriz de notificaciones (nuevas, siguiendo el patrón ya establecido
de "sello + trigger `AFTER` `SECURITY DEFINER` + sweep horario")

| Evento disparador | Destinatario | Mensaje | Enlace | Recordatorio/escalamiento | Anti-duplicado |
|---|---|---|---|---|---|
| Solicitud creada | `apoyo`/`jefe_gabinete` (según a quién se asigne) | "Nueva solicitud: {titulo}" | `/agenda?evento=:id` | Sweep horario si sigue en `solicitud` >48h (reutiliza el patrón de `fn_publicaciones_sweep`) | columna `solicitud_recordada_at` |
| Pasa a `tentativo` con fecha | Gobernador (si `participacion_gobernador='prevista'`) | "Posible actividad: {titulo} · {fecha}" | `/agenda?evento=:id` | — | trigger `AFTER UPDATE OF estado` |
| Confirmado | Coordinador, invitados internos, Gobernador (si aplica) | "Confirmado: {titulo} · {fecha} · {lugar}" | `/agenda?evento=:id` | — | ya cubierto por `fn_notify_eventos` existente, solo agrega destinatarios |
| Reprogramado (evento `confirmado`) | Los mismos + quien lo había confirmado | "Reprogramado: {titulo} — antes {fecha_vieja}, ahora {fecha_nueva}. Motivo: {motivo}" | `/agenda?evento=:id` | — | trigger sella `reprogramado_at`-style, mismo patrón que `027` |
| Cancelado / no realizado | Coordinador, invitados, Gobernador | "{titulo} fue cancelado. Motivo: {motivo}" | `/agenda?evento=:id` | — | — |
| Sin responsable de coordinación a <48h de la fecha | `jefe_gabinete` | "{titulo} no tiene coordinador asignado" | `/agenda?evento=:id` | Se resuelve **sin sweep nuevo**: un cálculo en `/pendientes` en el momento de leer (mismo truco que evita crear un cron para "solicitudes viejas", ver abajo) | — |
| Recordatorio 24h/2h/15m | Ya implementado | Ya implementado | Ya implementado | Ya implementado | Ya implementado (`027`) |

**Nota importante que agrego al pedido:** no todas las alertas de "tiempo
estancado" necesitan un `@Cron` nuevo. El sistema ya tiene tres sweeps
(`DespachoSweepService`, `PublicacionesSweepService`, `VencimientosSweepService`,
más el nuevo `AgendaAutomationService`) — cada uno con su propio
`pg_try_advisory_lock`. Para alertas que solo se muestran en un panel (como
"solicitudes con más de 3 días sin respuesta" en la bandeja de la Jefa), es
más simple calcularlas **al leer** (`WHERE estado='solicitud' AND created_at <
now() - interval '3 days'` dentro de `PendientesService`) que sumar un quinto
proceso en segundo plano. Reservo los sweeps nuevos solo para lo que
**necesita empujar una notificación proactiva** (alguien que no está mirando
la pantalla en ese momento).

### 8.3 Sockets con autorización vieja — segundo hallazgo de seguridad

> **Hallazgo [verificado en código]:** `RealtimeGateway.handleConnection()`
> (`realtime.gateway.ts:34-71`) lee el rol/secretaría del usuario **una sola
> vez, al conectar el socket**, y los guarda en `client.data.user`. Cuando
> `AdminService` revoca sesiones al desactivar un usuario o cambiarle el rol
> (`admin.service.ts:163,186,199` → `revocarSesiones()`), esto sí corta el
> HTTP al instante (`JwtStrategy.validate` reconsulta la base en cada
> request), **pero no desconecta los sockets ya abiertos**. El método
> `getAuthenticatedSockets()` (`realtime.gateway.ts:77-81`) que permitiría
> hacerlo **existe y ya se usa** desde `PgListenerService` para repartir
> eventos — solo falta invocar `.disconnect(true)` sobre los sockets del
> usuario afectado.

Esto contradice directamente el pedido ("los sockets no deben conservar
autorizaciones antiguas"), y es relevante para este pedido en particular
porque el nuevo rol `apoyo` va a tener changes de alcance más frecuentes
(alguien deja de ser apoyo, o dos personas de apoyo cambian de asignación)
que los roles actuales. **Propuesta de esfuerzo bajo:** en
`AdminService.revocarSesiones()`, además de marcar `sesiones.revocada_at`,
emitir un `pg_notify('sesiones_revocadas', {usuarioId})` (mismo mecanismo que
ya usan los otros 7 canales) que `PgListenerService` escuche para llamar
`gateway.getAuthenticatedSockets().filter(...).forEach(s => s.disconnect(true))`.
Clasificación: **esencial**, porque es una brecha de seguridad real, no un
"nice to have" de producto — debería entrar en el primer lote técnico
independientemente de la prioridad de negocio de Agenda.

### 8.4 Adjuntos (documentos, imágenes, audio)

- Documentos/imágenes: mismo patrón ya usado 2 veces (`evento_adjuntos`,
  §7.2) — subir, listar sin `contenido`, descargar validando contra
  `fn_evento_visible_para_actual`, tope 10MB (mismo `MAX_BYTES` que ya usan
  `documentos.controller.ts`/`despacho.controller.ts`, propuesto como punto
  de partida, no una decisión nueva).
- Audio: grabar con `MediaRecorder`/`getUserMedia` en el navegador (no existe
  hoy en ningún componente — es la única pieza de este punto que es 100%
  nueva, sin patrón previo en el repo). Alternativa si no hay
  micrófono/permiso denegado: adjuntar un archivo de audio ya grabado (mismo
  input de archivo que documentos). Reproducción con duración/avance: un
  `<audio controls>` nativo del navegador alcanza para el piloto — no hace
  falta un reproductor custom.
- Escuchar un audio o ver una imagen **no** marca nada como aprobado o
  confirmado — esas son acciones explícitas separadas (mismo espíritu que
  "asunto y objetivo se mantienen escritos", pedido explícito del enunciado).
- Autor/fecha/clasificación: columnas directas (`subido_por`, `created_at`,
  se puede añadir `nivel_confidencialidad` propio del adjunto si hace falta
  ocultar un audio sensible a alguien que sí ve el evento pero no ese
  adjunto — **siguiente mejora**, no esencial para el piloto).

---

## 9. Plan por lotes pequeños

Cada lote es desplegable solo, no rompe lo anterior, y tiene su propio
criterio de aceptación verificable por HTTP/e2e (mismo estándar que ya usa
todo el historial de commits de esta rama). Los números de lote son
identificadores estables (agrupan por dependencia de contenido); el **orden
de ejecución real** — revisado tras tu pedido de priorizar defectos de acceso
y conflictos antes de ampliar pantallas — es el de la columna "Orden", **no**
el orden numérico de la tabla.

| Orden | Lote | Contenido | Depende de | Clasificación |
|---|---|---|---|---|
| **1º** | **0** | Cerrar el hallazgo de sockets (§8.3) | Nada | **Esencial — primer lote, ver §12** |
| **1º** | **5a** | `fn_disponibilidad_gobernador` + extender `buscarConflictos` (cierra la brecha de §4.4 sobre el Gobernador) — sin columnas nuevas, no depende de ningún otro lote | Nada | **Esencial — primer lote, ver §12** |
| 2º | **1** | Migración: `estado`, `coordinador_id`, `prioridad`, `origen`, `participacion_gobernador`, `notas_internas`, `modalidad`, márgenes, `antecedentes`, `resultado_esperado`, `motivo_cierre` en `eventos_agenda` (todo nullable/default, sin romper filas existentes) + trigger de transición de estado (calcado de `fn_validar_transicion_publicacion`) + `tareas.evento_id`. Tratamiento de datos existentes en §12.8 | Lotes 0/5a no bloquean, pero van primero | Esencial |
| 3º | **1b** | `eventos_update`/`eventos_insert`/`eventos_delete`: sacar a `gobernador` de la rama "siempre permitido", **solo en estas 3 políticas de `eventos_agenda`** (§4.2). Tabla `evento_indicaciones` + trigger de auto-creación de evento placeholder (`tipo='crear'`) + notificaciones. UI: "Mis indicaciones" (Gobernador) y bandeja de indicaciones (Jefa) | Lote 1 (necesita `estado` para el placeholder) | **Esencial — hace cumplir la decisión de §2.4.1** |
| 4º | **2** | Relajar `fecha_inicio`/`fecha_fin` a nullable + endpoint `POST /eventos/solicitudes` (mínimo dato, sin fecha) + bandeja "Solicitudes pendientes" en `/pendientes` | Lote 1 | Esencial |
| 5º | **3** | `organizaciones_externas`, `contactos_externos`, `evento_participantes_externos` (con snapshot, §7.2) + UI para buscar/crear organización y contacto desde la ficha | Lote 1 | Esencial |
| 6º | **4** | Vista Día en grilla horaria (Jefa + "Mi jornada" del Gobernador) | Lote 1 | Esencial |
| 7º | **5b** | `fn_disponibilidad_gabinete` (bloques "ocupado" para `apoyo` sobre lo que no tiene compartido) | Ninguno técnicamente; solo tiene uso junto con el Lote 6 | Esencial |
| 7º | **6** | Rol `apoyo`: migración de rol + tabla `evento_colaboradores` (trabajo delegado, distinto de `evento_responsables`) + `PUT /eventos/:id/colaboradores` + trigger de edición por estado + DTO/enum + sidebar + pantalla "mis eventos" reutilizando `/pendientes` + consumo de `fn_disponibilidad_gabinete` | Lotes 1, 2, 5b | Esencial |
| 8º | **7** | `evento_adjuntos` (documento/imagen) + UI de subida/descarga, con `indicacion_id` nullable para que las indicaciones del lote 1b puedan traer adjuntos | Lotes 1, 1b | Esencial |
| — | **8** | Vista Semana | Lote 4 | Siguiente mejora |
| — | **9** | Notificaciones nuevas de la matriz §8.2 (reprogramación, confirmación, cancelación) | Lotes 1, 6 | Siguiente mejora |
| — | **10** | Grabación/adjunto de audio | Lote 7 | Siguiente mejora |
| — | **11** | Bloqueo optimista (`updated_at` como token) en transiciones sensibles | Lote 1 | Siguiente mejora |
| — | **12** | Tabla de trabajo simple (edición puntual, sin pegado) | Lote 1 | Siguiente mejora |
| — | **13** | Historial de auditoría scoped por evento (función `SECURITY DEFINER` nueva) | Lote 1 | Siguiente mejora |
| — | **14** | Exportación PDF de la jornada / agenda imprimible | Lote 4 | Siguiente mejora |
| — | **15** | Importación desde Excel (mapeo, preview, dedupe) — **mapeo y columnas provisionales hasta tener la muestra real (§11)** | Lotes 1, 2, 3 | Futuro |
| — | **16** | Tabla con pegado desde Excel y navegación tipo hoja de cálculo completa | Lote 12 | Futuro — condicionado a lo que muestre §10 |
| — | **17** | Recurrencia | Lote 1 | Futuro |

**Por qué 0+5a van primero, delante incluso del Lote 1** (que era "el primer
lote recomendado" en la versión anterior de este documento): son defectos de
acceso/conflicto activos en el sistema **tal como está hoy**, no features
nuevas de Agenda — no necesitan ninguna columna nueva ni ningún rol nuevo, no
hay razón para esperar al resto del diseño para cerrarlos. Detalle completo
en §12.

---

## 10. Protocolo de validación con la jefa

Una sesión de ~60-90 min, con datos **anonimizados** (nombres de organización
y personas ficticias, fechas de una semana real ya pasada para que haya
cruces reales que resolver). Se mide, por tarea: **tiempo**, **errores**,
**ayuda pedida**, y **si en algún punto volvió a abrir Excel**.

1. Registrar una solicitud sin horario (organización + motivo, sin fecha).
2. Buscar disponibilidad del Gobernador para esa solicitud (usa la vista
   Semana/Día).
3. Proponer un horario y confirmarlo.
4. Reprogramar un evento ya confirmado (con motivo).
5. Resolver un cruce de horario intencionalmente sembrado en los datos de
   prueba.
6. Preparar la jornada completa de un día del Gobernador (revisar que cada
   bloque tenga coordinador, antecedentes, participantes).
7. Consultar antecedentes de una reunión pasada similar.
8. Registrar un acuerdo (compromiso) desde una reunión ya realizada y
   verificar que aparezca en Tareas del responsable.
9. Repetir el paso 3 **simultáneamente** con una segunda persona (de apoyo)
   en otro dispositivo, sobre el mismo evento, para observar el
   comportamiento del bloqueo optimista (§4.5).
10. Simular una indicación del Gobernador (crear un usuario de prueba con ese
    rol): emitir "reprogramar esta reunión al viernes" y verificar que la
    Jefa la vea en su bandeja, la aplique, y que el Gobernador vea que pasó
    de "pendiente" a "aplicada".

No se afirma nada sobre si el sistema "es mejor" hasta tener estos datos —
tal como pide el enunciado.

---

## 11. Preguntas indispensables y material de Excel

Las cuatro preguntas bloqueantes de la primera versión de este documento
(rol del Gobernador, `tentativo` y cruces, alcance de `apoyo`, snapshot de
contactos) ya se resolvieron — ver §2.4. No queda ninguna pregunta bloqueante
para seguir diseñando. Todavía **no** hay muestra de Excel — mientras llega,
el mapeo de columnas y el diseño detallado del importador (Lote 15) quedan
explícitamente **provisionales**; eso no bloquea nada de lo que sí está
comprobado y acordado en este documento (los lotes de seguridad, permisos y
ficha no dependen del Excel en absoluto).

1. ¿La Jefa de Gabinete trabaja hoy con **una sola** hoja de Excel para todo
   (eventos + reuniones + solicitudes + participantes) o son varias hojas
   relacionadas? Cambia directamente el diseño del import (Lote 15) — es la
   única pregunta que de verdad depende de ver el archivo.

**Material de Excel que se necesita** (anonimizado, sin nombres reales de
funcionarios/organizaciones si tiene información sensible):

- 1-2 semanas representativas, tal como se ven hoy en su hoja, **sin
  limpiar** (para ver cómo maneja huecos, cruces, celdas vacías, texto libre
  en columnas que "deberían" ser estructuradas — eso es exactamente lo que un
  importador tiene que tolerar).
- Si existen, columnas o pestañas de "solicitudes pendientes" separadas de
  "agenda confirmada".
- Cualquier columna que hoy use para "quién coordina" o "prioridad" — para
  confirmar o corregir los nombres que propuse en la ficha (§5.2).

---

## 12. Primer lote recomendado — seguridad de sockets y conflictos del
Gobernador

Con tu pedido de priorizar defectos de acceso/conflicto antes de ampliar
pantallas, este reemplaza a la ficha por etapas como **el primer lote a
implementar** (Lotes 0 + 5a de §9, ejecutados juntos). No agrega ninguna
pantalla nueva ni ningún campo a la ficha — solo cierra dos brechas que ya
existen hoy en el sistema, tal como está, sin esperar el resto del diseño.

### 12.1 Alcance

1. **Sockets con autorización vieja** (hallazgo de §8.3): un usuario cuya
   sesión se revoca (`AdminService.revocarSesiones` al desactivarlo/cambiarle
   el rol, o `AuthService.revocarPorRefresh`/`revocarSesion` al cerrar
   sesión) deja de poder usar la API por HTTP al instante, pero su socket ya
   conectado sigue recibiendo eventos en tiempo real con la autorización con
   la que se conectó, hasta que se desconecta solo.
2. **Conflictos del Gobernador con eventos reservados** (hallazgo de §4.4):
   `EventosService.buscarConflictos()` consulta bajo el RLS de quien
   pregunta, así que un evento confidencial de otra secretaría en el que
   participa el Gobernador no cuenta como cruce para quien no puede verlo.

Ninguno de los dos necesita las columnas nuevas de la ficha (`estado`,
`coordinador_id`, etc.) ni el rol `apoyo` — por eso pueden ir antes de todo
lo demás.

### 12.2 Archivos afectados

**Nuevo (migraciones SQL):**
- Una migración con `fn_disponibilidad_gobernador(p_desde, p_hasta, p_excluir_id)`
  — `SECURITY DEFINER`, `RETURNS TABLE(fecha_inicio timestamptz, fecha_fin timestamptz)`,
  **nunca** selecciona `titulo`/`lugar`/`descripcion`/ninguna otra columna:
  solo el rango horario de los eventos donde el Gobernador es `creado_por` o
  está en `evento_responsables`, sin filtrar por confidencialidad ni
  secretaría (mismo patrón `SECURITY DEFINER` que `fn_evento_visible_para_actual`
  y las otras 6 funciones ya existentes con este propósito).
- Una migración con un trigger `AFTER UPDATE ON sesiones` (`WHEN (NEW.revocada_at
  IS NOT NULL AND OLD.revocada_at IS NULL)`) que hace `pg_notify('sesiones_revocadas',
  json_build_object('usuarioId', NEW.usuario_id)::text)`. Se dispara solo con
  el `UPDATE sesiones SET revocada_at = now()` que **ya hacen hoy**
  `admin.service.ts:206-211`, `auth.service.ts:138-145` y
  `auth.service.ts:158-165` — ninguno de esos tres archivos necesita cambiar
  una sola línea.

**Modificado (backend):**
- `apps/api/src/realtime/realtime.gateway.ts` — agrega un método
  `desconectarUsuario(usuarioId)` que filtra `getAuthenticatedSockets()` (ya
  existe, línea 77) por `socket.data.user.userId` y llama `.disconnect(true)`.
- `apps/api/src/realtime/pg-listener.service.ts` — agrega
  `LISTEN sesiones_revocadas` junto al resto (línea 137) y, en
  `handleNotification`, una rama explícita para ese canal que llama al método
  nuevo del gateway (no encaja en el mapa `CANALES` existente porque no
  "re-consulta una fila", así que se trata aparte en vez de forzar la
  abstracción).
- `apps/api/src/eventos/eventos.service.ts` — `buscarConflictos()` (línea
  61) además consulta `fn_disponibilidad_gobernador` con el mismo rango y
  `excluirId`, y agrega al resultado, por cada bloque que **no** coincide
  exactamente con uno ya visible en la consulta normal, una entrada
  `{ id: null, titulo: null, fecha_inicio, fecha_fin, oculto: true }`. Las
  entradas visibles existentes se marcan `oculto: false` — el campo es
  aditivo, no se quita nada de lo que ya se devolvía.

**Modificado (frontend):**
- `apps/web/src/lib/api.ts` — el tipo de retorno de `buscarConflictosEvento`
  gana el campo `oculto`.
- `apps/web/src/app/(panel)/agenda/page.tsx` (bloque de conflictos, líneas
  915-965) — cuando `conflicto.oculto`, muestra una píldora genérica "Ocupado
  — agenda del Gobernador" en vez de `conflicto.titulo`, y usa una `key`
  sintética (no `conflicto.id`, que viene `null`). Es el único cambio de UI
  de este lote — no se toca el calendario de mes/día ni el formulario.

**No se toca (explícito, tu punto 6):** `admin.service.ts`, `auth.service.ts`,
`eventos.controller.ts`, `conflictos-evento.dto.ts`, `create-evento.dto.ts`/
`update-evento.dto.ts`, `agenda-automation.service.ts`, `027_agenda_automatica.sql`
(recordatorios 24h/2h/15min) — todo esto ya existe y funciona; este lote no
lo reescribe, solo agrega una fuente de datos más a un método que ya existía.

### 12.3 Cambios de comportamiento

| Antes | Después |
|---|---|
| Revocar una sesión corta el HTTP al instante pero dejaba el socket vivo con la autorización de conexión | El socket recibe `disconnect` en el orden de segundos, sin esperar a que se cierre solo |
| `buscarConflictos` solo veía cruces con eventos que el que pregunta puede ver | Además avisa (sin detalle) si el rango se cruza con algo ya agendado del Gobernador, visible o no para quien pregunta |
| — | La lista de conflictos **nunca se achica** por este cambio — solo puede sumar entradas genéricas nuevas |

### 12.4 Tratamiento de datos existentes

No se migra, transforma ni reescribe ningún dato:

- `fn_disponibilidad_gobernador` es de solo lectura (`STABLE`) — desplegarla
  no cambia nada hasta que `buscarConflictos` empiece a invocarla.
- El trigger sobre `sesiones` solo reacciona a la **transición futura**
  `revocada_at` de `NULL` a un valor — sesiones ya revocadas antes de aplicar
  esta migración no lo disparan retroactivamente. No hay una "ola" de
  desconexiones al desplegar; solo se desconecta a partir de la próxima
  revocación real.
- Ninguna fila de `eventos_agenda` cambia de valor ni de forma.

### 12.5 Compatibilidad — API, formularios, calendarios, notificaciones,
permisos

- **API:** mismo endpoint `POST /eventos/conflictos`, mismo body de entrada.
  La única diferencia es el campo `oculto` aditivo en cada elemento de la
  respuesta — por eso el ajuste de `agenda/page.tsx` (único consumidor hoy)
  va en el mismo lote, no como algo posterior: sin él, una entrada oculta se
  renderizaría con título vacío y una `key` de React duplicada (`null`), no
  con un error, pero sí con una fila fea. No hay otros consumidores de este
  endpoint en el repo (verificado: única llamada a `buscarConflictosEvento`
  es la de `agenda/page.tsx:343`).
- **Formularios:** sin cambios de campos ni de validación en ningún DTO.
- **Calendarios (mes/día):** sin cambios — ninguno de los dos consume
  `buscarConflictos` hoy.
- **Notificaciones:** sin cambios de contenido ni de disparadores; el fix de
  sockets solo endurece **cuándo se corta** una conexión ya autenticada, no
  genera notificaciones nuevas.
- **Permisos:** no se toca ninguna política RLS de contenido — a diferencia
  del Lote 1b (que sí achica el permiso de `gobernador`), este lote es 100%
  aditivo en materia de permisos.

### 12.6 Pruebas de aceptación

1. Sembrar un evento `confidencial` de la secretaría A donde participa el
   Gobernador (invitado). Como un usuario de la secretaría B, llamar
   `buscarConflictos` con un rango que se solapa → la respuesta trae una
   entrada `oculto:true`, `titulo:null`, sin el `id` real del evento de A.
2. Mismo escenario, pero el rango **no** se solapa → ninguna entrada oculta.
3. Como `jefe_gabinete` (que sí puede ver ese evento) con el mismo rango → lo
   ve completo (`oculto:false`, con título) y **no** aparece además una
   entrada oculta duplicada para el mismo horario.
4. Inspeccionar `fn_disponibilidad_gobernador` (vía `\df+` o
   `information_schema.routines`) y confirmar que su tipo de retorno no
   incluye ninguna columna de detalle — la protección es estructural, no un
   filtro que se pueda olvidar en un cambio futuro.
5. Conectar un socket autenticado (test con `socket.io-client`), revocar esa
   sesión (`POST /auth/logout` o `admin.service.revocarSesiones` vía
   desactivar el usuario), y verificar que el socket recibe `disconnect`
   dentro de un margen razonable (segundos, no minutos).
6. Con dos usuarios conectados, revocar la sesión de uno solo → el socket del
   otro sigue conectado y recibiendo eventos con normalidad (aislamiento).
7. Regresión: la suite e2e existente (hoy 30/30 según la última verificación
   registrada) sigue en 30/30 sin modificarse ningún test previo — este lote
   solo agrega tests nuevos.

### 12.7 Procedimiento de recuperación

Todo lo que agrega este lote es reversible sin pérdida de datos, porque no
escribe ni transforma ninguna fila existente:

- **Rollback de base de datos:** `DROP FUNCTION fn_disponibilidad_gobernador(...)`
  y `DROP TRIGGER ... ON sesiones` + `DROP FUNCTION` de su función de notify
  — ninguna tabla pierde columnas ni filas.
- **Rollback de aplicación:** revertir el/los commits del lote (backend +
  frontend) por `git revert` y redesplegar; no hay estado en la base que
  limpiar aparte de los objetos SQL de arriba.
- **Mitigación sin redeploy, si el trigger de sockets causara desconexiones
  inesperadas mientras se investiga:** `ALTER TABLE sesiones DISABLE TRIGGER
  <nombre>;` desactiva el aviso al instante sin tocar código ni perder la
  columna `revocada_at` (que sigue funcionando exactamente igual para cortar
  el HTTP); se reactiva con `ENABLE TRIGGER` igual de rápido.
- **Backups:** no hace falta un backup adicional específico para este lote
  (más allá de la rutina ya descrita en `docs/BACKUPS.md`) porque ninguna
  fila existente se modifica.

### 12.8 Qué sigue después de este lote

El Lote 1 (ficha por etapas: `estado`, `coordinador_id`, `prioridad`, etc.
sobre `eventos_agenda`) sigue siendo, dentro de las funcionalidades nuevas de
Agenda, la pieza de la que depende casi todo lo demás (§9) — pero ya **no**
es el primer paso, por lo acordado en esta conversación. Su tratamiento de
datos existentes es igual de simple que el de este lote: es una migración
puramente aditiva (`ALTER TABLE ... ADD COLUMN ... DEFAULT`), Postgres no
ejecuta ningún `UPDATE` sobre las filas existentes al agregar una columna con
`DEFAULT`, así que `fn_evento_reset_recordatorios` (`027_agenda_automatica.sql:20-34`,
que solo reacciona si `fecha_inicio` o `recordatorios_activos` cambian de
valor) **no se dispara** — ningún recordatorio ya emitido se repite ni se
genera uno nuevo por el solo hecho de migrar. La única pieza que si se
recomienda ajustar **en ese momento** (no en este lote) es agregar
`AND estado = 'confirmado'` al `WHERE` de `fn_agenda_recordatorios_sweep`
(`027`, línea 50) y, más adelante, excluir `cancelado`/`no_realizado` de
`fn_disponibilidad_gobernador` — de lo contrario, una vez que existan eventos
`tentativo`/`cancelado`, podrían disparar recordatorios o bloqueos de
disponibilidad que ya no corresponden. Se deja anotado acá para que no se
pierda cuando llegue ese lote, tal como pediste (no reconstruir, pero tampoco
dejar un cabo suelto).
