import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { TareasController } from './tareas.controller';
import { TareasService } from './tareas.service';

@Module({
  imports: [ContextModule],
  controllers: [TareasController],
  providers: [TareasService],
})
export class TareasModule {}
