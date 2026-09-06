import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { ReunionesController } from './reuniones.controller';
import { CompromisosController } from './compromisos.controller';
import { ReunionesService } from './reuniones.service';

@Module({
  imports: [ContextModule],
  controllers: [ReunionesController, CompromisosController],
  providers: [ReunionesService],
})
export class ReunionesModule {}
