import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { mapPgError } from '../common/pg-error.util';
import { CreatePublicacionDto } from './dto/create-publicacion.dto';
import { EstadoPublicacion } from './dto/update-estado.dto';

@Injectable()
export class PublicacionesService {
  constructor(private readonly tx: TxService) {}

  // No filtra por secretaría ni por nivel de confidencialidad en el SQL: eso
  // lo hace la política RLS de publicaciones_select (rol_rango >= nivel_rango).
  findAll() {
    return this.tx
      .query(
        `SELECT id, secretaria_id, titulo, contenido, nivel_confidencialidad, estado, created_at
         FROM publicaciones
         ORDER BY created_at DESC`,
      )
      .then((r) => r.rows);
  }

  async create(dto: CreatePublicacionDto) {
    const { userId, secretariaId } = this.tx.currentUser;
    if (!secretariaId) {
      throw new ForbiddenException(
        'Tu rol no está asociado a una secretaría — no puede publicar contenido propio',
      );
    }

    try {
      const { rows } = await this.tx.query(
        `INSERT INTO publicaciones (secretaria_id, autor_id, titulo, contenido, nivel_confidencialidad)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, secretaria_id, titulo, contenido, nivel_confidencialidad, estado, created_at`,
        [secretariaId, userId, dto.titulo, dto.contenido, dto.nivelConfidencialidad],
      );
      return rows[0];
    } catch (err) {
      // Ej.: un operador intentando asignar nivel "confidencial" -- la
      // política publicaciones_insert lo rechaza por rango, no es un bug.
      mapPgError(err);
    }
  }

  async updateEstado(id: string, estado: EstadoPublicacion) {
    try {
      const { rows } = await this.tx.query(
        `UPDATE publicaciones SET estado = $1, updated_at = now() WHERE id = $2
         RETURNING id, secretaria_id, titulo, contenido, nivel_confidencialidad, estado, created_at, updated_at`,
        [estado, id],
      );
      if (rows.length === 0) {
        // Podría no existir, o existir mientras tu rol/secretaría no la
        // alcanza -- adrede no se distingue, para no confirmarle a nadie
        // la existencia de algo que no puede ver.
        throw new NotFoundException('Publicación no encontrada');
      }
      return rows[0];
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      // Transición de estado inválida para el rango del rol -- la lanza
      // fn_validar_transicion_publicacion (trigger), no un bug de la API.
      mapPgError(err);
    }
  }
}
