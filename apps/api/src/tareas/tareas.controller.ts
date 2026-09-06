import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { TareasService } from './tareas.service';
import { CreateTareaDto } from './dto/create-tarea.dto';
import { UpdateTareaDto } from './dto/update-tarea.dto';
import { ReemplazarAsignadosDto } from './dto/asignados.dto';

@Controller('tareas')
export class TareasController {
  constructor(private readonly service: TareasService) {}

  @Get()
  listar(@Query('estado') estado?: string) {
    return this.service.listar(estado);
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Post()
  crear(@Body() dto: CreateTareaDto) {
    return this.service.crear(dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: UpdateTareaDto) {
    return this.service.actualizar(id, dto);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(id);
  }

  @Put(':id/asignados')
  reemplazarAsignados(@Param('id') id: string, @Body() dto: ReemplazarAsignadosDto) {
    return this.service.reemplazarAsignados(id, dto.usuarioIds);
  }
}
