import { Injectable, NotFoundException } from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { mapPgError } from '../common/pg-error.util';

export interface DocumentoDescarga {
  nombre_archivo: string;
  mime: string;
  contenido: Buffer;
}

@Injectable()
export class DocumentosService {
  constructor(private readonly tx: TxService) {}

  // Lista metadata (nunca el bytea). La RLS de documentos ya limita a los
  // adjuntos de publicaciones visibles para el usuario.
  listar(publicacionId: string) {
    return this.tx
      .query(
        `SELECT id, publicacion_id, nombre_archivo, mime, tamano_bytes, created_at
         FROM documentos WHERE publicacion_id = $1 ORDER BY created_at DESC`,
        [publicacionId],
      )
      .then((r) => r.rows);
  }

  async subir(
    publicacionId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    try {
      const { rows } = await this.tx.query(
        `INSERT INTO documentos (publicacion_id, nombre_archivo, mime, tamano_bytes, contenido, subido_por)
         VALUES ($1, $2, $3, $4, $5, NULLIF(current_setting('app.current_user_id', true), '')::uuid)
         RETURNING id, publicacion_id, nombre_archivo, mime, tamano_bytes, created_at`,
        [publicacionId, file.originalname, file.mimetype, file.size, file.buffer],
      );
      return rows[0];
    } catch (err) {
      // Si la publicación no es visible para el usuario, la política
      // documentos_insert lo rechaza (42501) -> 403.
      mapPgError(err);
    }
  }

  async descargar(id: string): Promise<DocumentoDescarga> {
    const { rows } = await this.tx.query<DocumentoDescarga>(
      `SELECT nombre_archivo, mime, contenido FROM documentos WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      // No existe, o existe pero su publicación no es visible para vos: no se
      // distingue, para no revelar la existencia de algo que no podés ver.
      throw new NotFoundException('Documento no encontrado');
    }
    return rows[0];
  }

  async eliminar(id: string) {
    const { rowCount } = await this.tx.query(`DELETE FROM documentos WHERE id = $1`, [id]);
    if (!rowCount) throw new NotFoundException('Documento no encontrado');
    return { eliminado: true };
  }
}
