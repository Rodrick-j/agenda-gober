# Modelo de datos

Texto de acompañamiento de los diagramas entidad-relación
(`diagramas/er-*.puml`). Todo **[verificado en código]** contra
`db/migrations/001` a `026` — no hay generador de esquema ni ORM que lo derive
automáticamente, así que este documento es la única fuente legible del modelo
completo fuera de leer las 26 migraciones una por una.

Postgres 16.4. Ningún `DROP TABLE`/`DROP COLUMN` destructivo en toda la
historia de migraciones — los cambios de organigrama (`014`) se resolvieron
con `UPDATE` + `INSERT ... ON CONFLICT DO NOTHING`, nunca borrando filas que
otras tablas ya referencian.

## 1. Por qué el ER está dividido en 3 archivos

Un solo diagrama con las ~25 tablas del sistema sería ilegible. Se agrupó por
**dominio de negocio**, no por orden de creación:

- [`er-01-identidad-organizacion.puml`](diagramas/er-01-identidad-organizacion.puml) — quién es quién.
- [`er-02-contenido-institucional.puml`](diagramas/er-02-contenido-institucional.puml) — el trabajo del día a día de una secretaría.
- [`er-03-despacho-y-trazabilidad.puml`](diagramas/er-03-despacho-y-trazabilidad.puml) — la cadena de mando y el registro de todo lo anterior.

Las claves foráneas que cruzan de un archivo a otro (por ejemplo,
`publicaciones.secretaria_id → secretarias.id`) se muestran en el diagrama
donde vive la tabla "hija", con la tabla "padre" repetida como referencia
liviana — se indica en cada diagrama cuáles son.

## 2. Identidad y organización

| Tabla | Clave primaria | Notas |
|---|---|---|
| `secretarias` | `id uuid` | Sin RLS — catálogo público para cualquier autenticado. `activa boolean`; las inactivas (`salud`, `educacion`, ver 014) no se borran, solo dejan de listarse como vigentes. |
| `roles` | `id uuid`, `nombre` único | 7 filas fijas: `operador, director, secretario, unicom, jefe_gabinete, gobernador, admin`. `ambito_secretaria boolean` marca si el rol necesita una secretaría. |
| `usuarios` | `id uuid` | Sin RLS (ver `01-proposito-alcance-roles.md` §3.2). `secretaria_id` nullable (NULL en roles transversales). `activo boolean` — las cuentas se desactivan, nunca se borran (romperían `autor_id`, `creado_por`, etc. de todo lo que esa persona creó). `password_hash` puede ser NULL momentáneamente (mig. 004). |
| `usuario_roles` | `id uuid` (mig. 002 lo separó de la PK compuesta original) | `UNIQUE(usuario_id, rol_id, secretaria_id)`. La PK propia existe porque una PK compuesta con `secretaria_id` hubiera forzado esa columna a `NOT NULL`, y los roles transversales la necesitan NULL. |
| `sesiones` | `id uuid` | Sin RLS (se consulta antes de que exista contexto). `refresh_hash` (SHA-256 del refresh token, nunca el token en claro), `expira_at`, `revocada_at`. Índice parcial `WHERE revocada_at IS NULL`. |

**Relaciones clave:** un `usuario` tiene 1..N filas en `usuario_roles` (el
código siempre trabaja con "la primera por `secretaria_id NULLS LAST`", es
decir, en la práctica un usuario tiene un rol activo a la vez, pero el modelo
no lo impide con una restricción `UNIQUE(usuario_id)`). Cada `sesion`
pertenece a un `usuario`.

## 3. Contenido institucional (el trabajo diario)

| Tabla | Clave primaria | RLS | Notas |
|---|---|---|---|
| `publicaciones` | `id uuid` | Secretaría + rango vs. `nivel_confidencialidad` | Máquina de estados (`estado`) con columnas de sello agregadas en `021`/`025`: `enviado_revision_at`, `aprobado_por/at`, `publicado_por/at`, `motivo_rechazo`, `revision_recordada_at`, `revision_escalada_at`, `publicado_recordado_at`. |
| `documentos` | `id uuid` | Hereda de `publicaciones` vía `EXISTS` | `contenido bytea NOT NULL`; nunca se expone en `SELECT *`, los services siempre listan columnas explícitas sin `contenido`. |
| `eventos_agenda` | `id uuid` | Secretaría+rango, o invitado (`evento_responsables`) | `secretaria_id NULL` = evento transversal. `CHECK (fecha_fin >= fecha_inicio)`. |
| `evento_responsables` | `(evento_id, usuario_id)` | Ver `fn_evento_visible_para_actual` (SECURITY DEFINER, rompe recursión) | Es la tabla de invitados; también la consulta Despacho para saber a quién avisar. |
| `reunion_actas` | `evento_id uuid` (**la PK es la FK**, no hay `id` propio) | `fn_evento_visible_completo` (distinta de la de arriba: sí incluye la vía de invitado) | Upsert puro — sin historial de versiones (se sobreescribe). Esto obligó a una función de auditoría dedicada (`fn_auditoria_reunion_actas`), porque la genérica asume que toda tabla tiene columna `id`. |
| `compromisos` | `id uuid` | Responsable del compromiso, o quien ve el evento completo | `estado compromiso_estado` (`pendiente`/`cumplido`), `cumplido_at`, `venc_recordado_at`/`venc_vencida_at` (agregadas en `022`/`024`). |
| `tareas` | `id uuid` | Secretaría+rango, o asignado (`tarea_asignados`, solo su `estado`) | `completada_at`, `venc_recordado_at`/`venc_vencida_at` (agregadas en `023`/`024`). |
| `tarea_asignados` | `(tarea_id, usuario_id)` | Ver `fn_tarea_visible_para_actual` (mismo patrón anti-recursión) | El *diff* al reemplazar asignados (en vez de borrar-y-recrear) es lo que permite notificar solo a los realmente nuevos (`fn_tarea_asignado_notify`, trigger `AFTER INSERT`). |
| `proyectos` | `id uuid` | Secretaría+rango; editar exige `director`+ | Sin tabla de colaboradores — un proyecto pertenece a una sola secretaría (a diferencia de Agenda/Tareas). |
| `cobertura` | `id uuid`, `evento_id` **UNIQUE** (1:1 con el evento) | `unicom`/transversal gestionan; la secretaría dueña del evento mira, vía `fn_evento_de_mi_secretaria` | Capa sobre `eventos_agenda`, no una tabla de eventos nueva. `gabinete_visto_at`/`gabinete_por` solo los puede setear un rol transversal (trigger `fn_cobertura_sello`, no RLS por columna — RLS no distingue columnas). `publicacion_id` FK opcional hacia `publicaciones` (la nota que salió de esa cobertura). |

**Patrón repetido en todo este bloque:** cuando una tabla necesita que alguien
la vea "por estar invitado/asignado" sin pertenecer a la secretaría dueña, la
vía de invitado se implementa con una función `SECURITY DEFINER` en vez de un
`EXISTS` directo contra la tabla padre — porque la tabla padre **también**
consulta la tabla de invitados (para su propia vía de invitado), y un `EXISTS`
directo en ambos sentidos genera `infinite recursion detected in policy`. Esto
está documentado explícitamente en `008_eventos_agenda.sql` como "bug real que
encontré armando esto" y se repitió a propósito (mismo patrón) en `009`, `011`,
`016` y `026`.

## 4. Despacho y trazabilidad

| Tabla | Clave primaria | RLS | Notas |
|---|---|---|---|
| `instrucciones` | `id uuid` | Solo transversales ven/crean/editan | `avance_porcentaje` y `en_riesgo` son **calculadas**, nunca se editan a mano (las pisa `fn_despacho_recalcular`, que corre `SECURITY DEFINER` disparada por triggers). `client_token` (único, nullable) des-duplica un "Emitir" con doble clic. |
| `instruccion_items` | `id uuid` | Transversal, o responsable de la tarea que referencia (`fn_item_accesible_para_actual`) | `ref_id` es una FK "floja" (sin `REFERENCES` declarado) hacia `eventos_agenda`/`tareas`/`proyectos` según `tipo` — el motivo es que un ítem puede apuntar a cualquiera de las tres tablas y Postgres no tiene FK polimórfica nativa; la integridad la sostiene la aplicación + el hecho de que `ON DELETE CASCADE` sí está declarado sobre `instruccion_id`. `estado_validacion`, `peso` (1-5, para el promedio ponderado) y `motivo_devolucion` se agregaron en `016`. |
| `item_evidencias` | `id uuid` | Hereda de `instruccion_items` vía la misma función | `contenido bytea` (igual patrón que `documentos`). |
| `instruccion_bitacora` | `id uuid` | Solo transversales leen; insertan solo triggers + la API en contexto transversal | Registro **legible** (`accion` en texto: `emitida`, `tomada`, `validacion_solicitada`, `devuelto`, `cumplida`, `reabierta`...) — complementa, no reemplaza, a `auditoria` (que guarda el diff crudo de columnas). |
| `vistos` | `(entidad_tipo, entidad_id, usuario_id)` | Cada quien inserta/lee lo propio; transversales leen todo | Genérica a propósito (`entidad_tipo` como texto): hoy solo `'instruccion'`, pensada para reusarse en otra entidad sin migración nueva. Columnas `abierto_at`/`acuse_at` separan "abrió el detalle" de "confirmó enterado". |
| `notificaciones` | `id uuid` | **Por `usuario_id`**, no por secretaría — la única tabla así en todo el sistema | La escriben exclusivamente funciones `SECURITY DEFINER` (el usuario normal solo tiene `GRANT SELECT, UPDATE`, nunca `INSERT`); el usuario únicamente marca las suyas como leídas. |
| `auditoria` | `id bigint` (identity) | Solo `gobernador`/`jefe_gabinete`/`admin` leen; insertan solo triggers | Poblada por triggers `AFTER` sobre ~15 tablas (`fn_auditoria_publicaciones` es genérica y se reusa en la mayoría; `reunion_actas`, `usuarios`, `documentos`, `item_evidencias` tienen su propia función porque necesitan excluir una columna sensible o no tienen `id`). Nunca se actualiza ni se borra — solo `INSERT`. |

**El circuito de automatización que se repite en Publicaciones, Tareas,
Reuniones y el barrido de Vencimientos** (agregado en las migraciones `020`
a `025`, la parte más reciente del sistema) sigue siempre la misma forma:

1. Un trigger `BEFORE UPDATE` sella una fecha (`aprobado_at`, `completada_at`,
   `cumplido_at`...) cuando la fila entra a cierto estado, y la limpia si sale
   de él o si cambia la fecha de vencimiento (para que un reprogramado "rearme"
   el aviso).
2. Un trigger `AFTER INSERT/UPDATE`, `SECURITY DEFINER`, inserta en
   `notificaciones` para el destinatario correcto — nunca para "todo el mundo".
3. Un barrido horario (ver §2.3 de `02-arquitectura-modulos.md`) revisa lo que
   quedó estancado y usa una columna `*_recordado_at`/`*_escalado_at` para no
   repetir el aviso.

Ver el estado de cada entidad en
[`diagramas/estados-publicacion.puml`](diagramas/estados-publicacion.puml),
[`diagramas/estados-instruccion.puml`](diagramas/estados-instruccion.puml),
[`diagramas/estados-instruccion-item.puml`](diagramas/estados-instruccion-item.puml),
[`diagramas/estados-cobertura.puml`](diagramas/estados-cobertura.puml) y
[`diagramas/estados-tarea-compromiso.puml`](diagramas/estados-tarea-compromiso.puml).

## 5. Por qué no hay un diagrama de clases de dominio

**[propuesta implícita: no forzarlo — con la justificación de por qué]**. El
enunciado original pide diagramas de clases "cuando aporten información
adicional y representen estructuras reales del código". Este backend no tiene
un modelo de objetos de dominio: no hay ORM, no hay clases `Publicacion`,
`Tarea`, etc. con métodos — cada `*.service.ts` de NestJS es un conjunto de
funciones sin estado que arman SQL y lo mandan a `TxService`, y las reglas de
negocio (máquinas de estado, validaciones que cruzan columnas) viven en
funciones y triggers de PL/pgSQL, no en clases TypeScript. Dibujar un diagrama
de clases ahí sería inventar una estructura orientada a objetos que el código
no tiene. Los DTOs (`class-validator`) sí son clases reales, pero son
contratos de entrada HTTP (forma y tipo), no un modelo de dominio — su
información ya está cubierta en la tabla de rutas de cada módulo
(`02-arquitectura-modulos.md`) y en las columnas del ER. El sustituto correcto
de "estructura interna" en este sistema es el ER (para los datos) + el diagrama
de componentes (para los módulos) + los diagramas de secuencia/actividad (para
el comportamiento) — que sí están.
