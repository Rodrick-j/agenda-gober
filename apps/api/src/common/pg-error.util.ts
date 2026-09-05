import { ForbiddenException } from '@nestjs/common';

// RLS bloquea con SQLSTATE 42501; nuestros triggers de reglas de negocio
// (ej. transición de estado inválida) usan RAISE EXCEPTION, que por defecto
// cae en P0001. Ambos casos son "no tenés permiso para esto", no un bug —
// se traducen a 403 con el mensaje que ya trae la base de datos.
export function mapPgError(err: unknown): never {
  const code = (err as { code?: string } | undefined)?.code;
  if (code === '42501' || code === 'P0001') {
    const message = (err as { message?: string }).message ?? 'Operación no permitida';
    throw new ForbiddenException(message);
  }
  throw err;
}
