import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { verifyPassword } from '../common/password.util';
import { PG_POOL } from '../database/database.module';
import { LoginDto } from './dto/login.dto';

export interface SesionMeta {
  userAgent?: string;
  ip?: string;
}

interface UsuarioFila {
  id: string;
  email: string;
  rol: string;
  secretaria_id: string | null;
}

// Corre ANTES de que exista contexto de transacción, así que consulta el pool
// directo. Es seguro: usuarios/roles/usuario_roles/sesiones no tienen RLS.
@Injectable()
export class AuthService {
  private readonly refreshTtlDays: number;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.refreshTtlDays = Number(config.get('JWT_REFRESH_TTL_DAYS') ?? 30);
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async usuarioActivo(where: string, param: string): Promise<UsuarioFila | null> {
    const { rows } = await this.pool.query<UsuarioFila>(
      `SELECT u.id, u.email, u.secretaria_id, r.nombre AS rol
       FROM usuarios u
       JOIN usuario_roles ur ON ur.usuario_id = u.id
       JOIN roles r          ON r.id = ur.rol_id
       WHERE ${where} AND u.activo = true
       ORDER BY ur.secretaria_id NULLS LAST
       LIMIT 1`,
      [param],
    );
    return rows[0] ?? null;
  }

  // Crea una sesión + par de tokens para un usuario ya autenticado.
  private async emitirSesion(user: UsuarioFila, meta: SesionMeta) {
    const refreshToken = randomBytes(48).toString('base64url');
    const expira = new Date(Date.now() + this.refreshTtlDays * 86_400_000);

    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO sesiones (usuario_id, refresh_hash, user_agent, ip, expira_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [user.id, this.hash(refreshToken), meta.userAgent ?? null, meta.ip ?? null, expira],
    );
    const accessToken = await this.jwt.signAsync({ sub: user.id, sid: rows[0].id });

    return {
      accessToken,
      refreshToken,
      user: { userId: user.id, email: user.email, rol: user.rol, secretariaId: user.secretaria_id },
    };
  }

  async login(dto: LoginDto, meta: SesionMeta) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.password_hash, u.secretaria_id, r.nombre AS rol
       FROM usuarios u
       JOIN usuario_roles ur ON ur.usuario_id = u.id
       JOIN roles r          ON r.id = ur.rol_id
       WHERE u.email = $1 AND u.activo = true
       ORDER BY ur.secretaria_id NULLS LAST
       LIMIT 1`,
      [dto.email],
    );

    // Mismo mensaje si el email no existe o si la clave es incorrecta.
    const invalid = () => new UnauthorizedException('Credenciales inválidas');
    if (rows.length === 0 || !rows[0].password_hash) throw invalid();

    const fila = rows[0];
    if (!(await verifyPassword(dto.password, fila.password_hash))) throw invalid();

    return this.emitirSesion(
      { id: fila.id, email: fila.email, rol: fila.rol, secretaria_id: fila.secretaria_id },
      meta,
    );
  }

  // Rota el refresh token: valida el actual, lo reemplaza por uno nuevo (mismo
  // sid) y emite un access token fresco. La expiración de la sesión no se
  // mueve (30 días absolutos desde el login).
  async refresh(rawRefreshToken: string | undefined, meta: SesionMeta) {
    if (!rawRefreshToken) throw new UnauthorizedException('Falta el refresh token');
    const hash = this.hash(rawRefreshToken);

    const { rows } = await this.pool.query<{ id: string; usuario_id: string }>(
      `SELECT s.id, s.usuario_id
       FROM sesiones s
       JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.refresh_hash = $1
         AND s.revocada_at IS NULL
         AND s.expira_at > now()
         AND u.activo = true`,
      [hash],
    );
    if (rows.length === 0) throw new UnauthorizedException('Sesión inválida o revocada');

    const sesion = rows[0];
    const user = await this.usuarioActivo('u.id = $1', sesion.usuario_id);
    if (!user) throw new UnauthorizedException('Usuario inactivo');

    const nuevoRefresh = randomBytes(48).toString('base64url');
    await this.pool.query(
      `UPDATE sesiones
       SET refresh_hash = $1, ultima_actividad = now(), user_agent = COALESCE($2, user_agent), ip = COALESCE($3, ip)
       WHERE id = $4`,
      [this.hash(nuevoRefresh), meta.userAgent ?? null, meta.ip ?? null, sesion.id],
    );
    const accessToken = await this.jwt.signAsync({ sub: user.id, sid: sesion.id });

    return {
      accessToken,
      refreshToken: nuevoRefresh,
      user: { userId: user.id, email: user.email, rol: user.rol, secretariaId: user.secretaria_id },
    };
  }

  // Logout: revoca la sesión a partir del refresh token de la cookie.
  async revocarPorRefresh(rawRefreshToken: string | undefined) {
    if (!rawRefreshToken) return;
    await this.pool.query(
      `UPDATE sesiones SET revocada_at = now()
       WHERE refresh_hash = $1 AND revocada_at IS NULL`,
      [this.hash(rawRefreshToken)],
    );
  }

  async listarSesiones(usuarioId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, user_agent, ip, creada_at, ultima_actividad, expira_at
       FROM sesiones
       WHERE usuario_id = $1 AND revocada_at IS NULL AND expira_at > now()
       ORDER BY ultima_actividad DESC`,
      [usuarioId],
    );
    return rows;
  }

  async revocarSesion(usuarioId: string, sesionId: string) {
    const { rowCount } = await this.pool.query(
      `UPDATE sesiones SET revocada_at = now()
       WHERE id = $1 AND usuario_id = $2 AND revocada_at IS NULL`,
      [sesionId, usuarioId],
    );
    return { revocada: (rowCount ?? 0) > 0 };
  }
}
