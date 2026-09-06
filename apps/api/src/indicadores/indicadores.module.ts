import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { IndicadoresController } from './indicadores.controller';
import { IndicadoresService } from './indicadores.service';

@Module({
  imports: [ContextModule],
  controllers: [IndicadoresController],
  providers: [IndicadoresService],
})
export class IndicadoresModule {}
