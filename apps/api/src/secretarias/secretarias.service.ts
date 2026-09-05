import { Injectable } from '@nestjs/common';
import { TxService } from '../context/tx.service';

@Injectable()
export class SecretariasService {
  constructor(private readonly tx: TxService) {}

  // secretarias no tiene RLS: cualquier usuario autenticado puede ver el
  // catálogo. Se agrega el conteo de publicaciones visibles para quien
  // consulta (ese conteo sí pasa por la RLS de publicaciones).
  findAll() {
    return this.tx
      .query(
        `SELECT s.id, s.nombre, s.slug, s.activa,
                (SELECT count(*) FROM publicaciones p WHERE p.secretaria_id = s.id)::int AS publicaciones_visibles
         FROM secretarias s
         ORDER BY s.nombre`,
      )
      .then((r) => r.rows);
  }
}
