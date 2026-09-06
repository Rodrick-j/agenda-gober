import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { Public } from './auth/public.decorator';
import { PG_POOL } from './database/database.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // Liveness: el proceso responde. No toca dependencias.
  @Public()
  @Get()
  live() {
    return { status: 'ok' };
  }

  // Readiness: además comprueba que la base responde. Es la que debe mirar
  // el balanceador / el orquestador antes de mandar tráfico.
  @Public()
  @Get('ready')
  async ready() {
    const startedAt = Date.now();
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
    return { status: 'ok', db: 'up', latencyMs: Date.now() - startedAt };
  }
}
