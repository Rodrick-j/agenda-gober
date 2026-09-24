import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { AuditoriaService, sanearFiltros } from './auditoria.service';

// Todo el módulo está detrás de la política RLS auditoria_select
// (gobernador / jefe_gabinete / admin). No hay guard extra: un rol sin
// acceso recibe listados vacíos y métricas en cero, nunca un 403.
@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly service: AuditoriaService) {}

  // @Query() sin DTO: los params llegan crudos y sanearFiltros() los
  // normaliza. La ValidationPipe global (whitelist) no aplica acá porque el
  // metatype es Object, no una clase validada.
  @Get()
  listar(@Query() q: Record<string, string | undefined>) {
    return this.service.findAll(sanearFiltros(q), q.pagina, q.porPagina);
  }

  // Rutas estáticas ANTES de :id para que Express no las capture como id.
  @Get('resumen')
  resumen(@Query() q: Record<string, string | undefined>) {
    return this.service.resumen(sanearFiltros(q));
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="auditoria.csv"')
  exportar(@Query() q: Record<string, string | undefined>) {
    return this.service.exportarCsv(sanearFiltros(q));
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }
}
