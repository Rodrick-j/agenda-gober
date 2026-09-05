import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { requestContextStorage } from './request-context';
import type { AuthenticatedUser } from '../auth/jwt-payload';

// Por cada request autenticado: abre una transacción y deja el contexto
// (app.current_rol / app.current_secretaria_id / app.current_user_id)
// seteado con set_config ANTES de que corra cualquier query del handler,
// usando los claims ya verificados por JwtAuthGuard (req.user). Al terminar,
// hace COMMIT si todo salió bien o ROLLBACK si hubo error, y siempre libera
// el cliente de vuelta al pool.
//
// Rutas públicas (@Public(): login, health) no tienen req.user -- ahí no hay
// nada que contextualizar, así que se dejan pasar sin abrir transacción.
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();

    if (!req.user) {
      return next.handle();
    }

    const { userId, rol, secretariaId } = req.user;

    const client = await this.pool.connect();
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_rol', $1, true),
              set_config('app.current_secretaria_id', $2, true),
              set_config('app.current_user_id', $3, true)`,
      [rol, secretariaId ?? '', userId],
    );

    return new Observable((subscriber) => {
      requestContextStorage.run({ client, userId, rol, secretariaId }, () => {
        next.handle().subscribe({
          next: (val) => subscriber.next(val),
          error: (err) => {
            void client
              .query('ROLLBACK')
              .catch(() => undefined)
              .finally(() => client.release());
            subscriber.error(err);
          },
          complete: () => {
            void client
              .query('COMMIT')
              .catch(() => undefined)
              .finally(() => client.release());
            subscriber.complete();
          },
        });
      });
    });
  }
}
