# Recorrido de solicitudes — cómo probarlo

[verificado en código] Instrucciones breves para reproducir en desarrollo el
recorrido implementado: apoyo registra → jefa confirma (con o sin
participación del Gobernador) → Gobernador consulta y pide cambios →
jefa aplica. Ver `06-propuesta-agenda-prioritaria.md` para el diseño
completo y las migraciones para el detalle de cada regla. La sección
"Mesa de trabajo" más abajo cubre el lote siguiente (vista de tabla).

## Versión de referencia

- Commit: `f0000d5` (rama `chore/deploy-ci-hardening`), 13/09/2026.
- Migraciones aplicadas: `001_init_schema.sql` a
  `034_agenda_mesa_trabajo.sql` (34 en total). Confirmar con:

  ```bash
  bash scripts/migrate.sh   # aplica las que falten; si ya están, no hace nada
  ```

  o consultando directamente:

  ```sql
  SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 10;
  ```

## Levantar el entorno

```bash
# Postgres (contenedor agenda_gober_db, 127.0.0.1:5433)
docker compose --env-file .env -f infra/docker/docker-compose.yml up -d postgres
bash scripts/migrate.sh

# API (usa apps/api/.env — DB_*, JWT_SECRET)
cd apps/api && npm run start:dev   # puerto 3001 por defecto; si está ocupado, PORT=3011 npm run start:dev

# Web (usa apps/web/.env.local — NEXT_PUBLIC_API_URL debe apuntar al puerto real de la API)
cd apps/web && npm run dev         # puerto 8500
```

## Cuentas de demostración

Ya existen en la base de desarrollo (password `Demo-2026!` para todas):

| Cuenta | Rol | Uso |
|---|---|---|
| `apoyo@demo.local` | apoyo | registra solicitudes |
| `jefa@demo.local` | jefe_gabinete | confirma, aplica indicaciones |
| `gobernador@demo.local` | gobernador | consulta Mi jornada, pide cambios |
| `apoyo2@demo.local` | apoyo | sin vínculo — para probar que NO ve el detalle ajeno |

Si no existen en tu base (ej. tras un `docker compose down -v`), recrearlas
con el mismo patrón que `admin/usuarios` (crear usuario + asignar rol vía la
UI de administración, o por SQL siguiendo `scripts/seed.sh` como ejemplo).

## Pasos

1. **Entra como `apoyo@demo.local`** → Agenda → "Nuevo evento". Escribe un
   título y guarda sin tocar horario (queda en estado *Solicitud*).
2. **Entra como `jefa@demo.local`** (otra pestaña/navegador) → en el panel
   de Inicio, bajo "Mi bandeja" → "Solicitudes de agenda", clic en la
   registrada. Se abre el evento exacto. Activa "Con horario propuesto",
   define fecha/hora, cambia Estado a *Confirmado*, y si corresponde marca
   "Participa el Gobernador" (toggle aparte, no automático). Guarda.
3. **Entra como `gobernador@demo.local`** → "Mi jornada" (solo visible para
   este rol) → la actividad aparece con el horario confirmado. Clic en
   "Pedir cambio" → elige tipo (Reprogramar/Cancelar/Aclaración) y escribe
   el pedido → "Enviar pedido".
4. **Vuelve a `jefa@demo.local`** → "Indicaciones del Gobernador" en la
   bandeja → abre el evento → el pedido aparece junto a (no reemplazando)
   la programación vigente. Aplica el cambio real editando el evento, y
   por separado clic "Atender" → "Marcar aplicada" (con nota opcional).
5. **Vuelve a `gobernador@demo.local`** → Mi jornada refleja el cambio.
6. **Entra como `apoyo2@demo.local`** → intenta abrir el mismo evento por
   `/agenda?evento=<id>` → "Evento no encontrado" (sin vínculo, RLS lo
   filtra).

## Qué NO se puede hacer (comprobar que el backend, no solo la UI, lo impide)

- `gobernador` no ve "Nuevo evento" ni "Editar/Eliminar" en el calendario
  normal; si se fuerza la llamada a la API igual, POST devuelve 403 y
  PATCH/DELETE devuelven 404 (RLS filtra la fila antes de intentar nada).
- `apoyo` no puede dejar un evento en `confirmado`/`cancelado` (403).
- Un segundo `apoyo` sin vínculo no ve el evento de otro (404), ni sus
  indicaciones.

Suite automatizada equivalente:
`cd apps/api && npm run test:e2e -- solicitudes-agenda`.

## Mesa de trabajo (vista de tabla) — cómo probarla

[verificado en navegador] Vista de tabla dentro de Agenda para la Jefa de
Gabinete, sobre los mismos `eventos_agenda` del calendario (mismos permisos,
mismo tiempo real) — no una vista ni un almacenamiento aparte. Migración
`034_agenda_mesa_trabajo.sql`, `EventosService.mesaTrabajo()`.

**Solo visible para quien coordina la agenda** (`jefe_gabinete`/`admin`):
selector "Calendario / Tabla" junto al título. `apoyo`/`gobernador` no lo ven
(siguen con el calendario y "Mi jornada" de siempre).

### Pasos

1. **Entra como `jefa@demo.local`** → Agenda → botón **Tabla**.
2. **Registrar sin horario**: botón "Registrar solicitud" (arriba de la
   tabla) → escribe Asunto + Organización solicitante → Guardar. Aparece de
   inmediato en estado *Solicitud*, columna "Fecha y hora" en "Sin horario".
3. **Buscarla**: escribe parte de la organización en el buscador — la
   encuentra (busca en asunto, organización y lugar).
4. **Completar datos**: clic en el texto de "Lugar" (o "Organización",
   o el "Asunto") de esa fila — entra en edición inline; escribe y
   Enter (o clic afuera) para guardar. Clic en cualquier OTRA parte de la
   fila abre el diálogo completo en vez de editar inline.
5. **Filtrar pendientes**: chip "Sin horario" (arriba) — deja solo lo que
   todavía no tiene horario. Chip "Indicaciones pendientes" — análogo, para
   lo que el Gobernador pidió cambiar.
6. **Confirmar y reprogramar**: clic en cualquier parte no editable de la
   fila (ej. la columna Estado) → se abre el mismo diálogo del calendario →
   "Con horario propuesto" → fecha/hora/estado → Guardar. Si hay cruce con
   otra actividad, aparece el mismo aviso "Horario ocupado" de siempre — el
   botón "Crear de todos modos" autoriza el cruce, pero hay que volver a
   tocar "Guardar cambios" (autoriza, no envía solo). Reabrir la fila y
   cambiar la hora de nuevo reprograma con la misma regla.
7. **Indicación del Gobernador**: como `gobernador@demo.local` en "Mi
   jornada", "Pedir cambio" sobre esa actividad. De vuelta como la jefa, el
   chip "Indicaciones pendientes" la muestra; abrir la fila trae el panel
   "Indicaciones del Gobernador" ya visible (sin buscarlo aparte) —
   "Atender" → nota opcional → "Marcar aplicada".
8. **Cambio simultáneo sin perder trabajo**: abre la misma fila en dos
   sesiones (dos pestañas/navegadores como la jefa). En una, empieza a
   escribir en "Descripción" SIN guardar. En la otra, edita el lugar inline
   y guarda. La primera pestaña muestra un aviso ("Este registro se
   actualizó en el servidor…") sin tocar lo que se estaba escribiendo — el
   formulario sigue con el texto tal cual. Si en cambio se intenta guardar
   sobre una versión vieja, el backend responde 409 y aparece el estado
   real del servidor con "Cargar la versión más reciente" en vez de
   sobrescribir en silencio.

### Responsive

- **Laptop**: tabla de 8 columnas (Fecha y hora, Asunto, Organización,
  Lugar, Apoyo responsable, Estado, Gob., Indicación) sin paneles cortados.
- **Celular**: lista de tarjetas legibles (no la tabla comprimida) — asunto,
  estado, fecha/hora, lugar, organización, responsable e indicadores de
  Gobernador/indicación en cada tarjeta; clic abre el mismo detalle.

Suite automatizada equivalente:
`cd apps/api && npm run test:e2e -- mesa-trabajo`.

### Deferido a lotes posteriores (fuera de alcance de este lote a propósito)

Columnas provisionales hasta revisar una muestra anonimizada del Excel real
de la Jefa. Quedan **planificados, no implementados**:

- Importación/exportación de Excel, pegado masivo de filas.
- Adjuntar audios e imágenes a una solicitud/actividad.
- Nuevas vistas de calendario (semana/agenda/etc.) más allá del mes actual.
