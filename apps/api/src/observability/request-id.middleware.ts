import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { requestIdStorage } from './request-id';

// Toma el x-request-id entrante (si un proxy ya lo puso) o genera uno, lo
// devuelve en la respuesta y lo deja en el AsyncLocalStorage para que el
// logger y Sentry lo adjunten a todo lo de esta request.
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['x-request-id'];
  const id = (typeof header === 'string' && header) || randomUUID();
  res.setHeader('x-request-id', id);
  try {
    Sentry.getCurrentScope().setTag('request_id', id);
  } catch {
    /* Sentry sin DSN: no pasa nada */
  }
  requestIdStorage.run(id, () => next());
}
