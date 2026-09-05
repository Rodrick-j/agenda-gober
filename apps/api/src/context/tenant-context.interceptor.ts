import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { requestContextStorage } from './request-context';

// Por cada request HTTP: identifica al usuario, abre una transacción, y deja
// el contexto (app.current_rol / app.current_secretaria_id / app.current_user_id)
// seteado con set_config ANTES de que corra cualquier query del handler. Al
// terminar, hace COMMIT si todo salió bien o ROLLBACK si hubo error, y
// siempre libera el cliente de vuelta al pool.
//
// TODO: el header x-user-email es un sustituto temporal mientras no existe
// login real (JWT/sesión). No usar este mecanismo en producción.
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();

    if (req.path === '/health') {
      return next.handle();
    }

    const email = req.header('x-user-email');
    if (!email) {
      throw new UnauthorizedException(
        'Falta el header x-user-email (temporal, todavía no hay login)',
      );
    }

    const client = await this.pool.connect();
    let rows;
    try {
      ({ rows } = await client.query(
        `SELECT u.id AS user_id, u.secretaria_id, r.nombre AS rol
         FROM usuarios u
         JOIN usuario_roles ur ON ur.usuario_id = u.id
         JOIN roles r ON r.id = ur.rol_id
         WHERE u.email = $1 AND u.activo = true
         LIMIT 1`,
        [email],
      ));
    } catch (err) {
      client.release();
      throw err;
    }

    if (rows.length === 0) {
      client.release();
      throw new UnauthorizedException('Usuario no encontrado o sin rol asignado');
    }

    const { user_id: userId, secretaria_id: secretariaId, rol } = rows[0];

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
