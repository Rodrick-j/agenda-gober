import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

// bigint propio (distinto de Despacho 018 y Vencimientos 024): en
// multi-instancia lo corre una sola.
const LOCK_ID = 774411882;

// SLA del flujo de aprobación de publicaciones: recuerda / escala las que
// llevan días trabadas en 'revisión' o aprobadas sin publicar. Toda la
// lógica está en fn_publicaciones_sweep() (migración 025).
@Injectable()
export class PublicacionesSweepService {
  private readonly logger = new Logger(PublicacionesSweepService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Cron(CronExpression.EVERY_HOUR)
  async barrer(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ lock: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS lock',
        [LOCK_ID],
      );
      if (!rows[0]?.lock) return;

      try {
        const res = await client.query<{ fn_publicaciones_sweep: number }>(
          'SELECT fn_publicaciones_sweep()',
        );
        const n = res.rows[0]?.fn_publicaciones_sweep ?? 0;
        if (n > 0)
          this.logger.log(`Barrido de publicaciones: ${n} aviso(s) de SLA`);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
      }
    } catch (err) {
      this.logger.error(
        `Barrido de publicaciones falló: ${(err as Error).message}`,
      );
    } finally {
      client.release();
    }
  }
}
