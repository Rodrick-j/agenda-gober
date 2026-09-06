import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ReunionesService } from './reuniones.service';
import { UpsertActaDto } from './dto/acta.dto';
import { CreateCompromisoDto } from './dto/compromiso.dto';

// Comparte el prefijo /eventos con EventosController: una reunion ES un
// evento (ver comentario en la migracion 011), esto solo agrega su acta y
// sus compromisos.
@Controller('eventos')
export class ReunionesController {
  constructor(private readonly service: ReunionesService) {}

  @Get(':id/acta')
  obtenerActa(@Param('id') id: string) {
    return this.service.obtenerActa(id);
  }

  @Put(':id/acta')
  guardarActa(@Param('id') id: string, @Body() dto: UpsertActaDto) {
    return this.service.guardarActa(id, dto);
  }

  @Get(':id/compromisos')
  listarCompromisos(@Param('id') id: string) {
    return this.service.listarCompromisos(id);
  }

  @Post(':id/compromisos')
  crearCompromiso(@Param('id') id: string, @Body() dto: CreateCompromisoDto) {
    return this.service.crearCompromiso(id, dto);
  }
}
