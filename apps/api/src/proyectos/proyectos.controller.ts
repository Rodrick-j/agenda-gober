import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ProyectosService } from './proyectos.service';
import { CreateProyectoDto, UpdateProyectoDto } from './dto/create-proyecto.dto';

@Controller('proyectos')
export class ProyectosController {
  constructor(private readonly service: ProyectosService) {}

  @Get()
  listar(@Query('estado') estado?: string) {
    return this.service.listar(estado);
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Post()
  crear(@Body() dto: CreateProyectoDto) {
    return this.service.crear(dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: UpdateProyectoDto) {
    return this.service.actualizar(id, dto);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(id);
  }
}
