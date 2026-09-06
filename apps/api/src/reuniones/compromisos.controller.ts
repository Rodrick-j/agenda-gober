import { Body, Controller, Delete, Param, Patch } from '@nestjs/common';
import { ReunionesService } from './reuniones.service';
import { UpdateCompromisoDto } from './dto/compromiso.dto';

@Controller('compromisos')
export class CompromisosController {
  constructor(private readonly service: ReunionesService) {}

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: UpdateCompromisoDto) {
    return this.service.actualizarCompromiso(id, dto);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.service.eliminarCompromiso(id);
  }
}
