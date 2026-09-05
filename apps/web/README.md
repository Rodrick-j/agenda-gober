# AGENDA.GOBER — Web (Next.js + Tailwind)

Frontend mínimo que consume `apps/api`: login, listado de publicaciones con
actualizaciones en vivo por WebSocket, y formulario de creación.

## Arrancar

```bash
cp .env.example .env.local
npm install
npm run dev
```

Requiere que `apps/api` ya esté corriendo (`npm run start` ahí) y la base de
datos con las migraciones aplicadas.

## Cómo está armado

- `src/lib/api.ts` — cliente HTTP delgado hacia la API (fetch + Bearer token).
- `src/lib/auth.ts` — token en `localStorage` (MVP; ver nota abajo) y
  decodificación **no verificada** del JWT solo para mostrar quién sos en la
  UI — la autorización real la decide siempre el backend.
- `src/lib/roles.ts` — espejo cosmético de `rol_rango()` de la base de datos,
  para no mostrar botones/secciones que el backend va a rechazar. Si igual se
  mostraran de más, el backend responde 403 / devuelve 0 filas.
- `src/lib/session-context.tsx` — sesión (token + claims) compartida por todo
  el panel.
- `src/lib/realtime-context.tsx` — **una sola** conexión WebSocket para todo
  el panel; las páginas se suscriben con `onCambio()`.
- `src/app/(panel)/layout.tsx` — shell autenticado: chequea token, sidebar
  fijo en desktop / drawer en móvil, topbar con indicador de tiempo real.
- Secciones: `/dashboard` (publicaciones con búsqueda y filtro por estado,
  en vivo), `/secretarias` (catálogo), `/auditoria` (registro de cambios,
  solo visible para roles transversales — respaldado por RLS en el backend).

## Qué falta antes de producción

- **Token en `localStorage`**: vulnerable a XSS. Para producción, mover a una
  cookie `httpOnly` + `secure` (implica ajustar CORS/credentials en el
  backend).
- Sin manejo de expiración de token (a las 2h el usuario empieza a recibir
  401 sin aviso — falta refresco o redirect automático al expirar).
- CORS abierto en la API (`app.enableCors()` sin opciones) — acotar al
  dominio real de este frontend antes de exponerlo fuera de tu máquina.

## Verificado

- `npm run build` compila sin errores de TypeScript/ESLint.
- Cabeceras CORS confirmadas entre `localhost:3002` y `localhost:3001`.
- El mecanismo de tiempo real (mismo `socket.io-client`) ya se probó
  end-to-end desde Node (`apps/api/test-realtime.manual.js`).

**No verificado en un navegador real** — este entorno no tiene acceso a uno.
Antes de darlo por terminado, abrí `http://localhost:3002` y probá el flujo
completo (login con `salud@test.local` / `Password123!`, crear una
publicación, y confirmar que el punto de estado cambia a verde cuando el
WebSocket conecta).
