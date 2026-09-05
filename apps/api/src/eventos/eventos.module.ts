import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { EventosController } from './eventos.controller';
import { EventosService } from './eventos.service';

@Module({
  imports: [ContextModule],
  controllers: [EventosController],
  providers: [EventosService],
})
export class EventosModule {}
