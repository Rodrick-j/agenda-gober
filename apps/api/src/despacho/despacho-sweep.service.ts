import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

// bigint arbitrario y estable: solo una instancia corre el barrido a la vez.
const LOCK_ID = 918273645;

// Barre el Despacho cuando nadie está usando la app: recalcula el riesgo de
// instrucciones vencidas y dispara los avisos de SLA de acuse. Toda la
// lógica está en fn_despacho_sweep() (migración 018) -- esto solo la agenda.
@Injectable()
export class DespachoSweepService {
  private readonly logger = new Logger(DespachoSweepService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async barrer(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ lock: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS lock',
        [LOCK_ID],
      );
      if (!rows[0]?.lock) return; // otra instancia lo tiene tomado

      try {
        const res = await client.query<{ fn_despacho_sweep: number }>('SELECT fn_despacho_sweep()');
        const n = res.rows[0]?.fn_despacho_sweep ?? 0;
        if (n > 0) this.logger.log(`Barrido de Despacho: ${n} aviso(s) de SLA emitidos`);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
      }
    } catch (err) {
      this.logger.error(`Barrido de Despacho falló: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}
