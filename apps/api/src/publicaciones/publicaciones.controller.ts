import { Body, Controller, Get, Post } from '@nestjs/common';
import { PublicacionesService } from './publicaciones.service';
import { CreatePublicacionDto } from './dto/create-publicacion.dto';

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
}
