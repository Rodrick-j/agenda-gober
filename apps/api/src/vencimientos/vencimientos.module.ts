import { Module } from '@nestjs/common';
import { VencimientosSweepService } from './vencimientos-sweep.service';

// Cruza tareas y compromisos (Reuniones), así que vive en su propio módulo en
// vez de colgar de uno u otro. PG_POOL viene de DatabaseModule (@Global) y el
// scheduler de ScheduleModule.forRoot() en AppModule.
@Module({
  providers: [VencimientosSweepService],
})
export class VencimientosModule {}
