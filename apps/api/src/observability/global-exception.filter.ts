import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';

// Extiende el filtro de Sentry (que manda a Sentry solo los errores 5xx /
// no-HttpException, nunca un 403 esperado) y además loguea todo 5xx con el
// request-id via AppLogger. Sin DSN, la parte de Sentry es no-op.
@Catch()
export class GlobalExceptionFilter extends SentryGlobalFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      const err = exception as Error;
      this.logger.error(`HTTP ${status} — ${err?.message ?? 'error desconocido'}`, err?.stack);
    }
    super.catch(exception, host);
  }
}
