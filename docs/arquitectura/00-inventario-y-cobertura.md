# Inventario y cobertura de la revisión

Este documento existe para que cualquier lector pueda saber, sin tener que confiar
a ciegas, **qué se revisó, cómo y con qué nivel de certeza** se afirma cada cosa en
el resto de `docs/arquitectura/`. No se modificó código, dependencias ni la base de
datos para producir esta documentación — es un trabajo de lectura y verificación.

## Cómo clasificar cada afirmación

En todo `docs/arquitectura/` vas a encontrar marcas como estas:

| Marca | Qué significa |
|---|---|
| **[verificado en código]** | Se leyó el archivo fuente (o se corrió una consulta/comando) y la afirmación describe exactamente lo que ahí está. |
| **[documentado sin verificar]** | Sale de un README/comentario del propio repo, pero no se contrastó línea por línea contra el código que describe. |
| **[inferencia]** | No está escrito en ningún lado; se dedujo a partir de evidencia indirecta (nombres de tablas, patrones repetidos, convenciones). Siempre se explica la evidencia que la sostiene. |
| **[propuesta]** | Es una recomendación de esta revisión, no algo que exista hoy. Nunca se mezcla con la descripción del estado actual. |

Si una sección no lleva marca, es porque su contenido entero es **[verificado en
código]** (por ejemplo, las tablas de rutas por módulo, copiadas directo de los
`*.controller.ts`).

## Método de trabajo

1. Inventario de estructura (carpetas, `package.json`, scripts, CI, Docker).
2. Lectura completa de las 26 migraciones de base de datos (`db/migrations/001`
   a `026`) — es la fuente de verdad del sistema, porque ahí vive la autorización
   real (RLS), no solo el esquema.
3. Lectura de los 18 módulos de `apps/api/src/` (controller + service + DTOs de
   cada uno) y de los archivos transversales (`auth/`, `context/`, `common/`,
   `database/`, `observability/`, `realtime/`, `config/`).
4. Lectura de las páginas y librerías centrales de `apps/web/src/` (enrutamiento,
   sesión, tiempo real, cliente HTTP) y una muestra representativa de páginas de
   módulo (no las ~20 páginas completas línea por línea, ver "Fuera de alcance").
5. Lectura de `apps/api/README.md`, `apps/web/README.md`, `README.md` raíz,
   `docs/BACKUPS.md`, `docs/SECRETS.md`, `pentest/REPORTE.md`, `.env.example`,
   `.github/workflows/ci.yml`, ambos `docker-compose*.yml` y ambos `Dockerfile`.
6. Contraste explícito entre lo que dicen los README y lo que hace el código
   (sección de discrepancias en `02-arquitectura-modulos.md`).

## Cobertura por área

| Área | Cobertura | Detalle |
|---|---|---|
| Migraciones SQL (`db/migrations/001`–`026`) | Completa | Las 26 leídas de punta a punta, incluidas las políticas RLS, triggers y funciones `SECURITY DEFINER`. |
| Seeds (`db/seeds/`) | Completa | Un solo archivo, `001_seed_demo.sql` (secretarías/roles de ejemplo; no crea usuarios). |
| Backend — módulos de negocio | Completa | Los 18 módulos (`admin`, `auditoria`, `auth`, `comunicacion`, `despacho`, `documentos`, `eventos`, `gabinete`, `indicadores`, `notificaciones`, `pendientes`, `proyectos`, `publicaciones`, `reuniones`, `secretarias`, `tareas`, `vencimientos`, `realtime`) — controller + service + DTOs de cada uno. |
| Backend — transversal | Completa | `context/` (interceptor + `TxService` + `AsyncLocalStorage`), `auth/` (estrategia JWT, guards, DTOs), `common/` (paginación, roles guard, manejo de errores de Postgres), `database/` (pool), `observability/` (logger, request-id, filtro de excepciones), `config/secretos.ts`, `env.ts`, `main.ts`. |
| Frontend — enrutamiento y núcleo | Completa | `app/layout.tsx`, `app/page.tsx`, `app/login/page.tsx`, `app/(panel)/layout.tsx`, `lib/api.ts`, `lib/session-context.tsx`, `lib/realtime-context.tsx`, `lib/roles.ts`. |
| Frontend — páginas de módulo | Parcial, dirigida | Se leyeron completas las páginas de Auditoría, Reuniones, Agenda, Tareas y Comunicación (las más ricas en lógica de negocio) y el componente `InstitutionalDashboard.tsx` (Publicaciones). El resto (`proyectos`, `indicadores`, `gabinete`, `secretarias`, `admin/usuarios`, `despacho`) se confirmó por su import de `lib/api.ts` y su ruta, sin leer cada JSX línea por línea — el contrato con el backend (qué endpoint llama, qué rol lo puede ver) sí está verificado porque vive en `lib/api.ts` y en el backend. |
| CI/CD | Completa | `.github/workflows/ci.yml` íntegro. |
| Despliegue | Completa | Los dos `docker-compose*.yml`, ambos `Dockerfile`, `infra/docker/migrate-entrypoint.sh`. |
| Seguridad | Completa (el reporte existente) | `pentest/REPORTE.md` leído íntegro; no se repitió el pentest, se usó como evidencia de qué ya se probó. |
| Documentación previa | Completa | `README.md` raíz, `apps/api/README.md`, `apps/web/README.md`, `docs/BACKUPS.md`, `docs/SECRETS.md`, `apps/web/AGENTS.md`. |
| Pruebas automatizadas | Completa (inventario), no re-ejecutadas | Se listaron `apps/api/test/*.e2e-spec.ts` y se confirmó que no hay `*.spec.ts` (pruebas unitarias) en `apps/api/src/`. No se corrió la suite como parte de este trabajo documental. |

## Fuera de alcance (a propósito)

- **No se leyeron los ~26 archivos de página del frontend línea por línea.** Se
  priorizó leer el backend (donde vive la autorización real) y una muestra de
  frontend suficiente para describir el patrón de comunicación con la API, que
  es el mismo en todas las páginas (`lib/api.ts` + `fetch` con cookies +
  `socket.io-client`).
- **No se ejecutó la suite de tests** (`npm test` / `npm run test:e2e`) como
  parte de esta auditoría documental — la instrucción del pedido es no tocar el
  sistema en ejecución; el contenido de los tests sí se usa como evidencia de
  qué reglas de negocio están cubiertas (ver `apps/api/test/rls.e2e-spec.ts` y
  `despacho.e2e-spec.ts`).
- **No se inspeccionó el contenido de `backups/`** (son artefactos de
  `scripts/backup.sh`, no código del sistema).

## Los 25 diagramas SÍ se validaron y renderizaron — no solo a mano

A diferencia de lo que suele pasar en este tipo de entrega, acá no hizo falta
confiar en una lectura manual de la sintaxis: esta máquina tenía Java 8
instalado, así que se descargó `plantuml-1.2024.8.jar` (trae Graphviz
embebido — `dot version 2.44.1` — confirmado con `-testdot`: "Installation
seems OK. File generation OK") y se corrió el compilador real contra los 25
archivos de `diagramas/*.puml`.

- **Primera pasada**: 5 de los 25 fallaban. Causa real: el JVM de esta máquina
  lee por defecto con `Cp1252` (Windows-1252), no UTF-8. El guion largo "—" en
  UTF-8 ocupa 3 bytes; el tercero, mal interpretado como Cp1252, se convierte
  en una comilla de cierre (`”`) que corta a mitad de camino cualquier
  etiqueta entre comillas que contuviera un "—". Se resolvió forzando
  `-charset UTF-8` en cada invocación (documentado en
  `diagramas/README.md`).
- **2 errores reales de sintaxis** (no de codificación), ya corregidos:
  `componentes-nucleo.puml` tenía un `[` literal anidado dentro de la
  etiqueta abreviada de un componente (`[AppLogger\n[req:xxxxxxxx]...]`,
  el shorthand de PlantUML no admite corchetes dentro de corchetes); y
  `componentes-despacho-agregados.puml` encadenaba flechas en una sola línea
  (`A --> B --> C`), que PlantUML no admite en diagramas de componentes.
- **Resultado final**: `java -jar plantuml.jar -checkonly -charset UTF-8
  *.puml` → los 25 compilan sin error. Se generó además el `.svg` de cada uno
  (mismo nombre, junto a su `.puml`), así que el repositorio queda con la
  fuente editable **y** la imagen ya renderizada, no solo una promesa de que
  "debería" renderizar.

## Próxima revisión sugerida (si el sistema sigue creciendo)

Este inventario es una foto tomada el **2026-09-12**. Los archivos con fecha de
modificación más reciente que esa (`git status` / `git log`) pueden no estar
reflejados. En particular, al momento de esta revisión hay cambios sin
commitear en el árbol de trabajo (ver `git status`) — esta documentación
describe **el código tal como está en disco**, no una versión etiquetada o
commiteada específica.
