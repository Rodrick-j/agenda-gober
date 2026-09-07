import { AsyncLocalStorage } from 'node:async_hooks';

// Id de la request en curso, disponible en cualquier parte del código sin
// pasarlo a mano. Cubre TODAS las requests (incluidas /health y /auth/login),
// a diferencia del contexto de tenant que solo existe si hay usuario.
export const requestIdStorage = new AsyncLocalStorage<string>();

export function getRequestId(): string | undefined {
  return requestIdStorage.getStore();
}
