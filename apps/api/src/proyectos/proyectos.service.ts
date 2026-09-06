import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { mapPgError } from '../common/pg-error.util';
import { CreateProyectoDto, UpdateProyectoDto } from './dto/create-proyecto.dto';

const SELECT_FIELDS = `
  id, secretaria_id, nombre, descripcion, estado, avance_porcentaje, presupuesto,
  fecha_inicio, fecha_fin_estimada, nivel_confidencialidad, creado_por, created_at, updated_at
`;

@Injectable()
export class ProyectosService {
  constructor(private readonly tx: TxService) {}

  async listar(estado?: string) {
    const { rows } = await this.tx.query(
      `SELECT ${SELECT_FIELDS} FROM proyectos
       WHERE $1::proyecto_estado IS NULL OR estado = $1::proyecto_estado
       ORDER BY created_at DESC`,
      [estado ?? null],
    );
    return rows;
  }

  async obtener(id: string) {
    const { rows } = await this.tx.query(`SELECT ${SELECT_FIELDS} FROM proyectos WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('Proyecto no encontrado');
    return rows[0];
  }

  async crear(dto: CreateProyectoDto) {
    const { userId, secretariaId, rol } = this.tx.currentUser;
    const esTransversal = ['gobernador', 'jefe_gabinete', 'admin'].includes(rol);
    if (!esTransversal && !secretariaId) {
      throw new ForbiddenException('Tu rol no está asociado a una secretaría');
    }

    try {
      const { rows } = await this.tx.query(
        `INSERT INTO proyectos
           (secretaria_id, nombre, descripcion, presupuesto, fecha_inicio, fecha_fin_estimada, nivel_confidencialidad, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${SELECT_FIELDS}`,
        [
          esTransversal ? null : secretariaId,
          dto.nombre,
          dto.descripcion ?? null,
          dto.presupuesto ?? null,
          dto.fechaInicio ?? null,
          dto.fechaFinEstimada ?? null,
          dto.nivelConfidencialidad,
          userId,
        ],
      );
      return rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async actualizar(id: string, dto: UpdateProyectoDto) {
    const campos: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    const mapa: Record<string, unknown> = {
      nombre: dto.nombre,
      descripcion: dto.descripcion,
      estado: dto.estado,
      avance_porcentaje: dto.avancePorcentaje,
      presupuesto: dto.presupuesto,
      fecha_inicio: dto.fechaInicio,
      fecha_fin_estimada: dto.fechaFinEstimada,
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
        `UPDATE proyectos SET ${campos.join(', ')} WHERE id = $${i} RETURNING ${SELECT_FIELDS}`,
        valores,
      );
      if (rows.length === 0) throw new NotFoundException('Proyecto no encontrado');
      return rows[0];
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }

  async eliminar(id: string) {
    const { rowCount } = await this.tx.query(`DELETE FROM proyectos WHERE id = $1`, [id]);
    if (!rowCount) throw new NotFoundException('Proyecto no encontrado');
    return { eliminado: true };
  }
}
