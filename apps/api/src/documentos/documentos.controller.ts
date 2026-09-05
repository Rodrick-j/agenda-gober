import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentosService } from './documentos.service';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

@Controller()
export class DocumentosController {
  constructor(private readonly service: DocumentosService) {}

  @Get('publicaciones/:publicacionId/documentos')
  listar(@Param('publicacionId') publicacionId: string) {
    return this.service.listar(publicacionId);
  }

  @Post('publicaciones/:publicacionId/documentos')
  @UseInterceptors(
    FileInterceptor('archivo', {
      limits: { fileSize: MAX_BYTES },
      // memoryStorage: el buffer queda en memoria y va directo al bytea; no
      // se escribe ningún archivo temporal en disco.
    }),
  )
  subir(
    @Param('publicacionId') publicacionId: string,
    @UploadedFile() archivo?: Express.Multer.File,
  ) {
    if (!archivo) throw new BadRequestException('Falta el archivo (campo "archivo")');
    return this.service.subir(publicacionId, archivo);
  }

  @Get('documentos/:id/descargar')
  async descargar(@Param('id') id: string) {
    const doc = await this.service.descargar(id);
    return new StreamableFile(doc.contenido, {
      type: doc.mime,
      disposition: `attachment; filename="${encodeURIComponent(doc.nombre_archivo)}"`,
    });
  }

  @Delete('documentos/:id')
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(id);
  }
}
