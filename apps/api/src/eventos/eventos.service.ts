import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { mapPgError } from '../common/pg-error.util';
import { CreateEventoDto } from './dto/create-evento.dto';
import { UpdateEventoDto } from './dto/update-evento.dto';
import { ConflictosEventoDto } from './dto/conflictos-evento.dto';
import { EventoEstado } from './dto/evento-estado.enum';
import { CreateIndicacionDto } from './dto/create-indicacion.dto';
import { AtenderIndicacionDto } from './dto/atender-indicacion.dto';

const SELECT_FIELDS = `
  id, secretaria_id, tipo, titulo, descripcion, lugar, fecha_inicio, fecha_fin,
  nivel_confidencialidad, recordatorios_activos, estado, creado_por, created_at, updated_at
`;

// secretaria_id IS NULL es, hoy, la única marca de "esto es agenda del
// Gabinete/Gobernador" (solo gobernador/jefe_gabinete/admin/apoyo pueden
// crear así -- eventos_insert, 008 + 029). Se usa para decidir cuándo
// confirmar implica agregar al Gobernador como responsable (ver
// actualizar()).
const ROLES_TRANSVERSALES = ['gobernador', 'jefe_gabinete', 'admin'];

// Bloque de disponibilidad del Gobernador que no se puede ver en detalle
// (fn_disponibilidad_gobernador, 028_agenda_seguridad_conflictos.sql): nunca
// trae id/titulo real, a proposito.
export interface ConflictoOculto {
  id: null;
  titulo: null;
  fecha_inicio: string;
  fecha_fin: string;
  oculto: true;
}

@Injectable()
export class EventosService {
  private readonly logger = new Logger(EventosService.name);

  constructor(private readonly tx: TxService) {}

  // Rango de fechas para la vista de calendario. RLS filtra secretaria +
  // rango de confidencialidad + invitados, exactamente igual que publicaciones.
  // soloMiParticipacion: para "Mi jornada" (Gobernador) -- sin esto, un
  // transversal (gobernador/jefe_gabinete/admin) recibiría TODO lo visible
  // por RLS, no solo lo suyo; con esto, se acota a donde participa
  // explícitamente (evento_responsables), igual criterio que usa la
  // confirmación del recorrido de solicitudes (029) para agregar al
  // Gobernador.
  async listar(
    desde?: string,
    hasta?: string,
    soloMiParticipacion = false,
  ) {
    const { userId } = this.tx.currentUser;
    const { rows } = await this.tx.query(
      `SELECT ${SELECT_FIELDS} FROM eventos_agenda
       WHERE ($1::timestamptz IS NULL OR fecha_fin >= $1)
         AND ($2::timestamptz IS NULL OR fecha_inicio <= $2)
         AND (
           $3::boolean IS NOT TRUE
           OR EXISTS (
             SELECT 1 FROM evento_responsables er
             WHERE er.evento_id = eventos_agenda.id AND er.usuario_id = $4
           )
         )
       ORDER BY fecha_inicio`,
      [desde ?? null, hasta ?? null, soloMiParticipacion, userId],
    );
    return rows;
  }

  async obtener(id: string) {
    const { rows } = await this.tx.query(
      `SELECT ${SELECT_FIELDS} FROM eventos_agenda WHERE id = $1`,
      [id],
    );
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

    // Computado, no una columna: le evita al frontend tener que conocer el
    // rol de cada responsable solo para pintar "¿participa el Gobernador?"
    // -- ver actualizar() para cómo se marca/retira explícitamente.
    const { rows: participaRows } = await this.tx.query<{ existe: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM evento_responsables er
         JOIN usuario_roles ur ON ur.usuario_id = er.usuario_id
         JOIN roles r ON r.id = ur.rol_id
         WHERE er.evento_id = $1 AND r.nombre = 'gobernador'
       ) AS existe`,
      [id],
    );

    return {
      ...rows[0],
      responsables,
      creador: creadorRows[0] ?? null,
      participaGobernador: participaRows[0]?.existe ?? false,
    };
  }

  // Cruces visibles (RLS normal) + bloques ocupados de la agenda del
  // Gobernador que quien pregunta no puede ver en detalle (evento
  // confidencial de otra secretaria, etc.) -- sin esto ultimo, alguien sin
  // acceso a esa fila podia agendar un cruce sin saberlo (ver
  // 028_agenda_seguridad_conflictos.sql, fn_disponibilidad_gobernador).
  async buscarConflictos(dto: ConflictosEventoDto) {
    const inicio = new Date(dto.fechaInicio);
    const fin = new Date(dto.fechaFin);
    if (fin <= inicio) {
      throw new BadRequestException(
        'La hora de finalizacion debe ser posterior a la de inicio',
      );
    }

    const { rows } = await this.tx.query(
      `SELECT ${SELECT_FIELDS} FROM eventos_agenda
       WHERE fecha_inicio < $2::timestamptz
         AND fecha_fin > $1::timestamptz
         AND ($3::uuid IS NULL OR id <> $3::uuid)
         AND estado NOT IN ('cancelado', 'no_realizado')
       ORDER BY fecha_inicio
       LIMIT 10`,
      [dto.fechaInicio, dto.fechaFin, dto.excluirId ?? null],
    );
    const visibles = rows.map((r) => ({ ...r, oculto: false as const }));

    // La funcion SQL ya excluye lo que este contexto puede ver por su
    // propia RLS (mismo criterio que eventos_select) -- lo que devuelve es
    // siempre "extra", nunca redundante con `visibles`. Si esta consulta
    // falla por lo que sea, no se inventa nada ni se bloquea la operacion
    // principal: se sigue solo con los conflictos visibles (mismo
    // comportamiento que existia antes de este cambio), y se deja registro
    // para investigar -- fallar acá nunca debe traducirse en exponer datos
    // ni en romper la creacion/edicion del evento.
    let ocultos: ConflictoOculto[] = [];
    try {
      const { rows: bloques } = await this.tx.query<{
        fecha_inicio: string;
        fecha_fin: string;
      }>(
        `SELECT fecha_inicio, fecha_fin
         FROM fn_disponibilidad_gobernador($1::timestamptz, $2::timestamptz, $3::uuid)`,
        [dto.fechaInicio, dto.fechaFin, dto.excluirId ?? null],
      );
      ocultos = bloques.map((b) => ({
        id: null,
        titulo: null,
        fecha_inicio: new Date(b.fecha_inicio).toISOString(),
        fecha_fin: new Date(b.fecha_fin).toISOString(),
        oculto: true as const,
      }));
    } catch (err) {
      this.logger.warn(
        `No se pudo calcular disponibilidad del Gobernador: ${(err as Error).message}`,
      );
    }

    return [...visibles, ...ocultos];
  }

  async crear(dto: CreateEventoDto) {
    // Ambas fechas juntas o ninguna -- mismo par que exige la base
    // (fechas_validas, 029_agenda_solicitudes.sql), validado antes para dar
    // un mensaje claro en vez de un 500/23514.
    if ((dto.fechaInicio === undefined) !== (dto.fechaFin === undefined)) {
      throw new BadRequestException(
        'Indica fecha de inicio y fin juntas, o ninguna (registro sin horario)',
      );
    }
    if (
      dto.fechaInicio !== undefined &&
      dto.fechaFin !== undefined &&
      new Date(dto.fechaFin) <= new Date(dto.fechaInicio)
    ) {
      throw new BadRequestException(
        'La hora de finalizacion debe ser posterior a la de inicio',
      );
    }

    const { userId, secretariaId, rol } = this.tx.currentUser;
    const esTransversal = ROLES_TRANSVERSALES.includes(rol);
    const esApoyo = rol === 'apoyo';
    if (!esTransversal && !esApoyo && !secretariaId) {
      throw new ForbiddenException('Tu rol no está asociado a una secretaría');
    }

    // apoyo nunca puede nacer 'confirmado' (RLS lo rechazaría igual --
    // eventos_insert, 029) -- si no indicó estado, se asume 'solicitud'
    // ("registro corto"). Para el resto de roles, sin estado se omite la
    // columna y manda el DEFAULT de la base ('confirmado'), igual que
    // siempre.
    const estado = dto.estado ?? (esApoyo ? EventoEstado.SOLICITUD : undefined);

    try {
      const columnas = [
        'secretaria_id',
        'tipo',
        'titulo',
        'descripcion',
        'lugar',
        'fecha_inicio',
        'fecha_fin',
        'nivel_confidencialidad',
        'recordatorios_activos',
        'creado_por',
      ];
      const valores: unknown[] = [
        esTransversal || esApoyo ? null : secretariaId,
        dto.tipo ?? 'reunion',
        dto.titulo,
        dto.descripcion ?? null,
        dto.lugar ?? null,
        dto.fechaInicio ?? null,
        dto.fechaFin ?? null,
        dto.nivelConfidencialidad,
        dto.recordatoriosActivos ?? true,
        userId,
      ];
      if (estado !== undefined) {
        columnas.push('estado');
        valores.push(estado);
      }

      const { rows } = await this.tx.query(
        `INSERT INTO eventos_agenda (${columnas.join(', ')})
         VALUES (${valores.map((_, idx) => `$${idx + 1}`).join(', ')})
         RETURNING ${SELECT_FIELDS}`,
        valores,
      );
      const evento = rows[0];

      if (dto.responsableIds?.length) {
        await this.reemplazarResponsables(evento.id, dto.responsableIds);
      }

      // Participación explícita del Gobernador (ver marcarParticipacionGobernador,
      // más abajo) -- también disponible al crear, por si quien crea ya
      // sabe que el Gobernador participa (ej. jefe_gabinete creando
      // directo, no vía el recorrido de solicitudes de apoyo).
      if (dto.participaGobernador) {
        await this.marcarParticipacionGobernador(evento.id, true);
      }

      // Colaboración propia e inmediata: quien registra como `apoyo` queda
      // con acceso de trabajo sobre lo que acaba de crear, sin depender de
      // que la jefa actúe primero (029_agenda_solicitudes.sql, comentario de
      // evento_colaboradores_insert). La visibilidad del INSERT mismo (este
      // RETURNING) ya la cubre 030_agenda_solicitud_visibilidad_creador.sql
      // por separado -- esta fila es para el resto del ciclo de vida (poder
      // editar mientras siga en 'solicitud'/'tentativo').
      if (esApoyo) {
        await this.tx.query(
          `INSERT INTO evento_colaboradores (evento_id, usuario_id, asignado_por)
           VALUES ($1, $2, $2)
           ON CONFLICT DO NOTHING`,
          [evento.id, userId],
        );
      }

      return evento;
    } catch (err) {
      mapPgError(err);
    }
  }

  async actualizar(id: string, dto: UpdateEventoDto) {
    // Se lee la fila actual siempre (no solo cuando cambian fechas): la
    // validación de fechas necesita fecha_inicio/fecha_fin actuales cuando
    // solo una de las dos viene en el DTO.
    const { rows: actualRows } = await this.tx.query<{
      fecha_inicio: string | null;
      fecha_fin: string | null;
    }>(
      `SELECT fecha_inicio, fecha_fin FROM eventos_agenda WHERE id = $1`,
      [id],
    );
    if (actualRows.length === 0)
      throw new NotFoundException('Evento no encontrado');
    const actual = actualRows[0];

    if (dto.fechaInicio !== undefined || dto.fechaFin !== undefined) {
      const inicioFinal = dto.fechaInicio ?? actual.fecha_inicio;
      const finFinal = dto.fechaFin ?? actual.fecha_fin;
      // Mismo par que exige la base (fechas_validas): no se puede dejar una
      // sola fecha puesta. Esto pasa, en la práctica, al proponer/confirmar
      // horario de una 'solicitud' que hasta ahora tenía ambas en null.
      if ((inicioFinal === null) !== (finFinal === null)) {
        throw new BadRequestException(
          'Indica fecha de inicio y fin juntas',
        );
      }
      if (
        inicioFinal !== null &&
        finFinal !== null &&
        new Date(finFinal) <= new Date(inicioFinal)
      ) {
        throw new BadRequestException(
          'La hora de finalizacion debe ser posterior a la de inicio',
        );
      }
    }

    const campos: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    const mapa: Record<string, unknown> = {
      tipo: dto.tipo,
      titulo: dto.titulo,
      descripcion: dto.descripcion,
      lugar: dto.lugar,
      fecha_inicio: dto.fechaInicio,
      fecha_fin: dto.fechaFin,
      nivel_confidencialidad: dto.nivelConfidencialidad,
      recordatorios_activos: dto.recordatoriosActivos,
      estado: dto.estado,
    };
    for (const [columna, valor] of Object.entries(mapa)) {
      if (valor !== undefined) {
        campos.push(`${columna} = $${i++}`);
        valores.push(valor);
      }
    }

    try {
      // `participaGobernador` no es una columna de eventos_agenda (vive en
      // evento_responsables) -- se procesa SIEMPRE, incluso cuando es el
      // único campo del PATCH y `campos` queda vacío. Bug real encontrado
      // al probar esto: la primera versión ponía este bloque después del
      // UPDATE, y un PATCH con SOLO `participaGobernador` disparaba el
      // `return this.obtener(id)` temprano de abajo sin haber llegado
      // nunca a aplicarlo -- silencioso, sin error, la jefa creía haber
      // retirado la participación y no pasaba nada.
      if (dto.participaGobernador !== undefined) {
        await this.marcarParticipacionGobernador(id, dto.participaGobernador);
      }

      if (campos.length === 0) return this.obtener(id);

      campos.push(`updated_at = now()`);
      valores.push(id);

      const { rows } = await this.tx.query(
        `UPDATE eventos_agenda SET ${campos.join(', ')} WHERE id = $${i} RETURNING ${SELECT_FIELDS}`,
        valores,
      );
      if (rows.length === 0)
        throw new NotFoundException('Evento no encontrado');

      return rows[0];
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }

  // Participación del Gobernador: SIEMPRE explícita, nunca inferida de
  // confirmar un evento transversal (corrección real de esta sesión -- la
  // versión anterior agregaba automáticamente a TODOS los usuarios con rol
  // `gobernador` al confirmar cualquier evento transversal, sin que nadie
  // lo pidiera; en una base con más de una cuenta con ese rol -- fixtures
  // de prueba, cuentas demo -- eso significaba agregar participantes que
  // nadie invitó). Se agrega/retira a TODOS los usuarios con rol
  // `gobernador` (mismo criterio ya usado en notificaciones -- se dirige al
  // rol, no a una cuenta fija; en producción normalmente hay una sola
  // persona con ese rol). `participaGobernador: false` retira
  // explícitamente lo agregado antes (permite corregir, no solo agregar).
  private async marcarParticipacionGobernador(
    eventoId: string,
    participa: boolean,
  ) {
    const { rows: gobRows } = await this.tx.query<{ id: string }>(
      `SELECT ur.usuario_id AS id FROM usuario_roles ur
       JOIN roles r ON r.id = ur.rol_id
       WHERE r.nombre = 'gobernador'`,
    );
    const gobIds = gobRows.map((g) => g.id);
    if (participa) {
      for (const gid of gobIds) {
        await this.tx.query(
          `INSERT INTO evento_responsables (evento_id, usuario_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [eventoId, gid],
        );
      }
    } else if (gobIds.length) {
      await this.tx.query(
        `DELETE FROM evento_responsables WHERE evento_id = $1 AND usuario_id = ANY($2::uuid[])`,
        [eventoId, gobIds],
      );
    }
  }

  async eliminar(id: string) {
    const { rowCount } = await this.tx.query(
      `DELETE FROM eventos_agenda WHERE id = $1`,
      [id],
    );
    if (!rowCount) throw new NotFoundException('Evento no encontrado');
    return { eliminado: true };
  }

  // Reemplaza el set completo de invitados (mas simple e idempotente que
  // agregar/quitar de a uno).
  async reemplazarResponsables(eventoId: string, usuarioIds: string[]) {
    try {
      await this.tx.query(
        `DELETE FROM evento_responsables WHERE evento_id = $1`,
        [eventoId],
      );
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

  // Indicaciones del Gobernador (evento_indicaciones, 032): acción escrita
  // para pedir reprogramación/cancelación/aclaración sobre un evento --
  // distinta de editar el evento directo (que el Gobernador ya no puede
  // hacer, ver 033_eventos_agenda_gobernador_no_escribe.sql). RLS exige
  // autor_id = quien llama y rol='gobernador' -- no hace falta repetirlo
  // acá, si no corresponde la base lo rechaza (mapPgError -> 403).
  async crearIndicacion(eventoId: string, dto: CreateIndicacionDto) {
    const { userId } = this.tx.currentUser;
    try {
      const { rows } = await this.tx.query(
        `INSERT INTO evento_indicaciones (evento_id, autor_id, tipo, texto)
         VALUES ($1, $2, $3, $4)
         RETURNING id, evento_id, autor_id, tipo, texto, estado, atendida_por, atendida_at, resultado_nota, created_at`,
        [eventoId, userId, dto.tipo, dto.texto],
      );
      return rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  // Visible por RLS (evento_indicaciones_select) a su autor o a
  // jefe_gabinete/admin -- acá solo se listan, sin repetir ese chequeo.
  async listarIndicaciones(eventoId: string) {
    const { rows } = await this.tx.query(
      `SELECT i.id, i.evento_id, i.tipo, i.texto, i.estado, i.atendida_at,
              i.resultado_nota, i.created_at,
              autor.id AS autor_id, autor.nombre AS autor_nombre,
              atendio.id AS atendida_por_id, atendio.nombre AS atendida_por_nombre
       FROM evento_indicaciones i
       JOIN usuarios autor ON autor.id = i.autor_id
       LEFT JOIN usuarios atendio ON atendio.id = i.atendida_por
       WHERE i.evento_id = $1
       ORDER BY i.created_at DESC`,
      [eventoId],
    );
    return rows;
  }

  // La jefa (o admin) marca una indicación como aplicada/descartada, con
  // nota -- NO modifica el evento por sí misma (evento_indicaciones no
  // "aplica" nada automático, ver comentario en la migración): la jefa
  // aplica el cambio real con el PATCH /eventos/:id normal, y por separado
  // marca acá que ya atendió el pedido. autor_id/tipo/texto/created_at son
  // inmutables a nivel de trigger (fn_evento_indicacion_inmutable).
  async atenderIndicacion(indicacionId: string, dto: AtenderIndicacionDto) {
    const { userId } = this.tx.currentUser;
    try {
      const { rows } = await this.tx.query(
        `UPDATE evento_indicaciones
         SET estado = $1, atendida_por = $2, atendida_at = now(), resultado_nota = $3
         WHERE id = $4
         RETURNING id, evento_id, tipo, texto, estado, atendida_at, resultado_nota`,
        [dto.estado, userId, dto.resultadoNota ?? null, indicacionId],
      );
      if (rows.length === 0)
        throw new NotFoundException('Indicación no encontrada');
      return rows[0];
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }

  // Colaboración (evento_colaboradores, 029) es trabajo delegado, distinto
  // de ser invitado (evento_responsables): quién puede asignarla la decide
  // fn_evento_editable_por_actual vía RLS (evento_colaboradores_insert/
  // delete) -- normalmente la jefa. Mismo patrón reemplazar-todo que
  // reemplazarResponsables.
  async reemplazarColaboradores(eventoId: string, usuarioIds: string[]) {
    try {
      await this.tx.query(
        `DELETE FROM evento_colaboradores WHERE evento_id = $1`,
        [eventoId],
      );
      const { userId } = this.tx.currentUser;
      for (const usuarioId of usuarioIds) {
        await this.tx.query(
          `INSERT INTO evento_colaboradores (evento_id, usuario_id, asignado_por) VALUES ($1, $2, $3)`,
          [eventoId, usuarioId, userId],
        );
      }
      return { actualizado: true };
    } catch (err) {
      mapPgError(err);
    }
  }
}
