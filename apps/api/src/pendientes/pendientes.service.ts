import { Injectable } from '@nestjs/common';
import { TxService } from '../context/tx.service';

// Espejo de rol_rango() (005). No es la autorización real -- sólo decide qué
// buckets de la bandeja tienen sentido para el rol.
const RANGO: Record<string, number> = {
  operador: 1,
  director: 2,
  secretario: 3,
  gobernador: 99,
  jefe_gabinete: 99,
  admin: 99,
};

// "Lo que espera mi acción, ahora." Todo pasa por TxService -> RLS ya limita a
// lo visible para el usuario; acá se estrecha a lo accionable por rol.
@Injectable()
export class PendientesService {
  constructor(private readonly tx: TxService) {}

  async mias() {
    const { userId, rol } = this.tx.currentUser;
    const rango = RANGO[rol] ?? 0;

    const porRevisar =
      rango >= RANGO.director
        ? (
            await this.tx.query(
              `SELECT id, titulo, secretaria_id, updated_at
               FROM publicaciones
               WHERE estado = 'revision'
               ORDER BY updated_at ASC
               LIMIT 50`,
            )
          ).rows
        : [];

    const porPublicar =
      rango >= RANGO.secretario
        ? (
            await this.tx.query(
              `SELECT id, titulo, secretaria_id, aprobado_at
               FROM publicaciones
               WHERE estado = 'aprobado'
               ORDER BY aprobado_at ASC NULLS LAST
               LIMIT 50`,
            )
          ).rows
        : [];

    const rechazadas = (
      await this.tx.query(
        `SELECT id, titulo, motivo_rechazo, updated_at
         FROM publicaciones
         WHERE estado = 'borrador' AND motivo_rechazo IS NOT NULL AND autor_id = $1
         ORDER BY updated_at DESC
         LIMIT 50`,
        [userId],
      )
    ).rows;

    const tareas = (
      await this.tx.query(
        `SELECT t.id, t.titulo, t.estado, t.prioridad, t.fecha_vencimiento,
                (t.fecha_vencimiento IS NOT NULL AND t.fecha_vencimiento < now()) AS vencida
         FROM tareas t
         JOIN tarea_asignados ta ON ta.tarea_id = t.id AND ta.usuario_id = $1
         WHERE t.estado IN ('pendiente', 'en_progreso')
         ORDER BY t.fecha_vencimiento ASC NULLS LAST, t.created_at ASC
         LIMIT 50`,
        [userId],
      )
    ).rows;

    // LEFT JOIN a propósito: puedo ser responsable de un compromiso de una
    // reunión de otra secretaría a la que no estoy invitado -> la RLS de
    // eventos_agenda me oculta el evento, pero el compromiso sí es mío.
    const compromisos = (
      await this.tx.query(
        `SELECT c.id, c.descripcion, c.fecha_limite, c.evento_id,
                e.titulo AS reunion,
                (c.fecha_limite IS NOT NULL AND c.fecha_limite < now()) AS vencido
         FROM compromisos c
         LEFT JOIN eventos_agenda e ON e.id = c.evento_id
         WHERE c.responsable_id = $1 AND c.estado = 'pendiente'
         ORDER BY c.fecha_limite ASC NULLS LAST, c.created_at ASC
         LIMIT 50`,
        [userId],
      )
    ).rows;

    // Comunicación: UNICOM ve su cola de coberturas; Gabinete ve las que
    // esperan su visto. La RLS de cobertura ya limita lo visible.
    const filtroCobertura =
      rol === 'unicom'
        ? `c.estado IN ('solicitada', 'planificada', 'en_produccion')`
        : rango >= RANGO.gobernador
          ? `c.estado = 'lista' AND c.gabinete_visto_at IS NULL`
          : null;
    const comunicacion = filtroCobertura
      ? (
          await this.tx.query(
            `SELECT c.id, c.estado, e.titulo AS evento_titulo, e.fecha_inicio AS evento_fecha,
                    sec.nombre AS secretaria_nombre
             FROM cobertura c
             LEFT JOIN eventos_agenda e   ON e.id = c.evento_id
             LEFT JOIN secretarias    sec ON sec.id = e.secretaria_id
             WHERE ${filtroCobertura}
             ORDER BY e.fecha_inicio ASC NULLS LAST
             LIMIT 50`,
          )
        ).rows
      : [];

    // Recorrido de solicitudes (029_agenda_solicitudes.sql): la jefa revisa
    // lo que entra transversal en estado temprano -- RLS ya le muestra todo
    // (jefe_gabinete es transversal); acá solo se filtra a lo accionable.
    // `apoyo` ve el estado de lo que fue registrando (visible por
    // creado_por desde 030_agenda_solicitud_visibilidad_creador.sql).
    const solicitudesPorRevisar =
      rol === 'jefe_gabinete' || rol === 'admin'
        ? (
            await this.tx.query(
              `SELECT e.id, e.titulo, e.estado, e.fecha_inicio, e.fecha_fin, e.created_at,
                      u.nombre AS creado_por_nombre
               FROM eventos_agenda e
               LEFT JOIN usuarios u ON u.id = e.creado_por
               WHERE e.estado IN ('solicitud', 'tentativo')
               ORDER BY e.created_at ASC
               LIMIT 50`,
            )
          ).rows
        : [];

    const misSolicitudes =
      rol === 'apoyo'
        ? (
            await this.tx.query(
              `SELECT id, titulo, estado, fecha_inicio, fecha_fin, created_at
               FROM eventos_agenda
               WHERE creado_por = $1
               ORDER BY created_at DESC
               LIMIT 50`,
              [userId],
            )
          ).rows
        : [];

    // Indicaciones del Gobernador (032_evento_indicaciones.sql) pendientes
    // de atender -- solo la jefa/admin las ve (evento_indicaciones_select
    // ya lo limita así; acá solo se agrega el filtro "pendiente").
    const indicacionesPendientes =
      rol === 'jefe_gabinete' || rol === 'admin'
        ? (
            await this.tx.query(
              `SELECT i.id, i.evento_id, i.tipo, i.texto, i.created_at,
                      e.titulo AS evento_titulo, u.nombre AS autor_nombre
               FROM evento_indicaciones i
               JOIN eventos_agenda e ON e.id = i.evento_id
               JOIN usuarios u ON u.id = i.autor_id
               WHERE i.estado = 'pendiente'
               ORDER BY i.created_at ASC
               LIMIT 50`,
            )
          ).rows
        : [];

    const total =
      porRevisar.length +
      porPublicar.length +
      rechazadas.length +
      tareas.length +
      compromisos.length +
      comunicacion.length +
      solicitudesPorRevisar.length +
      misSolicitudes.length +
      indicacionesPendientes.length;

    return {
      publicaciones: { porRevisar, porPublicar, rechazadas },
      tareas,
      compromisos,
      comunicacion,
      agenda: { solicitudesPorRevisar, misSolicitudes, indicacionesPendientes },
      total,
    };
  }
}
