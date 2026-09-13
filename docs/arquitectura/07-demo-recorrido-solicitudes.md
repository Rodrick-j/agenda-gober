# Recorrido de solicitudes — cómo probarlo

[verificado en código] Instrucciones breves para reproducir en desarrollo el
recorrido implementado: apoyo registra → jefa confirma (con o sin
participación del Gobernador) → Gobernador consulta y pide cambios →
jefa aplica. Ver `06-propuesta-agenda-prioritaria.md` para el diseño
completo y las migraciones para el detalle de cada regla.

## Versión de referencia

- Commit: `c9683ff` (rama `chore/deploy-ci-hardening`), 13/09/2026.
- Migraciones aplicadas: `001_init_schema.sql` a
  `033_eventos_agenda_gobernador_no_escribe.sql` (33 en total). Confirmar con:

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
