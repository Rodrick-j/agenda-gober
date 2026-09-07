import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { mapPgError } from '../common/pg-error.util';
import { CreateInstruccionDto } from './dto/create-instruccion.dto';
import { UpdateInstruccionDto } from './dto/update-instruccion.dto';
import { CreateItemDto, InstruccionItemTipo } from './dto/create-item.dto';
import { VistoDto } from './dto/visto.dto';
import { EvidenciaMetaDto } from './dto/evidencia.dto';

const FIELDS = `
  id, titulo, objetivo, prioridad, fecha_limite, estado, emitida_por, organiza_id,
  avance_porcentaje, en_riesgo, created_at, updated_at
`;

// La RLS de instrucciones ya limita todo a roles transversales (INSERT solo
// gobernador). Este servicio no repite ese chequeo: si Postgres rechaza,
// mapPgError lo vuelve un 403. Los triggers (016) hacen cumplir el flujo de
// validación (evidencia obligatoria, motivo obligatorio, transiciones).
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
      `SELECT ii.id, ii.tipo, ii.ref_id, ii.secretaria_id, ii.estado_validacion, ii.peso,
              ii.motivo_devolucion, s.nombre AS secretaria_nombre,
              (SELECT count(*)::int FROM item_evidencias e WHERE e.item_id = ii.id) AS evidencias_count,
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
      `SELECT v.usuario_id, u.nombre, v.abierto_at, v.acuse_at
       FROM vistos v JOIN usuarios u ON u.id = v.usuario_id
       WHERE v.entidad_tipo = 'instruccion' AND v.entidad_id = $1
       ORDER BY COALESCE(v.acuse_at, v.abierto_at)`,
      [id],
    );

    const { rows: bitacora } = await this.tx.query(
      `SELECT b.accion, b.motivo, b.created_at, u.nombre AS actor_nombre
       FROM instruccion_bitacora b
       LEFT JOIN usuarios u ON u.id = b.actor_id
       WHERE b.instruccion_id = $1
       ORDER BY b.created_at`,
      [id],
    );

    return { ...rows[0], items, vistos, bitacora };
  }

  async emitir(dto: CreateInstruccionDto) {
    const { userId } = this.tx.currentUser;
    try {
      if (dto.clientToken) {
        const dup = await this.tx.query(
          `SELECT ${FIELDS} FROM instrucciones WHERE client_token = $1`,
          [dto.clientToken],
        );
        if (dup.rows.length) return dup.rows[0];
      }
      const { rows } = await this.tx.query(
        `INSERT INTO instrucciones (titulo, objetivo, prioridad, fecha_limite, emitida_por, client_token)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING ${FIELDS}`,
        [dto.titulo, dto.objetivo, dto.prioridad ?? 'media', dto.fechaLimite ?? null, userId, dto.clientToken ?? null],
      );
      if (rows.length) return rows[0];
      // Colisión de client_token (doble submit concurrente): devolvemos la existente.
      const again = await this.tx.query(
        `SELECT ${FIELDS} FROM instrucciones WHERE client_token = $1`,
        [dto.clientToken],
      );
      return again.rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async actualizar(id: string, dto: UpdateInstruccionDto) {
    const { userId } = this.tx.currentUser;

    if (dto.organizaId !== undefined) {
      // "Tomar": solo si nadie la tomó todavía (evita asignaciones contradictorias).
      const { rowCount } = await this.tx.query(
        `UPDATE instrucciones
         SET organiza_id = $1,
             estado = CASE WHEN estado = 'emitida' THEN 'en_organizacion'::instruccion_estado ELSE estado END
         WHERE id = $2 AND organiza_id IS NULL`,
        [dto.organizaId, id],
      );
      if (!rowCount) {
        const { rows } = await this.tx.query(`SELECT organiza_id FROM instrucciones WHERE id = $1`, [id]);
        if (!rows.length) throw new NotFoundException('Instrucción no encontrada');
        throw new ConflictException('Otra persona ya tomó esta instrucción');
      }
      await this.tx.query(
        `INSERT INTO instruccion_bitacora (instruccion_id, actor_id, accion) VALUES ($1, $2, 'tomada')`,
        [id, dto.organizaId],
      );
    }

    if (dto.estado !== undefined) {
      const { rowCount } = await this.tx.query(
        `UPDATE instrucciones SET estado = $1 WHERE id = $2`,
        [dto.estado, id],
      );
      if (!rowCount) throw new NotFoundException('Instrucción no encontrada');
      await this.tx.query(
        `INSERT INTO instruccion_bitacora (instruccion_id, actor_id, accion) VALUES ($1, $2, $3)`,
        [id, userId, dto.estado],
      );
    }

    return this.obtener(id);
  }

  // Reabrir: solo el Gobernador y con motivo (decisión #4).
  async reabrir(id: string, motivo: string) {
    if (this.tx.currentUser.rol !== 'gobernador') {
      throw new ForbiddenException('Solo el Gobernador puede reabrir una instrucción');
    }
    const { userId } = this.tx.currentUser;
    const { rowCount } = await this.tx.query(
      `UPDATE instrucciones SET estado = 'en_ejecucion'
       WHERE id = $1 AND estado IN ('cumplida', 'cancelada', 'observada')`,
      [id],
    );
    if (!rowCount) {
      const { rows } = await this.tx.query(`SELECT 1 FROM instrucciones WHERE id = $1`, [id]);
      if (!rows.length) throw new NotFoundException('Instrucción no encontrada');
      throw new BadRequestException('La instrucción no está cerrada');
    }
    await this.tx.query(
      `INSERT INTO instruccion_bitacora (instruccion_id, actor_id, accion, motivo)
       VALUES ($1, $2, 'reabierta', $3)`,
      [id, userId, motivo],
    );
    return this.obtener(id);
  }

  async getBitacora(id: string) {
    const { rows } = await this.tx.query(
      `SELECT b.accion, b.motivo, b.datos, b.created_at, u.nombre AS actor_nombre
       FROM instruccion_bitacora b
       LEFT JOIN usuarios u ON u.id = b.actor_id
       WHERE b.instruccion_id = $1
       ORDER BY b.created_at DESC`,
      [id],
    );
    return rows;
  }

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
        `INSERT INTO instruccion_items (instruccion_id, tipo, ref_id, secretaria_id, peso)
         VALUES ($1, $2, $3, $4, $5)`,
        [instruccionId, dto.tipo, refId, dto.secretariaId ?? null, dto.peso ?? 1],
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

  // --- Validación --------------------------------------------------------

  // La llama el responsable de la tarea, que NO puede ver la instrucción
  // madre -- por eso devuelve solo el ítem, no obtener().
  async solicitarValidacion(instruccionId: string, itemId: string) {
    try {
      const { rows } = await this.tx.query(
        `UPDATE instruccion_items SET estado_validacion = 'pendiente_validacion'
         WHERE id = $1 AND instruccion_id = $2
         RETURNING id, estado_validacion, motivo_devolucion`,
        [itemId, instruccionId],
      );
      if (!rows.length) throw new NotFoundException('Ítem no encontrado o sin permiso para esta acción');
      return rows[0];
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }

  async validarItem(instruccionId: string, itemId: string) {
    const { userId } = this.tx.currentUser;
    return this.cambiarValidacion(
      instruccionId,
      itemId,
      `estado_validacion = 'validado', validado_por = $EXTRA, validado_at = now(), motivo_devolucion = NULL`,
      [userId],
    );
  }

  async devolverItem(instruccionId: string, itemId: string, motivo: string) {
    return this.cambiarValidacion(
      instruccionId,
      itemId,
      `estado_validacion = 'devuelto', motivo_devolucion = $EXTRA`,
      [motivo],
    );
  }

  private async cambiarValidacion(
    instruccionId: string,
    itemId: string,
    setExpr: string,
    extra: unknown[],
  ) {
    // $1 = itemId, $2 = instruccionId, $3.. = extra
    const set = setExpr.replace('$EXTRA', '$3');
    try {
      const { rowCount } = await this.tx.query(
        `UPDATE instruccion_items SET ${set} WHERE id = $1 AND instruccion_id = $2`,
        [itemId, instruccionId, ...extra],
      );
      if (!rowCount) throw new NotFoundException('Ítem no encontrado o sin permiso para esta acción');
      return this.obtener(instruccionId);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }

  // --- Evidencias ------------------------------------------------------------

  async listarEvidencias(instruccionId: string, itemId: string) {
    const { rows: ok } = await this.tx.query(
      `SELECT 1 FROM instruccion_items WHERE id = $1 AND instruccion_id = $2`,
      [itemId, instruccionId],
    );
    if (!ok.length) throw new NotFoundException('Ítem no encontrado');
    const { rows } = await this.tx.query(
      `SELECT e.id, e.tipo, e.nombre_archivo, e.mime, e.tamano_bytes, e.nota, e.created_at,
              u.nombre AS subido_por_nombre
       FROM item_evidencias e
       LEFT JOIN usuarios u ON u.id = e.subido_por
       WHERE e.item_id = $1
       ORDER BY e.created_at`,
      [itemId],
    );
    return rows;
  }

  async subirEvidencia(
    instruccionId: string,
    itemId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    meta: EvidenciaMetaDto,
  ) {
    const { userId } = this.tx.currentUser;
    const { rows: ok } = await this.tx.query(
      `SELECT 1 FROM instruccion_items WHERE id = $1 AND instruccion_id = $2`,
      [itemId, instruccionId],
    );
    if (!ok.length) throw new NotFoundException('Ítem no encontrado');
    try {
      const { rows } = await this.tx.query(
        `INSERT INTO item_evidencias (item_id, tipo, nombre_archivo, mime, tamano_bytes, contenido, nota, subido_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, tipo, nombre_archivo, mime, tamano_bytes, nota, created_at`,
        [itemId, meta.tipo ?? 'documento', file.originalname, file.mimetype, file.size, file.buffer, meta.nota ?? null, userId],
      );
      return rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async descargarEvidencia(evidenciaId: string) {
    const { rows } = await this.tx.query<{ nombre_archivo: string; mime: string; contenido: Buffer }>(
      `SELECT nombre_archivo, mime, contenido FROM item_evidencias WHERE id = $1`,
      [evidenciaId],
    );
    if (!rows.length) throw new NotFoundException('Evidencia no encontrada');
    return rows[0];
  }

  // --- Acuse de recibo ----------------------------------------------------

  async marcarVisto(instruccionId: string, dto: VistoDto) {
    const { userId } = this.tx.currentUser;
    const esAcuse = dto.tipo === 'acuse';
    await this.tx.query(
      `INSERT INTO vistos (entidad_tipo, entidad_id, usuario_id, tipo, abierto_at, acuse_at)
       VALUES ('instruccion', $1, $2, $3, now(), $4)
       ON CONFLICT (entidad_tipo, entidad_id, usuario_id) DO UPDATE SET
         abierto_at = COALESCE(vistos.abierto_at, now()),
         acuse_at   = COALESCE(vistos.acuse_at, EXCLUDED.acuse_at),
         tipo       = CASE WHEN vistos.tipo = 'acuse' THEN 'acuse' ELSE EXCLUDED.tipo END`,
      [instruccionId, userId, esAcuse ? 'acuse' : 'visto', esAcuse ? new Date() : null],
    );
    return { ok: true };
  }
}
