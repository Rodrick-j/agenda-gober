import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { PublicacionesController } from './publicaciones.controller';
import { PublicacionesService } from './publicaciones.service';
import { PublicacionesSweepService } from './publicaciones-sweep.service';

@Module({
  imports: [ContextModule],
  controllers: [PublicacionesController],
  providers: [PublicacionesService, PublicacionesSweepService],
})
export class PublicacionesModule {}
