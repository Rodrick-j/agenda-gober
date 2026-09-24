# Guía de lectura de los diagramas

Los 25 diagramas de esta carpeta están en formato **PlantUML** (`.puml`,
editable en cualquier editor de texto) y cada uno tiene su **`.svg`** ya
renderizado al lado, con el mismo nombre. Ambos se generaron y validaron con
`plantuml-1.2024.8.jar` (con Graphviz embebido) — ver el detalle de cómo en
`../00-inventario-y-cobertura.md`.

## Cómo volver a renderizarlos vos

```bash
# Requiere Java (8 o superior alcanza) y el .jar de PlantUML:
# https://github.com/plantuml/plantuml/releases

cd docs/arquitectura/diagramas
java -jar plantuml.jar -tsvg -charset UTF-8 *.puml
```

**El `-charset UTF-8` no es opcional en Windows**: sin él, cualquier acento o
el guion largo "—" puede salir mal decodificado (y en algunos casos rompe la
compilación entera — ver el detalle en `00-inventario-y-cobertura.md`). Con un
editor con soporte de PlantUML (la extensión "PlantUML" de VS Code, por
ejemplo) alcanza con abrir el archivo y pedir la vista previa.

Esta guía sigue el mismo orden que pidió el pedido original: C4 → componentes
→ casos de uso → entidad-relación → secuencia → actividad → estados →
despliegue → (clases, y por qué no aplica).

---

## 1. C4 — Contexto

**Archivo:** [`c4-contexto.puml`](c4-contexto.puml) ·
[`c4-contexto.svg`](c4-contexto.svg)

**Pregunta que responde:** ¿quién usa este sistema, y con qué otros sistemas
habla?

**Cómo leerlo:** cada óvalo es una persona (agrupada por rol, no por
individuo); el rectángulo central es el sistema completo visto como una caja
negra; la nube es el único sistema externo real. Las flechas son "usa" o
"reporta a", nunca un protocolo específico (eso es el nivel de contenedores).

**Ejemplo concreto:** la flecha "Gobernador → AGENDA.GOBER: emite
instrucciones, ve todo, reabre" resume 4 casos de uso completos que se
detallan recién en `casos-de-uso-transversal.puml`.

**Archivos que lo respaldan:** ausencia de cualquier cliente HTTP saliente
salvo el SDK de Sentry (`grep` sobre `apps/api/src`, sin resultados para
nodemailer/axios/twilio/etc.); `db/migrations/001_init_schema.sql` (roles) y
`026_comunicacion.sql` (rol `unicom`) para los actores.

## 2. C4 — Contenedores

**Archivo:** [`c4-contenedores.puml`](c4-contenedores.puml) ·
[`c4-contenedores.svg`](c4-contenedores.svg)

**Pregunta que responde:** ¿cuáles son las piezas de software desplegables, y
qué protocolo usa cada conexión entre ellas?

**Cómo leerlo:** de arriba hacia abajo, cada rectángulo es un proceso o
runtime distinto. La nota lateral es la más importante: el navegador **no**
pasa por el servidor de Next.js para hablar con la API — le pega directo, con
CORS configurado para eso (`WEB_ORIGIN`).

**Ejemplo concreto:** la flecha "Navegador → Api : WSS... withCredentials:
true" es la misma conexión que se sigue paso a paso en
`secuencia-realtime-actualizacion.puml`.

**Archivos que lo respaldan:** `apps/web/src/lib/api.ts` (`fetch` directo a
`API_URL`, no a una ruta interna de Next), `apps/api/src/main.ts`
(`enableCors`), `apps/web/src/lib/realtime-context.tsx` (`io(API_URL,
{withCredentials:true})`).

## 3. Componentes (3 diagramas, divididos por capa)

**Archivos:** [`componentes-nucleo.puml`](componentes-nucleo.puml),
[`componentes-modulos-operativos.puml`](componentes-modulos-operativos.puml),
[`componentes-despacho-agregados.puml`](componentes-despacho-agregados.puml)

**Pregunta que responde:** dentro de la API, ¿qué piezas de código dependen de
cuáles?

**Cómo leerlo:** cada `package` es una carpeta de `apps/api/src/`; cada
`[componente]` es una clase real (controller/service). Las flechas sólidas son
imports/inyección de dependencias reales; las **flechas rojas punteadas**
marcan una relación que existe solo a nivel de datos (clave foránea o
política RLS), no de código TypeScript — es la distinción más importante de
estos tres diagramas.

**Ejemplo concreto:** en `componentes-modulos-operativos.puml`, `DocService
..> PubService` (roja, punteada) significa que `documentos` y `publicaciones`
están relacionadas por una clave foránea y una política RLS
(`EXISTS(...publicaciones...)`), pero `DocumentosService` nunca importa ni
llama a `PublicacionesService` — la nota al pie lo explica.

**Archivos que lo respaldan:** los 18 `*.module.ts` (se confirmó con `grep`
que todos importan solo `ContextModule`, salvo `RealtimeModule` que además
importa `AuthModule` — la única excepción real en todo el código); cada
`*.service.ts` citado en las etiquetas.

## 4. Casos de uso (2 diagramas, por audiencia)

**Archivos:** [`casos-de-uso-operativo.puml`](casos-de-uso-operativo.puml),
[`casos-de-uso-transversal.puml`](casos-de-uso-transversal.puml)

**Pregunta que responde:** ¿qué puede *hacer* cada rol, en el vocabulario del
usuario (no de la base de datos)?

**Cómo leerlo:** en el primero, la herencia `Operador <|-- Director <|--
Secretario` refleja `rol_rango()` (5): un Director hereda todo lo del
Operador y suma lo suyo. En el segundo, los 4 roles transversales son
independientes entre sí (no hay jerarquía real entre Gobernador y
Administrador).

**Ejemplo concreto:** "Cerrar MI compromiso asignado (aunque sea de otra
secretaría)" — está pegado a los 3 roles de secretaría porque cualquiera
puede hacerlo si es el responsable, no solo el rol dueño de la secretaría del
evento.

**Archivos que lo respaldan:** la matriz completa de capacidades por rol está
en `../01-proposito-alcance-roles.md` §3.1, con la cita de archivo/migración
para cada celda.

## 5. Entidad-Relación (3 diagramas, por dominio)

**Archivos:**
[`er-01-identidad-organizacion.puml`](er-01-identidad-organizacion.puml),
[`er-02-contenido-institucional.puml`](er-02-contenido-institucional.puml),
[`er-03-despacho-y-trazabilidad.puml`](er-03-despacho-y-trazabilidad.puml)

**Pregunta que responde:** ¿qué tablas existen, con qué claves, y cómo se
conectan?

**Cómo leerlo:** notación pata de gallo estándar (`||` = exactamente uno,
`o{` = cero o muchos). Las tablas repetidas entre archivos (`secretarias`,
`usuarios`) aparecen "livianas" (solo su PK) como referencia — su definición
completa vive en `er-01`.

**Ejemplo concreto:** en `er-02`, `eventos_agenda ||--o| cobertura` (cardinal
`o|`, no `o{`) es la forma correcta de decir "cada evento tiene como máximo
UNA cobertura" — reflejando el `UNIQUE` real sobre `cobertura.evento_id`.

**Archivos que lo respaldan:** las 26 migraciones de `db/migrations/`; el
texto de acompañamiento completo (con la razón de cada decisión de modelado)
está en `../03-modelo-de-datos.md`.

## 6. Secuencia (6 diagramas, un proceso técnico cada uno)

**Archivos:** [`secuencia-login.puml`](secuencia-login.puml),
[`secuencia-crear-publicacion-flujo-aprobacion.puml`](secuencia-crear-publicacion-flujo-aprobacion.puml),
[`secuencia-realtime-actualizacion.puml`](secuencia-realtime-actualizacion.puml),
[`secuencia-despacho-emision-validacion.puml`](secuencia-despacho-emision-validacion.puml),
[`secuencia-cobertura-comunicacion.puml`](secuencia-cobertura-comunicacion.puml),
[`secuencia-rls-denegado.puml`](secuencia-rls-denegado.puml)

**Pregunta que responde:** para UNA petición concreta, ¿qué componente llama a
cuál, en qué orden, y qué pasa si algo se rechaza a mitad de camino?

**Cómo leerlo:** de arriba hacia abajo es el orden temporal; los bloques `alt/
else` son caminos alternativos (éxito vs. error); las notas señalan **en qué
capa** ocurre cada control (trigger de Postgres vs. política RLS vs. guard de
NestJS) porque es distinto en cada caso.

**Ejemplo concreto:** en `secuencia-rls-denegado.puml`, el Caso 1 (leer un
recurso de otra secretaría) termina en **404** y el Caso 2 (violar una regla
de edición) termina en **403** — son mecanismos de rechazo distintos
(ausencia silenciosa de fila vs. `RAISE EXCEPTION` de un trigger) que se ven
idénticos desde afuera si no se lee el diagrama.

**Archivos que lo respaldan:** cada diagrama cita en sus propias notas el
archivo y la función exactos (ej. `fn_validar_edicion_tarea`,
`fn_cobertura_sello`). El recorrido narrado en prosa, con la misma evidencia,
está en `../04-recorridos-extremo-a-extremo.md`.

## 7. Actividad (3 diagramas, el proceso de negocio completo con sus ramas)

**Archivos:**
[`actividad-flujo-publicacion.puml`](actividad-flujo-publicacion.puml),
[`actividad-despacho-ciclo-instruccion.puml`](actividad-despacho-ciclo-instruccion.puml),
[`actividad-cobertura-comunicacion.puml`](actividad-cobertura-comunicacion.puml)

**Pregunta que responde:** a lo largo de **días**, no de una sola petición
HTTP, ¿qué camino sigue un caso de principio a fin, con sus vueltas atrás?

**Cómo leerlo:** los carriles (`|Autor|`, `|Director|`...) dicen quién hace
cada paso. El `repeat / repeat while` es el ciclo de ida y vuelta (pedir →
rechazar con motivo → corregir → volver a pedir) — no es un `if` porque puede
repetirse más de una vez.

**Ejemplo concreto:** en `actividad-flujo-publicacion.puml`, el barrido
horario (`fn_publicaciones_sweep`) se dibuja en su **propio carril**, no
como un paso secuencial del proceso — corre en paralelo, independientemente
de en qué paso esté la publicación, y solo empuja con un recordatorio si algo
quedó estancado.

**Archivos que lo respaldan:** los 3 triggers de "sello + notificación" y los
3 `*-sweep.service.ts` citados en `../02-arquitectura-modulos.md` §2.3.

## 8. Estados (5 diagramas, el ciclo de vida de cada entidad con estado)

**Archivos:** [`estados-publicacion.puml`](estados-publicacion.puml),
[`estados-instruccion.puml`](estados-instruccion.puml),
[`estados-instruccion-item.puml`](estados-instruccion-item.puml),
[`estados-cobertura.puml`](estados-cobertura.puml),
[`estados-tarea-compromiso.puml`](estados-tarea-compromiso.puml)

**Pregunta que responde:** para esta columna `estado`, ¿cuáles transiciones
son válidas, y quién/qué las puede disparar?

**Cómo leerlo:** igual que cualquier diagrama de estados UML — la diferencia
importante acá es que **no todas las flechas están garantizadas de la misma
forma**: hay que leer las notas de cada una para saber si la transición la
impone un trigger (inquebrantable, ver `estados-publicacion.puml` y
`estados-instruccion-item.puml`) o si es solo una sugerencia de la interfaz
sin respaldo en la base de datos.

**Ejemplo concreto — el hallazgo más importante de este set de diagramas:**
`estados-cobertura.puml` tiene una nota explícita advirtiendo que, a
diferencia de los otros 4, **ninguna de sus flechas está impuesta por un
trigger** — el `ActualizarCoberturaDto` acepta cualquiera de los 6 valores del
enum sin validar el estado anterior. Es una inconsistencia real encontrada
durante esta revisión, no un adorno del diagrama; está desarrollada como
hallazgo en `../05-hallazgos-y-plan-de-mejoras.md`.

**Archivos que lo respaldan:** `005_permisos_finos.sql`
(`fn_validar_transicion_publicacion`), `016_despacho_validacion.sql`
(`fn_validar_edicion_item`), `026_comunicacion.sql` (`fn_cobertura_sello` —
nótese que solo valida la columna `gabinete_visto_at`, no el `estado`
general), `009_tareas.sql`/`011_reuniones.sql`
(`fn_validar_edicion_tarea`/`fn_validar_edicion_compromiso`).

## 9. Despliegue

**Archivo:** [`despliegue.puml`](despliegue.puml) ·
[`despliegue.svg`](despliegue.svg)

**Pregunta que responde:** ¿en qué máquina/proceso corre cada pieza, y qué
puertos quedan expuestos a quién?

**Cómo leerlo:** todo vive hoy en la máquina del desarrollador — no hay un
entorno de producción real desplegado en ningún lado (ver
`../05-hallazgos-y-plan-de-mejoras.md` sobre la ausencia de CD). Los dos
`docker-compose*.yml` son alternativas entre sí, no capas de un mismo
ambiente: uno levanta todo, el otro solo la base de datos para correr
api/web con `npm run dev` afuera de Docker.

**Ejemplo concreto:** los tres `ports:` de `docker-compose.full.yml` usan
`127.0.0.1:<puerto>:<puerto>` — ni siquiera en la propia red local del
desarrollador quedan expuestos; el pentest (`pentest/REPORTE.md`) lo confirmó
para el puerto de Postgres con `nmap` desde otra máquina (Kali).

**Archivos que lo respaldan:** `infra/docker/docker-compose.full.yml`,
`infra/docker/docker-compose.yml`, `apps/api/Dockerfile`,
`apps/web/Dockerfile`, `.github/workflows/ci.yml` (confirma que CI construye
imágenes pero no las publica ni las despliega a ningún host).

## 10. ¿Por qué no hay un diagrama de clases?

**No se forzó uno.** La justificación completa (no hay ORM, no hay clases de
dominio con métodos — la lógica de negocio vive en funciones SQL/PL-pgSQL y
en services de NestJS sin estado) está en `../03-modelo-de-datos.md` §5. Los
DTOs de `class-validator` sí son clases reales, pero son contratos de forma de
entrada HTTP, no un modelo de dominio — ya están documentados como columna de
"Rutas" en la tabla de módulos de `../02-arquitectura-modulos.md`.
