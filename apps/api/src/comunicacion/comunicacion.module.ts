import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { ComunicacionController } from './comunicacion.controller';
import { ComunicacionService } from './comunicacion.service';

@Module({
  imports: [ContextModule],
  controllers: [ComunicacionController],
  providers: [ComunicacionService],
})
export class ComunicacionModule {}
