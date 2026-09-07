import { ConsoleLogger } from '@nestjs/common';
import { getRequestId } from './request-id';

function withId(message: unknown): unknown {
  const id = getRequestId();
  return id && typeof message === 'string' ? `[req:${id.slice(0, 8)}] ${message}` : message;
}

// Prefija cada línea con [req:xxxxxxxx] cuando hay una request en curso, así
// se puede seguir un pedido de punta a punta en los logs (y cruzarlo con el
// header x-request-id de la respuesta y con el tag en Sentry).
export class AppLogger extends ConsoleLogger {
  log(message: any, ...args: any[]): void {
    super.log(withId(message), ...args);
  }
  error(message: any, ...args: any[]): void {
    super.error(withId(message), ...args);
  }
  warn(message: any, ...args: any[]): void {
    super.warn(withId(message), ...args);
  }
  debug(message: any, ...args: any[]): void {
    super.debug(withId(message), ...args);
  }
  verbose(message: any, ...args: any[]): void {
    super.verbose(withId(message), ...args);
  }
}
