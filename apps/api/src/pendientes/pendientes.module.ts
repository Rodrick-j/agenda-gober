import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { PendientesController } from './pendientes.controller';
import { PendientesService } from './pendientes.service';

@Module({
  imports: [ContextModule],
  controllers: [PendientesController],
  providers: [PendientesService],
})
export class PendientesModule {}
