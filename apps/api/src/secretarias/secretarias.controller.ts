import { Controller, Get } from '@nestjs/common';
import { SecretariasService } from './secretarias.service';

@Controller('secretarias')
export class SecretariasController {
  constructor(private readonly service: SecretariasService) {}

  // Antes que ':id' si algún día se agrega -- por ahora no hay conflicto,
  // pero "miembros" como ruta fija siempre debe quedar primero.
  @Get('miembros')
  miembros() {
    return this.service.miembros();
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }
}
