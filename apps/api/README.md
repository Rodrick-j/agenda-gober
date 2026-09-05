# AGENDA.GOBER — API (NestJS)

Backend que conecta contra el Postgres de `../../db`. La pieza central no es
ningún controller: es `src/context/tenant-context.interceptor.ts`.

## Cómo funciona el aislamiento por secretaría aquí

Cada request HTTP:

1. El interceptor identifica al usuario (por ahora vía el header
   `x-user-email` — ver "Login temporal" abajo), y busca su rol y secretaría.
2. Abre una transacción (`BEGIN`) y ejecuta
   `set_config('app.current_rol', ...)`, `set_config('app.current_secretaria_id', ...)`
   y `set_config('app.current_user_id', ...)` **parametrizados** (nunca
   concatenando el valor en el SQL).
3. Deja el cliente de esa transacción en un `AsyncLocalStorage` para el resto
   del request.
4. `TxService` es el único punto por el que cualquier servicio toca la base
   de datos — si algo intenta consultar sin pasar por este mecanismo,
   `getRequestContext()` lanza un error en vez de correr la query contra el
   pool "pelado" (sin el contexto seteado, lo que dejaría a las políticas
   RLS sin nada que evaluar).
5. Al terminar el request: `COMMIT` si todo salió bien, `ROLLBACK` si hubo
   una excepción. El cliente siempre se libera de vuelta al pool.

Las políticas RLS reales viven en la base de datos (`db/migrations/`), no
acá — este interceptor solo le da a Postgres el contexto que esas políticas
necesitan para decidir.

## Login temporal (`x-user-email`)

Todavía no hay autenticación real. Mientras tanto, cualquier request debe
mandar el header `x-user-email` con el correo de un usuario existente y con
rol asignado en `usuario_roles` — si no, la API responde 401.

**Esto es exclusivamente para desarrollo.** Antes de exponer esta API fuera
de tu máquina hay que reemplazarlo por JWT/sesión real, donde el interceptor
lea el usuario del token verificado en vez de un header sin firmar que
cualquiera puede falsificar.

## Arrancar

```bash
cp .env.example .env
# completa DB_PASSWORD con el mismo valor que APP_DB_PASSWORD en ../../.env

npm install
npm run start:dev
```

Requiere que la base de datos ya esté arriba (`../../scripts/migrate.sh`).

## Probar

```bash
# Sin header -> 401
curl http://localhost:3001/publicaciones

# Como un usuario de Salud -> solo ve publicaciones de Salud
curl http://localhost:3001/publicaciones -H "x-user-email: salud@test.local"

curl -X POST http://localhost:3001/publicaciones \
  -H "Content-Type: application/json" -H "x-user-email: salud@test.local" \
  -d '{"titulo":"t","contenido":"c","nivelConfidencialidad":"interna"}'
```

Nota: `CreatePublicacionDto` no acepta `secretariaId` desde el cliente a
propósito — el `ValidationPipe` global (`forbidNonWhitelisted`) rechaza con
400 cualquier intento de mandarlo. La secretaría siempre sale del usuario
autenticado, nunca del body.
