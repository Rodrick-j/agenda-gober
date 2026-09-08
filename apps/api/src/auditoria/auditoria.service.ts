import { Injectable } from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { limites, paginar } from '../common/paginacion';

@Injectable()
export class AuditoriaService {
  constructor(private readonly tx: TxService) {}

  // No filtra por rol en el SQL: la política RLS auditoria_select solo deja
  // ver estas filas a gobernador/jefe_gabinete/admin. Un secretario recibe
  // 0 filas (no un error), igual que en el resto del sistema.
  async findAll(pagina?: string, porPagina?: string) {
    const lim = limites(pagina, porPagina);
    const { rows } = await this.tx.query(
      `SELECT a.id, a.tabla, a.accion, a.registro_id, a.datos_anteriores,
              a.datos_nuevos, a.created_at, u.email AS usuario_email,
              count(*) OVER() AS _total
       FROM auditoria a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       ORDER BY a.id DESC
       LIMIT $1 OFFSET $2`,
      [lim.limit, lim.offset],
    );
    return paginar(rows, lim);
  }
}
