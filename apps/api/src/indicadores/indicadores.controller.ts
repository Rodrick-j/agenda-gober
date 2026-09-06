import { Controller, Get } from '@nestjs/common';
import { IndicadoresService } from './indicadores.service';

@Controller('indicadores')
export class IndicadoresController {
  constructor(private readonly service: IndicadoresService) {}

  @Get('resumen')
  resumen() {
    return this.service.resumen();
  }
}
