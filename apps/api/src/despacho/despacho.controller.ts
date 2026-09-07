import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DespachoService } from './despacho.service';
import { CreateInstruccionDto } from './dto/create-instruccion.dto';
import { UpdateInstruccionDto } from './dto/update-instruccion.dto';
import { CreateItemDto } from './dto/create-item.dto';
import { VistoDto } from './dto/visto.dto';
import { MotivoDto } from './dto/motivo.dto';
import { EvidenciaMetaDto } from './dto/evidencia.dto';
import { PorTareasDto } from './dto/por-tareas.dto';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB, igual que documentos

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

  @Get(':id/bitacora')
  bitacora(@Param('id') id: string) {
    return this.service.getBitacora(id);
  }

  @Post()
  emitir(@Body() dto: CreateInstruccionDto) {
    return this.service.emitir(dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: UpdateInstruccionDto) {
    return this.service.actualizar(id, dto);
  }

  @Post(':id/reabrir')
  reabrir(@Param('id') id: string, @Body() dto: MotivoDto) {
    return this.service.reabrir(id, dto.motivo);
  }

  @Post(':id/items')
  agregarItem(@Param('id') id: string, @Body() dto: CreateItemDto) {
    return this.service.agregarItem(id, dto);
  }

  @Delete(':id/items/:itemId')
  quitarItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.quitarItem(id, itemId);
  }

  // Gabinete (transversal): valida / devuelve; devuelve la instrucción completa.
  @Post(':id/items/:itemId/validar')
  validar(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.validarItem(id, itemId);
  }

  @Post(':id/items/:itemId/devolver')
  devolver(@Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: MotivoDto) {
    return this.service.devolverItem(id, itemId, dto.motivo);
  }

  @Post(':id/visto')
  marcarVisto(@Param('id') id: string, @Body() dto: VistoDto) {
    return this.service.marcarVisto(id, dto);
  }
}

// Rutas item-scoped: las usa el RESPONSABLE de la tarea, que no ve la
// instrucción madre. Sirven igual para el detalle de Despacho y para la
// lista de Tareas.
@Controller('despacho/items')
export class DespachoItemsController {
  constructor(private readonly service: DespachoService) {}

  @Post('por-tareas')
  itemsPorTareas(@Body() dto: PorTareasDto) {
    return this.service.itemsPorTareas(dto.tareaIds);
  }

  @Get('evidencias/:evidenciaId/descargar')
  async descargarEvidencia(@Param('evidenciaId') evidenciaId: string) {
    const ev = await this.service.descargarEvidencia(evidenciaId);
    return new StreamableFile(ev.contenido, {
      type: ev.mime,
      disposition: `attachment; filename="${encodeURIComponent(ev.nombre_archivo)}"`,
    });
  }

  @Post(':itemId/solicitar-validacion')
  solicitarValidacion(@Param('itemId') itemId: string) {
    return this.service.solicitarValidacion(itemId);
  }

  @Get(':itemId/evidencias')
  listarEvidencias(@Param('itemId') itemId: string) {
    return this.service.listarEvidencias(itemId);
  }

  @Post(':itemId/evidencias')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: MAX_BYTES } }))
  subirEvidencia(
    @Param('itemId') itemId: string,
    @Body() meta: EvidenciaMetaDto,
    @UploadedFile() archivo?: Express.Multer.File,
  ) {
    if (!archivo) throw new BadRequestException('Falta el archivo (campo "archivo")');
    return this.service.subirEvidencia(itemId, archivo, meta);
  }
}
