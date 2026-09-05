import { Controller, Get } from '@nestjs/common';
import { SecretariasService } from './secretarias.service';

@Controller('secretarias')
export class SecretariasController {
  constructor(private readonly service: SecretariasService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }
}
