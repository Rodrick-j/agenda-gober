import { ForbiddenException, Injectable } from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { CreatePublicacionDto } from './dto/create-publicacion.dto';

@Injectable()
export class PublicacionesService {
  constructor(private readonly tx: TxService) {}

  // No filtra por secretaría en el SQL: eso lo hace la política RLS de
  // publicaciones_select según app.current_rol / app.current_secretaria_id.
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

    const { rows } = await this.tx.query(
      `INSERT INTO publicaciones (secretaria_id, autor_id, titulo, contenido, nivel_confidencialidad)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, secretaria_id, titulo, contenido, nivel_confidencialidad, estado, created_at`,
      [secretariaId, userId, dto.titulo, dto.contenido, dto.nivelConfidencialidad],
    );
    return rows[0];
  }
}
