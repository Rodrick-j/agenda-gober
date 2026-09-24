import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { mapPgError } from '../common/pg-error.util';
import { ActualizarCoberturaDto } from './dto/cobertura.dto';

// Trae la cobertura + los datos del evento (LEFT JOIN: UNICOM ve la agenda
// pero un solicitante de otra secretaría podría no ver ese evento) + nombres.
const SELECT_FIELDS = `
  c.id, c.evento_id, c.estado, c.solicitada_por, c.solicitada_at,
  c.comunicador_id, c.tipo_pieza, c.enfoque,
  c.gabinete_visto_at, c.gabinete_por, c.publicacion_id, c.updated_at,
  e.titulo AS evento_titulo, e.fecha_inicio AS evento_fecha,
  e.lugar AS evento_lugar, e.secretaria_id AS evento_secretaria_id,
  s.nombre AS secretaria_nombre,
  sol.nombre AS solicitante_nombre,
  com.nombre AS comunicador_nombre
`;

const JOINS = `
  LEFT JOIN eventos_agenda e ON e.id = c.evento_id
  LEFT JOIN secretarias    s ON s.id = e.secretaria_id
  LEFT JOIN usuarios     sol ON sol.id = c.solicitada_por
  LEFT JOIN usuarios     com ON com.id = c.comunicador_id
`;

@Injectable()
export class ComunicacionService {
  constructor(private readonly tx: TxService) {}

  // La RLS de cobertura ya limita: transversal + unicom ven todo; la
  // secretaría dueña ve las suyas.
  async listar(mes?: string, estado?: string, secretariaId?: string) {
    // mes = 'YYYY-MM' -> filtra por fecha del evento en horario de Bolivia.
    const cond: string[] = [];
    const params: unknown[] = [];
    const P = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (mes && /^\d{4}-\d{2}$/.test(mes)) {
      cond.push(
        `date_trunc('month', e.fecha_inicio AT TIME ZONE 'America/La_Paz') = to_date(${P(mes)}, 'YYYY-MM')`,
      );
    }
    if (estado) cond.push(`c.estado = ${P(estado)}::cobertura_estado`);
    if (secretariaId && /^[0-9a-f-]{36}$/i.test(secretariaId)) {
      cond.push(`e.secretaria_id = ${P(secretariaId)}`);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const { rows } = await this.tx.query(
      `SELECT ${SELECT_FIELDS}
       FROM cobertura c
       ${JOINS}
       ${where}
       ORDER BY e.fecha_inicio ASC NULLS LAST, c.solicitada_at ASC`,
      params,
    );
    return rows;
  }

  async obtener(id: string) {
    const { rows } = await this.tx.query(
      `SELECT ${SELECT_FIELDS} FROM cobertura c ${JOINS} WHERE c.id = $1`,
      [id],
    );
    if (rows.length === 0)
      throw new NotFoundException('Cobertura no encontrada');
    return rows[0];
  }

  // Comunicadores disponibles para asignar a una cobertura (rol unicom activo).
  async equipo() {
    const { rows } = await this.tx.query(
      `SELECT u.id, u.nombre
       FROM usuarios u
       JOIN usuario_roles ur ON ur.usuario_id = u.id
       JOIN roles r          ON r.id = ur.rol_id
       WHERE r.nombre = 'unicom' AND u.activo = true
       ORDER BY u.nombre`,
    );
    return rows;
  }

  // La política cobertura_insert decide si el rol puede pedir cobertura de
  // ESE evento (director+ de la secretaría dueña, o UNICOM).
  async pedir(eventoId: string) {
    const { userId } = this.tx.currentUser;
    try {
      const { rows } = await this.tx.query(
        `INSERT INTO cobertura (evento_id, solicitada_por)
         VALUES ($1, $2)
         RETURNING id`,
        [eventoId, userId],
      );
      return this.obtener(rows[0].id);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        throw new ConflictException(
          'Ese evento ya tiene una solicitud de cobertura',
        );
      }
      if (code === '23503') {
        throw new NotFoundException('Evento no encontrado');
      }
      mapPgError(err);
    }
  }

  async actualizar(id: string, dto: ActualizarCoberturaDto) {
    const mapa: Record<string, unknown> = {
      estado: dto.estado,
      comunicador_id: dto.comunicadorId,
      tipo_pieza: dto.tipoPieza,
      enfoque: dto.enfoque,
      publicacion_id: dto.publicacionId,
    };
    const campos: string[] = [];
    const valores: unknown[] = [];
    let i = 1;
    for (const [col, val] of Object.entries(mapa)) {
      if (val !== undefined) {
        campos.push(`${col} = $${i++}`);
        valores.push(val);
      }
    }
    if (campos.length === 0) return this.obtener(id);
    valores.push(id);

    try {
      const { rowCount } = await this.tx.query(
        `UPDATE cobertura SET ${campos.join(', ')} WHERE id = $${i}`,
        valores,
      );
      if (!rowCount) throw new NotFoundException('Cobertura no encontrada');
      return this.obtener(id);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }

  // El trigger fn_cobertura_sello rechaza si el rol no es transversal.
  async darVistoGabinete(id: string) {
    try {
      const { rowCount } = await this.tx.query(
        `UPDATE cobertura SET gabinete_visto_at = now() WHERE id = $1 AND gabinete_visto_at IS NULL`,
        [id],
      );
      if (!rowCount) {
        // O no existe / no la veo, o ya tenía visto.
        await this.obtener(id);
      }
      return this.obtener(id);
    } catch (err) {
      mapPgError(err);
    }
  }
}
