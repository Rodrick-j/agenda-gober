import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { mapPgError } from '../common/pg-error.util';
import { CreateInstruccionDto } from './dto/create-instruccion.dto';
import { UpdateInstruccionDto } from './dto/update-instruccion.dto';
import { CreateItemDto, InstruccionItemTipo } from './dto/create-item.dto';
import { VistoDto } from './dto/visto.dto';

const FIELDS = `
  id, titulo, objetivo, prioridad, fecha_limite, estado, emitida_por, organiza_id,
  avance_porcentaje, en_riesgo, created_at, updated_at
`;

// La RLS de instrucciones ya limita todo a roles transversales (INSERT solo
// gobernador). Este servicio no repite ese chequeo: si Postgres rechaza,
// mapPgError lo vuelve un 403.
@Injectable()
export class DespachoService {
  constructor(private readonly tx: TxService) {}

  async listar() {
    const { rows } = await this.tx.query(
      `SELECT ${FIELDS},
         (SELECT count(*)::int FROM instruccion_items ii WHERE ii.instruccion_id = i.id) AS items_total,
         (SELECT count(DISTINCT ii.secretaria_id)::int FROM instruccion_items ii
            WHERE ii.instruccion_id = i.id AND ii.secretaria_id IS NOT NULL) AS secretarias
       FROM instrucciones i
       ORDER BY i.en_riesgo DESC, i.fecha_limite ASC NULLS LAST, i.created_at DESC`,
    );
    return rows;
  }

  async obtener(id: string) {
    const { rows } = await this.tx.query(`SELECT ${FIELDS} FROM instrucciones WHERE id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('Instrucción no encontrada');

    const { rows: items } = await this.tx.query(
      `SELECT ii.id, ii.tipo, ii.ref_id, ii.secretaria_id, s.nombre AS secretaria_nombre,
         CASE ii.tipo
           WHEN 'tarea' THEN (SELECT json_build_object('titulo', t.titulo, 'estado', t.estado,
                                     'fecha_vencimiento', t.fecha_vencimiento)
                              FROM tareas t WHERE t.id = ii.ref_id)
           WHEN 'proyecto' THEN (SELECT json_build_object('nombre', p.nombre, 'estado', p.estado,
                                        'avance_porcentaje', p.avance_porcentaje)
                                 FROM proyectos p WHERE p.id = ii.ref_id)
           ELSE (SELECT json_build_object('titulo', e.titulo, 'fecha_inicio', e.fecha_inicio,
                        'fecha_fin', e.fecha_fin)
                 FROM eventos_agenda e WHERE e.id = ii.ref_id)
         END AS detalle
       FROM instruccion_items ii
       LEFT JOIN secretarias s ON s.id = ii.secretaria_id
       WHERE ii.instruccion_id = $1
       ORDER BY ii.created_at`,
      [id],
    );

    const { rows: vistos } = await this.tx.query(
      `SELECT v.usuario_id, u.nombre, v.tipo, v.visto_at
       FROM vistos v JOIN usuarios u ON u.id = v.usuario_id
       WHERE v.entidad_tipo = 'instruccion' AND v.entidad_id = $1
       ORDER BY v.visto_at`,
      [id],
    );

    return { ...rows[0], items, vistos };
  }

  async emitir(dto: CreateInstruccionDto) {
    const { userId } = this.tx.currentUser;
    try {
      const { rows } = await this.tx.query(
        `INSERT INTO instrucciones (titulo, objetivo, prioridad, fecha_limite, emitida_por)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${FIELDS}`,
        [dto.titulo, dto.objetivo, dto.prioridad ?? 'media', dto.fechaLimite ?? null, userId],
      );
      return rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async actualizar(id: string, dto: UpdateInstruccionDto) {
    const campos: string[] = [];
    const valores: unknown[] = [];
    let n = 1;

    if (dto.organizaId !== undefined) {
      campos.push(`organiza_id = $${n++}`);
      valores.push(dto.organizaId);
      // "Tomar" la instrucción: si sigue en 'emitida', pasa a 'en_organizacion'.
      if (dto.estado === undefined) {
        campos.push(
          `estado = CASE WHEN estado = 'emitida' THEN 'en_organizacion'::instruccion_estado ELSE estado END`,
        );
      }
    }
    if (dto.estado !== undefined) {
      campos.push(`estado = $${n++}`);
      valores.push(dto.estado);
    }
    if (campos.length === 0) return this.obtener(id);

    valores.push(id);
    try {
      const { rowCount } = await this.tx.query(
        `UPDATE instrucciones SET ${campos.join(', ')} WHERE id = $${n}`,
        valores,
      );
      if (!rowCount) throw new NotFoundException('Instrucción no encontrada');
      return this.obtener(id);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }

  // Agrega un ítem al desglose. Con refId vincula uno existente; sin refId
  // crea una tarea nueva (solo tipo=tarea) y la asigna. Todo en la misma
  // transacción del request: el trigger fn_despacho_sync_items recalcula el
  // avance y avisa a la secretaría.
  async agregarItem(instruccionId: string, dto: CreateItemDto) {
    const { userId } = this.tx.currentUser;

    const { rows: existe } = await this.tx.query(
      `SELECT id FROM instrucciones WHERE id = $1`,
      [instruccionId],
    );
    if (existe.length === 0) throw new NotFoundException('Instrucción no encontrada');

    try {
      let refId = dto.refId;

      if (!refId) {
        if (dto.tipo !== InstruccionItemTipo.TAREA) {
          throw new BadRequestException(
            'Solo se puede crear una tarea desde el desglose; para eventos o proyectos, pasá refId de uno existente',
          );
        }
        if (!dto.titulo) throw new BadRequestException('Falta el título de la tarea');

        const { rows: nueva } = await this.tx.query(
          `INSERT INTO tareas
             (secretaria_id, titulo, descripcion, prioridad, fecha_vencimiento, nivel_confidencialidad, creado_por)
           VALUES (NULL, $1, $2, $3, $4, 'interna', $5)
           RETURNING id`,
          [dto.titulo, dto.descripcion ?? null, dto.prioridad ?? 'media', dto.fechaVencimiento ?? null, userId],
        );
        refId = nueva[0].id;

        let asignados = dto.asignadoIds ?? [];
        if (asignados.length === 0 && dto.secretariaId) {
          const { rows: cabezas } = await this.tx.query(
            `SELECT DISTINCT u.id
             FROM usuarios u
             JOIN usuario_roles ur ON ur.usuario_id = u.id
             JOIN roles r ON r.id = ur.rol_id
             WHERE ur.secretaria_id = $1 AND r.nombre IN ('secretario', 'director') AND u.activo = true`,
            [dto.secretariaId],
          );
          asignados = cabezas.map((r) => r.id);
        }
        for (const uid of asignados) {
          await this.tx.query(
            `INSERT INTO tarea_asignados (tarea_id, usuario_id) VALUES ($1, $2)`,
            [refId, uid],
          );
        }
      }

      await this.tx.query(
        `INSERT INTO instruccion_items (instruccion_id, tipo, ref_id, secretaria_id)
         VALUES ($1, $2, $3, $4)`,
        [instruccionId, dto.tipo, refId, dto.secretariaId ?? null],
      );

      return this.obtener(instruccionId);
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }

  async quitarItem(instruccionId: string, itemId: string) {
    const { rowCount } = await this.tx.query(
      `DELETE FROM instruccion_items WHERE id = $1 AND instruccion_id = $2`,
      [itemId, instruccionId],
    );
    if (!rowCount) throw new NotFoundException('Ítem no encontrado');
    return { eliminado: true };
  }

  async marcarVisto(instruccionId: string, dto: VistoDto) {
    const { userId } = this.tx.currentUser;
    await this.tx.query(
      `INSERT INTO vistos (entidad_tipo, entidad_id, usuario_id, tipo)
       VALUES ('instruccion', $1, $2, $3)
       ON CONFLICT (entidad_tipo, entidad_id, usuario_id)
       DO UPDATE SET tipo = CASE WHEN vistos.tipo = 'acuse' THEN 'acuse' ELSE EXCLUDED.tipo END,
                     visto_at = now()`,
      [instruccionId, userId, dto.tipo ?? 'visto'],
    );
    return { ok: true };
  }
}
