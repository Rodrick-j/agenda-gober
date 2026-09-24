import { Controller, Get } from '@nestjs/common';
import { PendientesService } from './pendientes.service';

@Controller('pendientes')
export class PendientesController {
  constructor(private readonly service: PendientesService) {}

  @Get()
  mias() {
    return this.service.mias();
  }
}
