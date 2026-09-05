import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const PG_POOL = 'PG_POOL';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Pool({
          host: config.get<string>('DB_HOST'),
          port: config.get<number>('DB_PORT'),
          database: config.get<string>('DB_NAME'),
          user: config.get<string>('DB_USER'),
          password: config.get<string>('DB_PASSWORD'),
          // Certificado autofirmado en desarrollo: cifra pero no valida la
          // cadena de confianza. En producción, CA real + rejectUnauthorized: true.
          ssl: { rejectUnauthorized: false },
          max: 20,
        }),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}
