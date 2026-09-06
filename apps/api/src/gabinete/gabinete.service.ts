import { Injectable } from '@nestjs/common';
import { TxService } from '../context/tx.service';

// Sin tablas propias: agrega lo que ya existe en publicaciones/eventos_agenda/
// tareas. No filtra por rol en el SQL -- cada subquery corre bajo la misma
// RLS de siempre, así que un rol no transversal simplemente ve su propia
// secretaría reflejada acá (igual que en auditoria.service.ts), nunca "todo".
@Injectable()
export class GabineteService {
  constructor(private readonly tx: TxService) {}

  async resumen() {
    const [porSecretaria, tareasUrgentes, proximosEventos, totales] = await Promise.all([
      this.tx.query(
        `SELECT
           s.id, s.nombre,
           COUNT(DISTINCT p.id) FILTER (WHERE p.estado = 'revision')::int AS publicaciones_revision,
           COUNT(DISTINCT t.id) FILTER (WHERE t.estado IN ('pendiente', 'en_progreso'))::int AS tareas_pendientes,
           COUNT(DISTINCT t.id) FILTER (
             WHERE t.estado IN ('pendiente', 'en_progreso') AND t.fecha_vencimiento < now()
           )::int AS tareas_vencidas
         FROM secretarias s
         LEFT JOIN publicaciones p ON p.secretaria_id = s.id
         LEFT JOIN tareas t ON t.secretaria_id = s.id
         WHERE s.activa
         GROUP BY s.id, s.nombre
         ORDER BY s.nombre`,
      ),
      this.tx.query(
        `SELECT t.id, t.titulo, t.estado, t.prioridad, t.fecha_vencimiento, t.secretaria_id, s.nombre AS secretaria_nombre
         FROM tareas t
         LEFT JOIN secretarias s ON s.id = t.secretaria_id
         WHERE t.estado IN ('pendiente', 'en_progreso')
           AND t.fecha_vencimiento IS NOT NULL
           AND t.fecha_vencimiento < now() + interval '3 days'
         ORDER BY t.fecha_vencimiento ASC
         LIMIT 10`,
      ),
      this.tx.query(
        `SELECT e.id, e.titulo, e.lugar, e.fecha_inicio, e.fecha_fin, e.secretaria_id, s.nombre AS secretaria_nombre
         FROM eventos_agenda e
         LEFT JOIN secretarias s ON s.id = e.secretaria_id
         WHERE e.fecha_inicio BETWEEN now() AND now() + interval '7 days'
         ORDER BY e.fecha_inicio ASC
         LIMIT 10`,
      ),
      this.tx.query(
        `SELECT
           (SELECT COUNT(*) FROM publicaciones WHERE estado = 'revision')::int AS publicaciones_revision,
           (SELECT COUNT(*) FROM tareas WHERE estado IN ('pendiente', 'en_progreso'))::int AS tareas_pendientes,
           (SELECT COUNT(*) FROM tareas
              WHERE estado IN ('pendiente', 'en_progreso') AND fecha_vencimiento < now())::int AS tareas_vencidas,
           (SELECT COUNT(*) FROM eventos_agenda
              WHERE fecha_inicio BETWEEN now() AND now() + interval '7 days')::int AS eventos_semana`,
      ),
    ]);

    return {
      secretarias: porSecretaria.rows,
      tareasUrgentes: tareasUrgentes.rows,
      proximosEventos: proximosEventos.rows,
      totales: totales.rows[0],
    };
  }
}
