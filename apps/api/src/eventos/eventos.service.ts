import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { mapPgError } from '../common/pg-error.util';
import { CreateEventoDto } from './dto/create-evento.dto';
import { UpdateEventoDto } from './dto/update-evento.dto';

const SELECT_FIELDS = `
  id, secretaria_id, titulo, descripcion, lugar, fecha_inicio, fecha_fin,
  nivel_confidencialidad, creado_por, created_at, updated_at
`;

@Injectable()
export class EventosService {
  constructor(private readonly tx: TxService) {}

  // Rango de fechas para la vista de calendario. RLS filtra secretaria +
  // rango de confidencialidad + invitados, exactamente igual que publicaciones.
  async listar(desde?: string, hasta?: string) {
    const { rows } = await this.tx.query(
      `SELECT ${SELECT_FIELDS} FROM eventos_agenda
       WHERE ($1::timestamptz IS NULL OR fecha_fin >= $1)
         AND ($2::timestamptz IS NULL OR fecha_inicio <= $2)
       ORDER BY fecha_inicio`,
      [desde ?? null, hasta ?? null],
    );
    return rows;
  }

  async obtener(id: string) {
    const { rows } = await this.tx.query(`SELECT ${SELECT_FIELDS} FROM eventos_agenda WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('Evento no encontrado');

    const { rows: responsables } = await this.tx.query(
      `SELECT u.id, u.nombre, u.email
       FROM evento_responsables er JOIN usuarios u ON u.id = er.usuario_id
       WHERE er.evento_id = $1`,
      [id],
    );

    // Se incluye para que el modulo Reuniones pueda ofrecer un selector de
    // responsable de compromiso sin necesitar un endpoint de "listar
    // usuarios": el creador + los invitados son el unico universo conocido
    // y ya visible para quien puede ver este evento.
    const { rows: creadorRows } = await this.tx.query(
      `SELECT id, nombre, email FROM usuarios WHERE id = $1`,
      [rows[0].creado_por],
    );

    return { ...rows[0], responsables, creador: creadorRows[0] ?? null };
  }

  async crear(dto: CreateEventoDto) {
    if (new Date(dto.fechaFin) < new Date(dto.fechaInicio)) {
      throw new BadRequestException('fechaFin no puede ser anterior a fechaInicio');
    }

    const { userId, secretariaId, rol } = this.tx.currentUser;
    const esTransversal = ['gobernador', 'jefe_gabinete', 'admin'].includes(rol);
    if (!esTransversal && !secretariaId) {
      throw new ForbiddenException('Tu rol no está asociado a una secretaría');
    }

    try {
      const { rows } = await this.tx.query(
        `INSERT INTO eventos_agenda
           (secretaria_id, titulo, descripcion, lugar, fecha_inicio, fecha_fin, nivel_confidencialidad, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${SELECT_FIELDS}`,
        [
          esTransversal ? null : secretariaId,
          dto.titulo,
          dto.descripcion ?? null,
          dto.lugar ?? null,
          dto.fechaInicio,
          dto.fechaFin,
          dto.nivelConfidencialidad,
          userId,
        ],
      );
      const evento = rows[0];

      if (dto.responsableIds?.length) {
        await this.reemplazarResponsables(evento.id, dto.responsableIds);
      }

      return evento;
    } catch (err) {
      mapPgError(err);
    }
  }

  async actualizar(id: string, dto: UpdateEventoDto) {
    const campos: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    const mapa: Record<string, unknown> = {
      titulo: dto.titulo,
      descripcion: dto.descripcion,
      lugar: dto.lugar,
      fecha_inicio: dto.fechaInicio,
      fecha_fin: dto.fechaFin,
      nivel_confidencialidad: dto.nivelConfidencialidad,
    };
    for (const [columna, valor] of Object.entries(mapa)) {
      if (valor !== undefined) {
        campos.push(`${columna} = $${i++}`);
        valores.push(valor);
      }
    }
    if (campos.length === 0) return this.obtener(id);

    campos.push(`updated_at = now()`);
    valores.push(id);

    try {
      const { rows } = await this.tx.query(
        `UPDATE eventos_agenda SET ${campos.join(', ')} WHERE id = $${i} RETURNING ${SELECT_FIELDS}`,
        valores,
      );
      if (rows.length === 0) throw new NotFoundException('Evento no encontrado');
      return rows[0];
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }

  async eliminar(id: string) {
    const { rowCount } = await this.tx.query(`DELETE FROM eventos_agenda WHERE id = $1`, [id]);
    if (!rowCount) throw new NotFoundException('Evento no encontrado');
    return { eliminado: true };
  }

  // Reemplaza el set completo de invitados (mas simple e idempotente que
  // agregar/quitar de a uno).
  async reemplazarResponsables(eventoId: string, usuarioIds: string[]) {
    try {
      await this.tx.query(`DELETE FROM evento_responsables WHERE evento_id = $1`, [eventoId]);
      for (const usuarioId of usuarioIds) {
        await this.tx.query(
          `INSERT INTO evento_responsables (evento_id, usuario_id) VALUES ($1, $2)`,
          [eventoId, usuarioId],
        );
      }
      return { actualizado: true };
    } catch (err) {
      mapPgError(err);
    }
  }
}
