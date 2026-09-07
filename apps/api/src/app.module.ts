import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { TenantContextInterceptor } from './context/tenant-context.interceptor';
import { PublicacionesModule } from './publicaciones/publicaciones.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { SecretariasModule } from './secretarias/secretarias.module';
import { DocumentosModule } from './documentos/documentos.module';
import { EventosModule } from './eventos/eventos.module';
import { TareasModule } from './tareas/tareas.module';
import { GabineteModule } from './gabinete/gabinete.module';
import { ProyectosModule } from './proyectos/proyectos.module';
import { IndicadoresModule } from './indicadores/indicadores.module';
import { ReunionesModule } from './reuniones/reuniones.module';
import { DespachoModule } from './despacho/despacho.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DatabaseModule,
    AuthModule,
    PublicacionesModule,
    AuditoriaModule,
    SecretariasModule,
    DocumentosModule,
    EventosModule,
    TareasModule,
    GabineteModule,
    ProyectosModule,
    IndicadoresModule,
    ReunionesModule,
    DespachoModule,
    NotificacionesModule,
    AdminModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
