import { Injectable } from '@nestjs/common';
import { TxService } from '../context/tx.service';

@Injectable()
export class AuditoriaService {
  constructor(private readonly tx: TxService) {}

  // No filtra por rol en el SQL: la política RLS auditoria_select solo deja
  // ver estas filas a gobernador/jefe_gabinete/admin. Un secretario recibe
  // 0 filas (no un error), igual que en el resto del sistema.
  findAll() {
    return this.tx
      .query(
        `SELECT a.id, a.tabla, a.accion, a.registro_id, a.datos_anteriores,
                a.datos_nuevos, a.created_at, u.email AS usuario_email
         FROM auditoria a
         LEFT JOIN usuarios u ON u.id = a.usuario_id
         ORDER BY a.id DESC
         LIMIT 200`,
      )
      .then((r) => r.rows);
  }
}
