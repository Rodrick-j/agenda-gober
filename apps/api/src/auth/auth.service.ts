import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { LoginDto } from './dto/login.dto';

// Corre ANTES de que exista contexto de transacción (todavía no sabemos
// quién es el usuario), así que consulta el pool directo. Es seguro:
// usuarios/roles/usuario_roles no tienen RLS — solo publicaciones y
// auditoria lo tienen.
@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    // Si un usuario tuviera varios roles, toma uno solo (MVP) — soporte
    // multi-rol real queda para cuando haga falta.
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.password_hash, u.secretaria_id, r.nombre AS rol
       FROM usuarios u
       JOIN usuario_roles ur ON ur.usuario_id = u.id
       JOIN roles r ON r.id = ur.rol_id
       WHERE u.email = $1 AND u.activo = true
       ORDER BY ur.secretaria_id NULLS LAST
       LIMIT 1`,
      [dto.email],
    );

    // Mismo mensaje si el email no existe o si la contraseña es incorrecta:
    // no hay que confirmarle a un atacante cuáles emails existen.
    const invalid = () => new UnauthorizedException('Credenciales inválidas');

    if (rows.length === 0 || !rows[0].password_hash) {
      throw invalid();
    }

    const user = rows[0];
    const matches = await bcrypt.compare(dto.password, user.password_hash);
    if (!matches) {
      throw invalid();
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      rol: user.rol,
      secretariaId: user.secretaria_id,
    });

    return { accessToken };
  }
}
