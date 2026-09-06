import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NotificacionesService } from './notificaciones.service';

@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly service: NotificacionesService) {}

  @Get()
  listar(@Query('soloNoLeidas') soloNoLeidas?: string) {
    return this.service.listar(soloNoLeidas === 'true');
  }

  @Get('conteo')
  conteo() {
    return this.service.conteo();
  }

  @Post('leer-todas')
  leerTodas() {
    return this.service.leerTodas();
  }

  @Post(':id/leida')
  marcarLeida(@Param('id') id: string) {
    return this.service.marcarLeida(id);
  }
}
