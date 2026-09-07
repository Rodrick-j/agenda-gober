import * as Sentry from '@sentry/nestjs';

// Se importa PRIMERO en main.ts (antes que @nestjs/core) para que el
// auto-instrumentado de Sentry enganche todo.
//
// Sin SENTRY_DSN, enabled:false -> Sentry no envía nada y la app corre igual.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  // No mandar PII automáticamente (IP, headers de auth, body, etc.).
  sendDefaultPii: false,
});
