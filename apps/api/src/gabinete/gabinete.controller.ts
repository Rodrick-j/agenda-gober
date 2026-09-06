import { Controller, Get } from '@nestjs/common';
import { GabineteService } from './gabinete.service';

@Controller('gabinete')
export class GabineteController {
  constructor(private readonly service: GabineteService) {}

  @Get('resumen')
  resumen() {
    return this.service.resumen();
  }
}
