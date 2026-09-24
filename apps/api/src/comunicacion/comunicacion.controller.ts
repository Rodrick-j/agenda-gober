import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ComunicacionService } from './comunicacion.service';
import { ActualizarCoberturaDto, PedirCoberturaDto } from './dto/cobertura.dto';

// Todo el módulo va detrás de la RLS de `cobertura`: un rol sin acceso recibe
// listados vacíos, no un 403.
@Controller('comunicacion')
export class ComunicacionController {
  constructor(private readonly service: ComunicacionService) {}

  @Get()
  listar(
    @Query('mes') mes?: string,
    @Query('estado') estado?: string,
    @Query('secretaria') secretaria?: string,
  ) {
    return this.service.listar(mes, estado, secretaria);
  }

  @Post()
  pedir(@Body() dto: PedirCoberturaDto) {
    return this.service.pedir(dto.eventoId);
  }

  // Ruta estática antes de :id.
  @Get('equipo')
  equipo() {
    return this.service.equipo();
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarCoberturaDto) {
    return this.service.actualizar(id, dto);
  }

  @Post(':id/gabinete-visto')
  darVisto(@Param('id') id: string) {
    return this.service.darVistoGabinete(id);
  }
}
