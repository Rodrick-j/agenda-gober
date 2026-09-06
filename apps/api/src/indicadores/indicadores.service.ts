import { Injectable } from '@nestjs/common';
import { TxService } from '../context/tx.service';

// Sin tablas propias ni restriccion de rol (a diferencia de Gabinete, que es
// transversal): cada consulta corre bajo la RLS de siempre, asi que
// cualquier rol ve sus propios indicadores -- un secretario ve el avance de
// SU secretaria, un transversal ve el agregado de todas.
@Injectable()
export class IndicadoresService {
  constructor(private readonly tx: TxService) {}

  async resumen() {
    const [publicaciones, tareas, proyectos, totales] = await Promise.all([
      this.tx.query(`SELECT estado::text, COUNT(*)::int AS total FROM publicaciones GROUP BY estado`),
      this.tx.query(`SELECT estado::text, COUNT(*)::int AS total FROM tareas GROUP BY estado`),
      this.tx.query(`SELECT estado::text, COUNT(*)::int AS total FROM proyectos GROUP BY estado`),
      this.tx.query(`SELECT
         (SELECT COUNT(*) FROM publicaciones)::int AS publicaciones_total,
         (SELECT COUNT(*) FROM tareas)::int AS tareas_total,
         (SELECT COUNT(*) FROM tareas
            WHERE estado IN ('pendiente', 'en_progreso') AND fecha_vencimiento < now())::int AS tareas_vencidas,
         (SELECT COUNT(*) FROM proyectos WHERE estado <> 'cancelado')::int AS proyectos_activos,
         (SELECT COALESCE(ROUND(AVG(avance_porcentaje)), 0) FROM proyectos
            WHERE estado NOT IN ('cancelado', 'finalizado'))::int AS avance_promedio,
         (SELECT COUNT(*) FROM eventos_agenda
            WHERE fecha_inicio BETWEEN now() AND now() + interval '30 days')::int AS eventos_mes`),
    ]);

    return {
      publicacionesPorEstado: publicaciones.rows,
      tareasPorEstado: tareas.rows,
      proyectosPorEstado: proyectos.rows,
      totales: totales.rows[0],
    };
  }
}
