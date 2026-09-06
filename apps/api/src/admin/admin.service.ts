import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { TxService } from '../context/tx.service';
import { ActualizarUsuarioDto, CrearUsuarioDto, ResetPasswordDto, RolNombre } from './dto/usuario.dto';
import { ActualizarSecretariaDto, CrearSecretariaDto } from './dto/secretaria.dto';

const ROLES_TRANSVERSALES = [RolNombre.GOBERNADOR, RolNombre.JEFE_GABINETE, RolNombre.ADMIN];

const SELECT_FIELDS = `
  u.id, u.nombre, u.email, u.secretaria_id, s.nombre AS secretaria_nombre,
  u.activo, u.created_at, r.nombre AS rol
`;

// Excepción documentada: usuarios/usuario_roles no tienen RLS (ver
// roles.decorator.ts), así que este servicio usa TxService igual que
// cualquier otro -- corre dentro de la transacción del request y hereda el
// BEGIN/COMMIT/ROLLBACK de siempre -- pero la barrera de "solo admin" la
// pone el RolesGuard en el controller, no una política de base de datos.
@Injectable()
export class AdminService {
  constructor(private readonly tx: TxService) {}

  // Valida que el rol declarado y la secretaría declarada sean consistentes
  // entre sí -- un rol transversal no puede tener secretaría, uno de
  // secretaría siempre necesita una. Mismo criterio que ya aplican las
  // políticas RLS de eventos/tareas/proyectos al crear filas transversales.
  private validarRolSecretaria(rol: RolNombre, secretariaId?: string) {
    const esTransversal = ROLES_TRANSVERSALES.includes(rol);
    if (esTransversal && secretariaId) {
      throw new BadRequestException(`El rol "${rol}" es transversal, no puede asignarse a una secretaría`);
    }
    if (!esTransversal && !secretariaId) {
      throw new BadRequestException(`El rol "${rol}" pertenece a una secretaría: falta indicar cuál`);
    }
  }

  async listar() {
    const { rows } = await this.tx.query(
      `SELECT ${SELECT_FIELDS}
       FROM usuarios u
       LEFT JOIN secretarias s ON s.id = u.secretaria_id
       LEFT JOIN usuario_roles ur ON ur.usuario_id = u.id
       LEFT JOIN roles r ON r.id = ur.rol_id
       ORDER BY u.created_at DESC`,
    );
    return rows;
  }

  async crear(dto: CrearUsuarioDto) {
    this.validarRolSecretaria(dto.rol, dto.secretariaId);

    const { rows: rolRows } = await this.tx.query(`SELECT id FROM roles WHERE nombre = $1`, [dto.rol]);
    if (rolRows.length === 0) throw new BadRequestException('Rol desconocido');
    const rolId = rolRows[0].id;

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const secretariaId = dto.secretariaId ?? null;

    try {
      const { rows } = await this.tx.query(
        `INSERT INTO usuarios (nombre, email, secretaria_id, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [dto.nombre, dto.email, secretariaId, passwordHash],
      );
      const usuarioId = rows[0].id;

      await this.tx.query(
        `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id) VALUES ($1, $2, $3)`,
        [usuarioId, rolId, secretariaId],
      );

      return this.obtener(usuarioId);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('Ya existe un usuario con ese correo');
      }
      throw err;
    }
  }

  async obtener(id: string) {
    const { rows } = await this.tx.query(
      `SELECT ${SELECT_FIELDS}
       FROM usuarios u
       LEFT JOIN secretarias s ON s.id = u.secretaria_id
       LEFT JOIN usuario_roles ur ON ur.usuario_id = u.id
       LEFT JOIN roles r ON r.id = ur.rol_id
       WHERE u.id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('Usuario no encontrado');
    return rows[0];
  }

  async actualizar(id: string, dto: ActualizarUsuarioDto) {
    await this.obtener(id); // 404 temprano si no existe

    // rol y secretariaId viajan juntos a propósito: son interdependientes
    // (validarRolSecretaria) y separarlos dejaría estados a medio migrar,
    // ej. un operador de Salud pasando a "gobernador" pero con
    // secretaria_id de Salud todavía puesto.
    if (dto.rol !== undefined || dto.secretariaId !== undefined) {
      if (!dto.rol) throw new BadRequestException('Para cambiar de secretaría también indicá el rol');
      this.validarRolSecretaria(dto.rol, dto.secretariaId);

      const { rows: rolRows } = await this.tx.query(`SELECT id FROM roles WHERE nombre = $1`, [dto.rol]);
      if (rolRows.length === 0) throw new BadRequestException('Rol desconocido');
      const rolId = rolRows[0].id;
      const secretariaId = dto.secretariaId ?? null;

      await this.tx.query(`UPDATE usuarios SET secretaria_id = $1 WHERE id = $2`, [secretariaId, id]);
      await this.tx.query(`DELETE FROM usuario_roles WHERE usuario_id = $1`, [id]);
      await this.tx.query(
        `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id) VALUES ($1, $2, $3)`,
        [id, rolId, secretariaId],
      );
    }

    const campos: string[] = [];
    const valores: unknown[] = [];
    let i = 1;
    if (dto.nombre !== undefined) {
      campos.push(`nombre = $${i++}`);
      valores.push(dto.nombre);
    }
    if (dto.activo !== undefined) {
      campos.push(`activo = $${i++}`);
      valores.push(dto.activo);
    }
    if (campos.length > 0) {
      valores.push(id);
      await this.tx.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${i}`, valores);
    }

    return this.obtener(id);
  }

  async resetPassword(id: string, dto: ResetPasswordDto) {
    await this.obtener(id);
    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.tx.query(`UPDATE usuarios SET password_hash = $1 WHERE id = $2`, [passwordHash, id]);
    return { ok: true };
  }

  // Justo lo que forzó el reemplazo manual de las 6 secretarías de prueba
  // por las 10 reales: sin esto, cualquier cambio de organigrama (una
  // secretaría nueva, un renombre) necesita que alguien corra SQL a mano.
  async crearSecretaria(dto: CrearSecretariaDto) {
    try {
      const { rows } = await this.tx.query(
        `INSERT INTO secretarias (nombre, slug, descripcion) VALUES ($1, $2, $3)
         RETURNING id, nombre, slug, descripcion, activa`,
        [dto.nombre, dto.slug, dto.descripcion ?? null],
      );
      return rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('Ya existe una secretaría con ese nombre o slug');
      }
      throw err;
    }
  }

  async actualizarSecretaria(id: string, dto: ActualizarSecretariaDto) {
    const campos: string[] = [];
    const valores: unknown[] = [];
    let i = 1;
    if (dto.nombre !== undefined) {
      campos.push(`nombre = $${i++}`);
      valores.push(dto.nombre);
    }
    if (dto.descripcion !== undefined) {
      campos.push(`descripcion = $${i++}`);
      valores.push(dto.descripcion);
    }
    if (dto.activa !== undefined) {
      campos.push(`activa = $${i++}`);
      valores.push(dto.activa);
    }
    if (campos.length === 0) throw new BadRequestException('Nada para actualizar');

    valores.push(id);
    try {
      const { rows } = await this.tx.query(
        `UPDATE secretarias SET ${campos.join(', ')} WHERE id = $${i}
         RETURNING id, nombre, slug, descripcion, activa`,
        valores,
      );
      if (rows.length === 0) throw new NotFoundException('Secretaría no encontrada');
      return rows[0];
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('Ya existe una secretaría con ese nombre');
      }
      throw err;
    }
  }
}
