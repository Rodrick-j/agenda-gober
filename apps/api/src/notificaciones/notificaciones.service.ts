import { Injectable } from '@nestjs/common';
import { TxService } from '../context/tx.service';

// La RLS de notificaciones filtra por usuario_id = app.current_user_id: cada
// quien ve y marca leídas SOLO las suyas. No hay chequeo de rol acá.
@Injectable()
export class NotificacionesService {
  constructor(private readonly tx: TxService) {}

  async listar(soloNoLeidas: boolean) {
    const { rows } = await this.tx.query(
      `SELECT id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id, leida, leida_at, created_at
       FROM notificaciones
       WHERE $1::boolean IS NOT TRUE OR leida = false
       ORDER BY created_at DESC
       LIMIT 50`,
      [soloNoLeidas],
    );
    return rows;
  }

  async conteo() {
    const { rows } = await this.tx.query(
      `SELECT count(*)::int AS n FROM notificaciones WHERE leida = false`,
    );
    return { noLeidas: rows[0].n };
  }

  async marcarLeida(id: string) {
    const { rowCount } = await this.tx.query(
      `UPDATE notificaciones SET leida = true, leida_at = now() WHERE id = $1 AND leida = false`,
      [id],
    );
    return { ok: (rowCount ?? 0) > 0 };
  }

  async leerTodas() {
    const { rowCount } = await this.tx.query(
      `UPDATE notificaciones SET leida = true, leida_at = now() WHERE leida = false`,
    );
    return { actualizadas: rowCount ?? 0 };
  }
}
