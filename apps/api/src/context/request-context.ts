import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';

export interface RequestContext {
  client: PoolClient;
  userId: string;
  rol: string;
  secretariaId: string | null;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

// Lanza a propósito si se llama fuera de una request interceptada: así una
// consulta jamás corre por accidente contra el pool "pelado", sin el
// set_config que hace que las políticas RLS se apliquen.
export function getRequestContext(): RequestContext {
  const ctx = requestContextStorage.getStore();
  if (!ctx) {
    throw new Error(
      'No hay contexto de transacción activo — toda consulta debe pasar por TenantContextInterceptor.',
    );
  }
  return ctx;
}
