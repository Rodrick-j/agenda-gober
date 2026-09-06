import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AdminService } from './admin.service';
import { ActualizarSecretariaDto, CrearSecretariaDto } from './dto/secretaria.dto';

// GET vive en /secretarias (secretarias.controller.ts) -- el catálogo lo
// puede ver cualquier usuario autenticado, ya lo usan los selects de todo
// el frontend. Solo crear/editar es exclusivo de Super Administrador.
@Controller('admin/secretarias')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminSecretariasController {
  constructor(private readonly service: AdminService) {}

  @Post()
  crear(@Body() dto: CrearSecretariaDto) {
    return this.service.crearSecretaria(dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarSecretariaDto) {
    return this.service.actualizarSecretaria(id, dto);
  }
}
