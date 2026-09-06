import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { ProyectosController } from './proyectos.controller';
import { ProyectosService } from './proyectos.service';

@Module({
  imports: [ContextModule],
  controllers: [ProyectosController],
  providers: [ProyectosService],
})
export class ProyectosModule {}
