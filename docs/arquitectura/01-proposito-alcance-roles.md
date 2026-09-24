# Propósito, alcance y roles

## 1. ¿Qué problema busca resolver?

**[inferencia]** — no hay un documento de "visión del producto" en el repositorio;
esto se deduce del nombre del sistema, el organigrama modelado en
`db/migrations/014_secretarias_reales.sql` (10 secretarías reales de la
Gobernación de Oruro + una unidad de Comunicación) y de la secuencia en que se
construyeron los módulos (ver `git log` y los comentarios de cada migración).

AGENDA.GOBER es un **sistema interno de gestión y coordinación institucional**
para un gobierno subnacional (una Gobernación departamental, con Secretarías
como sus unidades). Resuelve tres problemas concretos:

1. **Aislamiento de información entre secretarías** — cada secretaría necesita
   gestionar su propia agenda, publicaciones, tareas y proyectos sin que otra
   secretaría (que no debería) pueda leerlos, pero el Gobernador y su Gabinete sí
   necesitan ver todo. Esto se resuelve con controles de acceso a nivel de fila en
   la base de datos (Row Level Security), no solo con lógica de aplicación — ver
   `apps/api/README.md` y el `README.md` raíz, y verificado en cada migración.
2. **Cadena de mando y seguimiento (Despacho)** — el Gobernador emite
   instrucciones que Gabinete debe desglosar en trabajo concreto (tareas, eventos,
   proyectos existentes) de las secretarías, con validación de cierre y
   trazabilidad de quién hizo qué. Ver `db/migrations/015`–`018` y
   `apps/api/src/despacho/`.
3. **Comunicación institucional coordinada** — la Unidad de Comunicación (UNICOM)
   necesita saber qué actividades de las secretarías requieren cobertura
   (prensa/redes/transmisión) y coordinar con Gabinete el visto bueno de la línea
   de mensaje. Ver `db/migrations/026_comunicacion.sql`.

Sobre esa base, el sistema fue creciendo con módulos operativos de uso diario
(Publicaciones, Agenda, Reuniones, Tareas, Proyectos) y módulos de agregación
para la conducción (Gabinete, Indicadores, Auditoría, "Mi bandeja").

## 2. Objetivo general **[inferencia, con evidencia directa]**

Dar a cada persona de la Gobernación **una sola pantalla de trabajo** que le
muestre exactamente lo que le corresponde ver y hacer según su secretaría y su
rol, sin necesidad de pedirle a nadie más ni de confiar en que la aplicación
"se acuerde" de ocultar algo — la restricción vive en la base de datos, así que
ni un bug de la API ni una consulta SQL directa (por ejemplo, desde una
herramienta de administración) puede filtrar información fuera de su alcance.
Esto está **[verificado en código]**: el usuario de aplicación (`app_user`)
nunca es superusuario ni tiene `BYPASSRLS` (ver `infra/docker/migrate-entrypoint.sh`
línea de `CREATE ROLE ... NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`), y
cada tabla de negocio tiene `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL
SECURITY` (esto último es clave: sin `FORCE`, el dueño de la tabla —quien corrió
la migración— igual vería todo; con `FORCE`, ni siquiera el dueño escapa a las
políticas cuando se conecta como `app_user`).

## 3. Quiénes lo usan y qué puede hacer cada rol

Hay **7 roles** en la tabla `roles` (`db/migrations/001_init_schema.sql` +
`026_comunicacion.sql`). Los primeros tres están **atados a una secretaría**
(`ambito_secretaria = true`); los otros cuatro son **transversales** (ven y
actúan a través de todas las secretarías, cada uno con su propio recorte):

| Rol | Ámbito | Rango interno | Quién es **[inferencia]** |
|---|---|---|---|
| `operador` | Su secretaría | 1 (el más bajo) | Personal operativo de una secretaría — carga contenido, ejecuta tareas asignadas. |
| `director` | Su secretaría | 2 | Mando medio — aprueba/edita dentro de su secretaría. |
| `secretario` | Su secretaría | 3 (el más alto de los 3) | Máxima autoridad de una secretaría — único que puede publicar comunicados. |
| `unicom` | Transversal (comunicación) | — | Unidad de Comunicación — ve la agenda institucional (no lo confidencial de otras áreas) y gestiona la cobertura de eventos. |
| `jefe_gabinete` | Transversal | — | Coordina el Gabinete — organiza y valida el trabajo que el Despacho reparte a las secretarías. |
| `gobernador` | Transversal | — | Emite instrucciones de Despacho, ve todo, reabre instrucciones cerradas. |
| `admin` | Transversal (solo sistema) | — | Súper administrador — gestiona cuentas/roles/secretarías. **A propósito no ve contenido estratégico** (ver más abajo). |

El "rango" (`rol_rango()`, `db/migrations/005_permisos_finos.sql`) sólo aplica
a los 3 roles de secretaría: `operador(1) < director(2) < secretario(3)`. Un
nivel de confidencialidad (`publica`/`interna` → rango 1, `reservada` → 2,
`confidencial` → 3, `nivel_rango()`) exige que tu rango sea igual o mayor para
ver/crear/editar esa fila. Los 4 roles transversales no tienen techo: cada
política RLS los deja pasar sin comparar rangos.

**Por qué `admin` está separado de "transversal con acceso total"
[documentado, verificado]:** `apps/api/README.md` lo explica y el código lo
confirma — `admin` puede gestionar usuarios (`/admin/usuarios`,
`/admin/secretarias`) pero **no** aparece en las políticas RLS de contenido
salvo como alias de "acceso total" en varias de ellas (`gobernador`,
`jefe_gabinete`, `admin` juntos). Es decir: `admin` sí puede leer todo el
contenido (estas políticas lo incluyen), pero quien administra cuentas
(`admin`) es una persona distinta de quien dirige la Gobernación (`gobernador`)
o coordina el gabinete (`jefe_gabinete`) — la separación es organizacional,
reforzada por el hecho de que **solo `admin`**, no `gobernador` ni
`jefe_gabinete`, pasa el `RolesGuard('admin')` de `/admin/usuarios` (verificado
con `curl` según el propio README).

### 3.1 Matriz de capacidades por módulo

`Sí` = puede hacerlo. `Sí¹` = puede hacerlo pero **solo dentro de su propia
secretaría** y sin superar el nivel de confidencialidad que su rango permite.
`Ver` = solo lectura. `—` = no accesible (RLS deniega por defecto: la fila ni
figura, no es un error 403 en la mayoría de los módulos de contenido).

| Módulo | operador | director | secretario | unicom | jefe_gabinete | gobernador | admin |
|---|---|---|---|---|---|---|---|
| Publicaciones — crear/pedir revisión | Sí¹ | Sí¹ | Sí¹ | — | Sí | Sí | Sí |
| Publicaciones — aprobar | — | Sí¹ | Sí¹ | — | Sí | Sí | Sí |
| Publicaciones — publicar | — | — | Sí¹ | — | Sí | Sí | Sí |
| Agenda — ver/crear | Sí¹ | Sí¹ | Sí¹ | Ver (no confidencial) | Sí | Sí | Sí |
| Agenda — editar/borrar | — | Sí¹ | Sí¹ | — | Sí | Sí | Sí |
| Reuniones (acta/compromisos) — editar | — | Sí¹ | Sí¹ | — | Sí | Sí | Sí |
| Reuniones — cerrar mi propio compromiso | Sí (el mío) | Sí (el mío) | Sí (el mío) | — | Sí | Sí | Sí |
| Tareas — ver/mover mi asignada | Sí (la mía) | Sí (la mía) | Sí (la mía) | — | Sí | Sí | Sí |
| Tareas — crear/editar completa | Sí¹ | Sí¹ | Sí¹ | — | Sí | Sí | Sí |
| Proyectos — ver | Sí¹ | Sí¹ | Sí¹ | — | Sí | Sí | Sí |
| Proyectos — editar/avance | — | Sí¹ | Sí¹ | — | Sí | Sí | Sí |
| Comunicación — pedir cobertura | — | Sí¹ | Sí¹ | Sí | — | — | — |
| Comunicación — planificar cobertura | — | — | — | Sí | Ver | Ver | — |
| Comunicación — dar visto de Gabinete | — | — | — | — | Sí | Sí | — |
| Despacho — emitir instrucción | — | — | — | — | — | Sí | — |
| Despacho — organizar/validar ítems | — | — | — | — | Sí | Sí (+reabrir) | — |
| Despacho — mi ítem (evidencia/pedir validación) | Sí (el mío) | Sí (el mío) | Sí (el mío) | — | — | — | — |
| Gabinete (panel agregado) | — | — | — | — | Sí | Sí | Sí* |
| Indicadores | Sí¹ (su reflejo) | Sí¹ | Sí¹ | — | Sí | Sí | Sí |
| Auditoría | — | — | — | — | Sí | Sí | Sí |
| Admin — usuarios/secretarías | — | — | — | — | — | — | Sí |
| Mi bandeja (`/pendientes`) | Sí (lo suyo) | Sí (lo suyo) | Sí (lo suyo) | Sí (su cola) | Sí (lo suyo) | Sí (lo suyo) | Sí (lo suyo) |

`Sí*` en Gabinete/admin: **[verificado en código]** la ruta no lo bloquea a
nivel de RLS (el SQL de `gabinete.service.ts` no filtra por rol), pero el
frontend oculta el panel a quien no sea transversal según `rangoDeRol(rol) >=
99` — y `admin` sí cuenta como transversal ahí. Es un panel de solo lectura
agregado, así que no hay nada que proteger más allá de qué secretaría ve sus
propios números reflejados.

### 3.2 Qué es un candado real y qué es solo un botón oculto

Esta distinción es la más importante del sistema y está **[verificado en
código]** en cada módulo:

- **Candado real** = una política de Row Level Security en Postgres, o un
  trigger `BEFORE UPDATE`/`BEFORE INSERT` que revienta la transacción entera con
  `RAISE EXCEPTION`, o el `RolesGuard` de NestJS (solo para `/admin/*`, ver
  abajo). Estos se cumplen **aunque la petición no venga del frontend** — por
  ejemplo, contra la API con `curl` y una cookie de sesión válida, o mediante
  una consulta SQL directa hecha con las credenciales de `app_user`.
- **Botón oculto** = una condición en el JSX/TSX del frontend
  (`apps/web/src/lib/roles.ts`, `rangoDeRol(...)`) que **solo evita mostrar un
  control que el backend igual rechazaría**. El propio comentario del archivo lo
  dice: *"No es la autorización real -- eso lo decide siempre Postgres (RLS +
  trigger). Esto únicamente evita mostrar botones que el backend va a rechazar
  de todas formas."*

Únicas excepciones donde la barrera real **no** es una política RLS:

| Excepción | Por qué | Dónde |
|---|---|---|
| `usuarios` / `usuario_roles` no tienen RLS | `AuthService.login()` los consulta con el pool crudo, **antes** de que exista ningún contexto de sesión que una política pudiera evaluar (huevo y gallina de la autenticación). | `apps/api/src/auth/auth.service.ts`, `apps/api/src/admin/admin.service.ts` |
| `sesiones` no tiene RLS | Se consulta desde `JwtStrategy.validate` y el gateway de WebSocket con el pool crudo, en el mismo momento "pre-contexto". | `db/migrations/019_sesiones.sql` |
| `/admin/usuarios` y `/admin/secretarias` | La autorización la decide `RolesGuard` + `@Roles('admin')` (código NestJS), no una política de base de datos — justamente porque las tablas que tocan no pueden tener RLS. | `apps/api/src/common/roles.guard.ts`, `apps/api/src/admin/` |

Todo lo demás — publicaciones, agenda, reuniones, tareas, proyectos,
documentos, auditoría, despacho, comunicación — depende de RLS real, verificada
además por una suite de pruebas dedicada
(`apps/api/test/rls.e2e-spec.ts`, corre como `app_user` sin `BYPASSRLS`, cada
test dentro de una transacción con `ROLLBACK`).

## 4. Procesos de negocio que soporta

1. **Publicación de comunicados institucionales** con cadena de aprobación
   (`borrador → revisión → aprobado → publicado`) y adjuntos.
2. **Coordinación de agenda y reuniones** (eventos con invitados
   inter-secretaría, actas, compromisos con responsable y fecha).
3. **Gestión de tareas** con asignación individual y seguimiento de vencimiento.
4. **Seguimiento de proyectos/obras** con avance porcentual y presupuesto.
5. **Cadena de mando del Despacho**: instrucción del Gobernador → desglose en
   ítems por Gabinete → ejecución por las secretarías → evidencia → validación
   → cierre, con SLA de acuse de recibo y reapertura auditada.
6. **Cobertura de comunicación institucional**: solicitud de cobertura →
   planificación por UNICOM → visto bueno de Gabinete.
7. **Trazabilidad y rendición de cuentas**: auditoría inmutable de cambios (con
   filtros, resumen y exportación CSV) y un panel agregado (Gabinete /
   Indicadores) para la conducción.
8. **Administración de identidades**: alta/baja/cambio de rol de usuarios y
   mantenimiento del catálogo de secretarías, sin necesitar SQL manual.

## 5. Estado de implementación por funcionalidad

| Funcionalidad | Estado | Evidencia |
|---|---|---|
| Autenticación con cookies httpOnly + refresh tokens + revocación de sesión | **Completa** | `db/migrations/019_sesiones.sql`, `apps/api/src/auth/` |
| RLS multi-tenant por secretaría + rango + confidencialidad | **Completa** | Presente en 001, 005, y replicada en cada módulo nuevo |
| Publicaciones con flujo de aprobación + notificaciones + SLA | **Completa** | `db/migrations/005`, `021`, `025` |
| Agenda / Reuniones / Tareas / Proyectos (CRUD + RLS + tiempo real) | **Completa** | 008, 009, 010, 011 |
| Documentos adjuntos (bytea in-row) | **Completa, con deuda técnica reconocida** | El propio comentario de `007_documentos.sql` dice que para archivos grandes conviene migrar a object storage; hoy vive dentro de la fila. |
| Despacho (instrucciones, validación, evidencia, bitácora, SLA de acuse) | **Completa** | 015–018 |
| Comunicación (cobertura de eventos) | **Completa (v1)**, sin tiempo real todavía | 026; no hay canal `cobertura_cambios` en `pg-listener.service.ts` — confirmado por ausencia. |
| "Mi bandeja" (`/pendientes`) agregando pendientes de varios módulos | **Completa** | `apps/api/src/pendientes/` |
| Auditoría con filtros/resumen/export | **Completa** | `apps/api/src/auditoria/`, migración 020 |
| Observabilidad (Sentry opcional, request-id, logs estructurados) | **Completa, apagable** | `apps/api/src/observability/`, activa solo si `SENTRY_DSN` está seteado |
| Notificación por email/SMS/push | **No implementada** | Solo existe la campana en la app (`notificaciones` + WebSocket); no hay integración con ningún proveedor externo de mensajería. |
| Búsqueda de "olvidé mi contraseña" | **No implementada** | No hay ruta ni tabla de tokens de recuperación; el reseteo de contraseña lo hace un `admin` a mano desde `/admin/usuarios`. |
| Object storage para adjuntos/evidencias | **No implementada** (documentada como pendiente) | Ver comentario en 007 y 016 |
| TLS `verify-full` en producción (CA real) | **No implementada** (documentada como pendiente) | `rejectUnauthorized: false` hardcodeado en `database.module.ts` y `pg-listener.service.ts` — ver hallazgos en `05-hallazgos-y-plan-de-mejoras.md` |
| Documentación de arquitectura (este set) | **Nueva, generada en esta revisión** | — |

Ningún módulo del listado de "Completa" está a medio implementar en el sentido
de tener rutas que no respondan o tablas sin usar: cada uno tiene su
controller, service, política RLS y (salvo Comunicación, muy nuevo) su canal de
tiempo real. Lo que sí está reconocido como **deuda técnica intencional** —
documentada en el propio código, no inventada por esta revisión — es
almacenamiento de archivos in-row y TLS con certificado autofirmado; se detalla
con evidencia en `05-hallazgos-y-plan-de-mejoras.md`.
