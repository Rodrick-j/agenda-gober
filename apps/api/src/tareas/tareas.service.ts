import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { mapPgError } from '../common/pg-error.util';
import { CreateTareaDto } from './dto/create-tarea.dto';
import { UpdateTareaDto } from './dto/update-tarea.dto';

const SELECT_FIELDS = `
  id, secretaria_id, titulo, descripcion, estado, prioridad, fecha_vencimiento,
  nivel_confidencialidad, creado_por, created_at, updated_at
`;

@Injectable()
export class TareasService {
  constructor(private readonly tx: TxService) {}

  // RLS filtra secretaria + rango de confidencialidad + asignados, igual que
  // eventos_agenda. estado es opcional para poder pintar un tablero por columna.
  async listar(estado?: string) {
    const { rows } = await this.tx.query(
      `SELECT ${SELECT_FIELDS} FROM tareas
       WHERE $1::tarea_estado IS NULL OR estado = $1::tarea_estado
       ORDER BY fecha_vencimiento NULLS LAST, created_at DESC`,
      [estado ?? null],
    );
    return rows;
  }

  async obtener(id: string) {
    const { rows } = await this.tx.query(`SELECT ${SELECT_FIELDS} FROM tareas WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('Tarea no encontrada');

    const { rows: asignados } = await this.tx.query(
      `SELECT u.id, u.nombre, u.email
       FROM tarea_asignados ta JOIN usuarios u ON u.id = ta.usuario_id
       WHERE ta.tarea_id = $1`,
      [id],
    );
    return { ...rows[0], asignados };
  }

  async crear(dto: CreateTareaDto) {
    const { userId, secretariaId, rol } = this.tx.currentUser;
    const esTransversal = ['gobernador', 'jefe_gabinete', 'admin'].includes(rol);
    if (!esTransversal && !secretariaId) {
      throw new ForbiddenException('Tu rol no está asociado a una secretaría');
    }

    try {
      const { rows } = await this.tx.query(
        `INSERT INTO tareas
           (secretaria_id, titulo, descripcion, prioridad, fecha_vencimiento, nivel_confidencialidad, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${SELECT_FIELDS}`,
        [
          esTransversal ? null : secretariaId,
          dto.titulo,
          dto.descripcion ?? null,
          dto.prioridad ?? 'media',
          dto.fechaVencimiento ?? null,
          dto.nivelConfidencialidad,
          userId,
        ],
      );
      const tarea = rows[0];

      if (dto.asignadoIds?.length) {
        await this.reemplazarAsignados(tarea.id, dto.asignadoIds);
      }

      return tarea;
    } catch (err) {
      mapPgError(err);
    }
  }

  async actualizar(id: string, dto: UpdateTareaDto) {
    const campos: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    const mapa: Record<string, unknown> = {
      titulo: dto.titulo,
      descripcion: dto.descripcion,
      estado: dto.estado,
      prioridad: dto.prioridad,
      fecha_vencimiento: dto.fechaVencimiento,
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
        `UPDATE tareas SET ${campos.join(', ')} WHERE id = $${i} RETURNING ${SELECT_FIELDS}`,
        valores,
      );
      if (rows.length === 0) throw new NotFoundException('Tarea no encontrada');
      return rows[0];
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }

  async eliminar(id: string) {
    const { rowCount } = await this.tx.query(`DELETE FROM tareas WHERE id = $1`, [id]);
    if (!rowCount) throw new NotFoundException('Tarea no encontrada');
    return { eliminado: true };
  }

  async reemplazarAsignados(tareaId: string, usuarioIds: string[]) {
    try {
      await this.tx.query(`DELETE FROM tarea_asignados WHERE tarea_id = $1`, [tareaId]);
      for (const usuarioId of usuarioIds) {
        await this.tx.query(`INSERT INTO tarea_asignados (tarea_id, usuario_id) VALUES ($1, $2)`, [
          tareaId,
          usuarioId,
        ]);
      }
      return { actualizado: true };
    } catch (err) {
      mapPgError(err);
    }
  }
}
