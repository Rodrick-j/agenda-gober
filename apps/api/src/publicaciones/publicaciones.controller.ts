import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PublicacionesService } from './publicaciones.service';
import { CreatePublicacionDto } from './dto/create-publicacion.dto';
import { UpdateEstadoDto } from './dto/update-estado.dto';

@Controller('publicaciones')
export class PublicacionesController {
  constructor(private readonly service: PublicacionesService) {}

  @Get()
  findAll(@Query('pagina') pagina?: string, @Query('porPagina') porPagina?: string) {
    return this.service.findAll(pagina, porPagina);
  }

  @Post()
  create(@Body() dto: CreatePublicacionDto) {
    return this.service.create(dto);
  }

  @Patch(':id/estado')
  updateEstado(@Param('id') id: string, @Body() dto: UpdateEstadoDto) {
    return this.service.updateEstado(id, dto.estado);
  }
}
