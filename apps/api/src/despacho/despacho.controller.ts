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

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB, igual que documentos

@Controller('despacho/instrucciones')
export class DespachoController {
  constructor(private readonly service: DespachoService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  // Antes de ':id' para que 'evidencias' no caiga en el param.
  @Get('evidencias/:evidenciaId/descargar')
  async descargarEvidencia(@Param('evidenciaId') evidenciaId: string) {
    const ev = await this.service.descargarEvidencia(evidenciaId);
    return new StreamableFile(ev.contenido, {
      type: ev.mime,
      disposition: `attachment; filename="${encodeURIComponent(ev.nombre_archivo)}"`,
    });
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

  @Post(':id/items/:itemId/solicitar-validacion')
  solicitarValidacion(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.solicitarValidacion(id, itemId);
  }

  @Post(':id/items/:itemId/validar')
  validar(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.validarItem(id, itemId);
  }

  @Post(':id/items/:itemId/devolver')
  devolver(@Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: MotivoDto) {
    return this.service.devolverItem(id, itemId, dto.motivo);
  }

  @Get(':id/items/:itemId/evidencias')
  listarEvidencias(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.listarEvidencias(id, itemId);
  }

  @Post(':id/items/:itemId/evidencias')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: MAX_BYTES } }))
  subirEvidencia(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() meta: EvidenciaMetaDto,
    @UploadedFile() archivo?: Express.Multer.File,
  ) {
    if (!archivo) throw new BadRequestException('Falta el archivo (campo "archivo")');
    return this.service.subirEvidencia(id, itemId, archivo, meta);
  }

  @Post(':id/visto')
  marcarVisto(@Param('id') id: string, @Body() dto: VistoDto) {
    return this.service.marcarVisto(id, dto);
  }
}
