import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

// Estable y distinto de los locks usados por Despacho y Vencimientos.
const LOCK_ID = 932741605;

@Injectable()
export class AgendaAutomationService {
  private readonly logger = new Logger(AgendaAutomationService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // Cada cinco minutos basta para los avisos de 24 h, 2 h y 15 min. La
  // funcion SQL es idempotente y los marcadores evitan avisos duplicados.
  @Cron('*/5 * * * *')
  async barrerRecordatorios(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ lock: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS lock',
        [LOCK_ID],
      );
      if (!rows[0]?.lock) return;

      try {
        const resultado = await client.query<{
          fn_agenda_recordatorios_sweep: number;
        }>('SELECT fn_agenda_recordatorios_sweep()');
        const cantidad = resultado.rows[0]?.fn_agenda_recordatorios_sweep ?? 0;
        if (cantidad > 0) {
          this.logger.log(
            `Agenda automatica: ${cantidad} evento(s) con recordatorio emitido`,
          );
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
      }
    } catch (err) {
      this.logger.error(
        `Barrido de recordatorios fallo: ${(err as Error).message}`,
      );
    } finally {
      client.release();
    }
  }
}
