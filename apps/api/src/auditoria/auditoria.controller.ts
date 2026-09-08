import { Controller, Get, Query } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';

@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly service: AuditoriaService) {}

  @Get()
  findAll(@Query('pagina') pagina?: string, @Query('porPagina') porPagina?: string) {
    return this.service.findAll(pagina, porPagina);
  }
}
