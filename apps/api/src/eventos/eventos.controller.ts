import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { EventosService } from './eventos.service';
import { CreateEventoDto } from './dto/create-evento.dto';
import { UpdateEventoDto } from './dto/update-evento.dto';
import { ReemplazarResponsablesDto } from './dto/responsables.dto';

@Controller('eventos')
export class EventosController {
  constructor(private readonly service: EventosService) {}

  @Get()
  listar(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.service.listar(desde, hasta);
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Post()
  crear(@Body() dto: CreateEventoDto) {
    return this.service.crear(dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: UpdateEventoDto) {
    return this.service.actualizar(id, dto);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(id);
  }

  @Put(':id/responsables')
  reemplazarResponsables(@Param('id') id: string, @Body() dto: ReemplazarResponsablesDto) {
    return this.service.reemplazarResponsables(id, dto.usuarioIds);
  }
}
