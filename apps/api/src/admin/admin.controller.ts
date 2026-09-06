import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AdminService } from './admin.service';
import { ActualizarUsuarioDto, CrearUsuarioDto, ResetPasswordDto } from './dto/usuario.dto';

// Único módulo del sistema donde el rol se chequea en el código (RolesGuard)
// y no en una política RLS -- ver el comentario en roles.decorator.ts sobre
// por qué usuarios/usuario_roles no pueden tener RLS.
@Controller('admin/usuarios')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Post()
  crear(@Body() dto: CrearUsuarioDto) {
    return this.service.crear(dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarUsuarioDto) {
    return this.service.actualizar(id, dto);
  }

  @Post(':id/reset-password')
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.service.resetPassword(id, dto);
  }
}
