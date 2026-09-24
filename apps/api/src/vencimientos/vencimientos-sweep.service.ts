import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

// bigint arbitrario y estable, distinto del de Despacho (018): en
// multi-instancia solo una corre el barrido a la vez.
const LOCK_ID = 615243879;

// Avisa "vence pronto" / "vencida" de tareas y compromisos abiertos. Toda la
// lógica está en fn_vencimientos_sweep() (migración 024) -- esto solo la
// agenda cada hora, protegida con pg_try_advisory_lock.
@Injectable()
export class VencimientosSweepService {
  private readonly logger = new Logger(VencimientosSweepService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Cron(CronExpression.EVERY_HOUR)
  async barrer(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ lock: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS lock',
        [LOCK_ID],
      );
      if (!rows[0]?.lock) return; // otra instancia lo tiene tomado

      try {
        const res = await client.query<{ fn_vencimientos_sweep: number }>(
          'SELECT fn_vencimientos_sweep()',
        );
        const n = res.rows[0]?.fn_vencimientos_sweep ?? 0;
        if (n > 0)
          this.logger.log(`Barrido de vencimientos: ${n} aviso(s) emitidos`);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
      }
    } catch (err) {
      this.logger.error(
        `Barrido de vencimientos falló: ${(err as Error).message}`,
      );
    } finally {
      client.release();
    }
  }
}
