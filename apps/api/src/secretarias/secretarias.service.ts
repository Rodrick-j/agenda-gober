import { Injectable } from '@nestjs/common';
import { TxService } from '../context/tx.service';

@Injectable()
export class SecretariasService {
  constructor(private readonly tx: TxService) {}

  // Universo de gente a la que le podés asignar una tarea: tu propia
  // secretaría (o todo el mundo si sos transversal, ya que de por sí ves
  // todo). Nombre/email de un compañero de la misma secretaría no es
  // información sensible -- es lo mínimo para poder elegir a quién asignar
  // algo, igual que Reuniones arma su selector con creador + invitados en
  // vez de necesitar un directorio completo de usuarios.
  async miembros() {
    const { rol, secretariaId } = this.tx.currentUser;
    const esTransversal = ['gobernador', 'jefe_gabinete', 'admin'].includes(rol);
    const { rows } = await this.tx.query(
      esTransversal
        ? `SELECT id, nombre, email FROM usuarios WHERE activo = true ORDER BY nombre`
        : `SELECT id, nombre, email FROM usuarios WHERE activo = true AND secretaria_id = $1 ORDER BY nombre`,
      esTransversal ? [] : [secretariaId],
    );
    return rows;
  }

  // secretarias no tiene RLS: cualquier usuario autenticado puede ver el
  // catálogo. Se agrega el conteo de publicaciones visibles para quien
  // consulta (ese conteo sí pasa por la RLS de publicaciones).
  findAll() {
    return this.tx
      .query(
        `SELECT s.id, s.nombre, s.slug, s.descripcion, s.activa,
                (SELECT count(*) FROM publicaciones p WHERE p.secretaria_id = s.id)::int AS publicaciones_visibles
         FROM secretarias s
         ORDER BY s.nombre`,
      )
      .then((r) => r.rows);
  }
}
