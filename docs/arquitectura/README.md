# Arquitectura de AGENDA.GOBER

Documentación de arquitectura generada a partir de una revisión completa del
repositorio (código, migraciones, configuración, CI/CD y el reporte de
pentest existente) — no de una descripción de intenciones. Cada afirmación
está clasificada como **[verificado en código]**, **[documentado sin
verificar]**, **[inferencia]** o **[propuesta]**; ver la explicación completa
de esas marcas en [`00-inventario-y-cobertura.md`](00-inventario-y-cobertura.md).

No se modificó ningún archivo de `apps/`, `db/` ni `infra/`, ni se ejecutó
nada contra una base de datos real, para producir este material.

## Índice — orden de lectura recomendado

1. **[00 — Inventario y cobertura](00-inventario-y-cobertura.md)** — qué se
   revisó, cómo, y qué queda fuera de alcance a propósito. Empezá acá si
   querés saber cuánto confiar en el resto.
2. **[01 — Propósito, alcance y roles](01-proposito-alcance-roles.md)** — qué
   problema resuelve el sistema, los 7 roles y qué puede hacer cada uno, y la
   distinción más importante de todas: qué es un candado real (RLS/trigger)
   y qué es solo un botón que el frontend oculta.
3. **[02 — Arquitectura y catálogo de módulos](02-arquitectura-modulos.md)**
   — cómo se comunican frontend/API/base de datos/tiempo real, y una tabla
   con los 18 módulos del backend (archivos, rutas, entidades, roles
   autorizados). Incluye 3 discrepancias reales encontradas entre los README
   existentes y el código.
4. **[03 — Modelo de datos](03-modelo-de-datos.md)** — acompaña a los
   diagramas entidad-relación; explica el patrón repetido de automatización
   (sello + notificación + barrido) y por qué no se fuerza un diagrama de
   clases.
5. **[Diagramas](diagramas/README.md)** — los 25 diagramas PlantUML
   (`.puml` editable + `.svg` ya renderizado), organizados en 8 categorías,
   cada uno con la pregunta que responde, cómo leerlo, un ejemplo concreto y
   los archivos de código que lo respaldan.
6. **[04 — Recorridos de extremo a extremo](04-recorridos-extremo-a-extremo.md)**
   — 6 procesos reales narrados actor→pantalla→petición→controlador→
   servicio→entidad→respuesta→UI, conectando las vistas de arriba entre sí.
7. **[05 — Hallazgos y plan de mejoras](05-hallazgos-y-plan-de-mejoras.md)**
   — separado a propósito del estado actual: 10 hallazgos con evidencia,
   impacto, solución propuesta, prioridad/dependencias y criterio de
   aceptación. Nada de esto está implementado todavía.
8. **[06 — Propuesta: la Agenda como punto de entrada](06-propuesta-agenda-prioritaria.md)**
   — cambio de prioridad (sep 2026): rediseño del flujo de Agenda (solicitud
   → coordinación → confirmación → realización), rol nuevo "apoyo", matriz de
   permisos, diseño de vistas/ficha, y plan por lotes con un primer lote
   recomendado. Igual que `05`, es propuesta — nada de esto está
   implementado todavía.

## Si solo vas a leer una cosa de cada tipo

- **¿Quién puede hacer qué?** → tabla de `01` §3.1.
- **¿Cómo entra una petición HTTP hasta la base de datos?** → `02` §2.1, y en
  dibujo, [`diagramas/secuencia-crear-publicacion-flujo-aprobacion.puml`](diagramas/secuencia-crear-publicacion-flujo-aprobacion.puml).
- **¿Qué tablas hay y cómo se relacionan?** → los 3 `diagramas/er-*.puml`.
- **¿Qué está roto o pendiente, y en qué orden atacarlo?** → `05`.

## Explicación en palabras simples

**¿Qué hace el sistema?** Es la herramienta de trabajo diario de una
Gobernación: cada secretaría carga y gestiona sus comunicados, su agenda, sus
tareas y sus proyectos ahí — pero **nunca puede ver lo de otra secretaría**,
salvo el Gobernador y su Gabinete, que sí ven todo. Encima de eso hay dos
procesos especiales: el Gobernador puede mandarle encargos concretos a las
secretarías y hacerles seguimiento hasta que se cierren y se validen
(Despacho), y la Unidad de Comunicación coordina con Gabinete qué eventos de
las secretarías necesitan cobertura de prensa (Comunicación).

**¿Cómo se conectan sus partes?** Hay solo dos programas: uno que le muestra
las pantallas a la gente (la parte "Next.js") y otro que atiende esas
pantallas y habla con la base de datos (la parte "NestJS"). Lo que hace que
este sistema sea distinto de uno típico es **dónde vive el candado**: no está
escrito en el programa que atiende las pantallas, está escrito **dentro de la
propia base de datos** (reglas que Postgres aplica solas, llamadas Row Level
Security). Eso significa que aunque alguien lograra saltarse el programa
intermedio y hablarle directo a la base de datos con las credenciales que
usa la aplicación, seguiría sin poder ver ni tocar nada fuera de lo suyo — se
probó a propósito con un pentest y quedó documentado. Cuando algo cambia
(alguien aprueba un comunicado, le asignan una tarea, le piden validar algo
del Despacho), la base de datos misma "avisa" al programa, que se lo muestra
en vivo a quien corresponda sin que nadie tenga que refrescar la página — y
sin que nadie tenga que acordarse de mandar el aviso a mano, porque **eso
también está automatizado dentro de la base de datos**, con recordatorios
programados para lo que se queda estancado.

**¿Qué recorrido de lectura recomiendo?** Si administrás o vas a seguir
construyendo el sistema: `01` → `02` → los diagramas de componentes y ER →
`04` (para ver todo conectado) → `05` (para saber qué falta). Si solo
necesitás entender un proceso puntual (por ejemplo, cómo funciona la
aprobación de una publicación, o el Despacho): andá directo a su fila en `04`
y seguí las referencias a los diagramas desde ahí — no hace falta leer todo
en orden para entender una sola pieza.
