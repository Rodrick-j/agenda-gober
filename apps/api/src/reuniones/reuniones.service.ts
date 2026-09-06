import { Injectable, NotFoundException } from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { mapPgError } from '../common/pg-error.util';
import { UpsertActaDto } from './dto/acta.dto';
import { CreateCompromisoDto, UpdateCompromisoDto } from './dto/compromiso.dto';

const COMPROMISO_FIELDS = `
  c.id, c.evento_id, c.descripcion, c.responsable_id, c.fecha_limite, c.estado,
  c.created_at, c.updated_at, u.nombre AS responsable_nombre
`;

@Injectable()
export class ReunionesService {
  constructor(private readonly tx: TxService) {}

  async obtenerActa(eventoId: string) {
    const { rows } = await this.tx.query(
      `SELECT evento_id, contenido, actualizado_por, created_at, updated_at
       FROM reunion_actas WHERE evento_id = $1`,
      [eventoId],
    );
    return rows[0] ?? null;
  }

  // Upsert: registrar el acta es idempotente, no tiene sentido un historial
  // de "versiones" para un primer corte -- se sobreescribe.
  async guardarActa(eventoId: string, dto: UpsertActaDto) {
    const { userId } = this.tx.currentUser;
    try {
      const { rows } = await this.tx.query(
        `INSERT INTO reunion_actas (evento_id, contenido, actualizado_por)
         VALUES ($1, $2, $3)
         ON CONFLICT (evento_id) DO UPDATE
           SET contenido = EXCLUDED.contenido, actualizado_por = EXCLUDED.actualizado_por, updated_at = now()
         RETURNING evento_id, contenido, actualizado_por, created_at, updated_at`,
        [eventoId, dto.contenido, userId],
      );
      return rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async listarCompromisos(eventoId: string) {
    const { rows } = await this.tx.query(
      `SELECT ${COMPROMISO_FIELDS}
       FROM compromisos c LEFT JOIN usuarios u ON u.id = c.responsable_id
       WHERE c.evento_id = $1
       ORDER BY c.created_at`,
      [eventoId],
    );
    return rows;
  }

  async crearCompromiso(eventoId: string, dto: CreateCompromisoDto) {
    try {
      const { rows } = await this.tx.query(
        `INSERT INTO compromisos (evento_id, descripcion, responsable_id, fecha_limite)
         VALUES ($1, $2, $3, $4)
         RETURNING id, evento_id, descripcion, responsable_id, fecha_limite, estado, created_at, updated_at`,
        [eventoId, dto.descripcion, dto.responsableId ?? null, dto.fechaLimite ?? null],
      );
      return rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async actualizarCompromiso(id: string, dto: UpdateCompromisoDto) {
    const campos: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    const mapa: Record<string, unknown> = {
      descripcion: dto.descripcion,
      responsable_id: dto.responsableId,
      fecha_limite: dto.fechaLimite,
      estado: dto.estado,
    };
    for (const [columna, valor] of Object.entries(mapa)) {
      if (valor !== undefined) {
        campos.push(`${columna} = $${i++}`);
        valores.push(valor);
      }
    }
    if (campos.length === 0) {
      const { rows } = await this.tx.query(
        `SELECT id, evento_id, descripcion, responsable_id, fecha_limite, estado, created_at, updated_at
         FROM compromisos WHERE id = $1`,
        [id],
      );
      if (rows.length === 0) throw new NotFoundException('Compromiso no encontrado');
      return rows[0];
    }

    campos.push(`updated_at = now()`);
    valores.push(id);

    try {
      const { rows } = await this.tx.query(
        `UPDATE compromisos SET ${campos.join(', ')} WHERE id = $${i}
         RETURNING id, evento_id, descripcion, responsable_id, fecha_limite, estado, created_at, updated_at`,
        valores,
      );
      if (rows.length === 0) throw new NotFoundException('Compromiso no encontrado');
      return rows[0];
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }

  async eliminarCompromiso(id: string) {
    const { rowCount } = await this.tx.query(`DELETE FROM compromisos WHERE id = $1`, [id]);
    if (!rowCount) throw new NotFoundException('Compromiso no encontrado');
    return { eliminado: true };
  }
}
