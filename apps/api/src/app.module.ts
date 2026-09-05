import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { TenantContextInterceptor } from './context/tenant-context.interceptor';
import { PublicacionesModule } from './publicaciones/publicaciones.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, PublicacionesModule],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor }],
})
export class AppModule {}
