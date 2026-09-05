import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PublicacionesService } from './publicaciones.service';
import { CreatePublicacionDto } from './dto/create-publicacion.dto';
import { UpdateEstadoDto } from './dto/update-estado.dto';

@Controller('publicaciones')
export class PublicacionesController {
  constructor(private readonly service: PublicacionesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
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
