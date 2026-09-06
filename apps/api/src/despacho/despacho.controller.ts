import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { DespachoService } from './despacho.service';
import { CreateInstruccionDto } from './dto/create-instruccion.dto';
import { UpdateInstruccionDto } from './dto/update-instruccion.dto';
import { CreateItemDto } from './dto/create-item.dto';
import { VistoDto } from './dto/visto.dto';

@Controller('despacho/instrucciones')
export class DespachoController {
  constructor(private readonly service: DespachoService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Post()
  emitir(@Body() dto: CreateInstruccionDto) {
    return this.service.emitir(dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: UpdateInstruccionDto) {
    return this.service.actualizar(id, dto);
  }

  @Post(':id/items')
  agregarItem(@Param('id') id: string, @Body() dto: CreateItemDto) {
    return this.service.agregarItem(id, dto);
  }

  @Delete(':id/items/:itemId')
  quitarItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.quitarItem(id, itemId);
  }

  @Post(':id/visto')
  marcarVisto(@Param('id') id: string, @Body() dto: VistoDto) {
    return this.service.marcarVisto(id, dto);
  }
}
