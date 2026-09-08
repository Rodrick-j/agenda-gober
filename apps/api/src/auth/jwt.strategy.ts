import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Pool } from 'pg';
import type { Request } from 'express';
import { PG_POOL } from '../database/database.module';
import { AuthenticatedUser, JwtPayload } from './jwt-payload';

// El token viaja en una cookie httpOnly (access_token), nunca en el header
// Authorization: así JavaScript en el navegador (incluido un XSS inyectado)
// no puede leerlo -- solo el navegador lo adjunta automáticamente en cada
// request al origen que lo emitió.
function extractFromCookie(req: Request): string | null {
  return req?.cookies?.access_token ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {
    super({
      jwtFromRequest: extractFromCookie,
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Ahora SÍ se toca la base en cada request, pero es una sola consulta por
  // PK indexada: valida que la sesión sigue viva y NO revocada, que el
  // usuario sigue activo, y devuelve su rol / secretaría ACTUALES. Así una
  // baja o un cambio de rol se aplican en el próximo request, no en 2 h.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sid || !payload?.sub) throw new UnauthorizedException();

    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.secretaria_id, r.nombre AS rol
       FROM sesiones s
       JOIN usuarios u       ON u.id = s.usuario_id
       JOIN usuario_roles ur ON ur.usuario_id = u.id
       JOIN roles r          ON r.id = ur.rol_id
       WHERE s.id = $1
         AND s.usuario_id = $2
         AND s.revocada_at IS NULL
         AND s.expira_at > now()
         AND u.activo = true
       ORDER BY ur.secretaria_id NULLS LAST
       LIMIT 1`,
      [payload.sid, payload.sub],
    );

    if (rows.length === 0) throw new UnauthorizedException('Sesión inválida o revocada');

    const u = rows[0];
    return {
      userId: u.id,
      email: u.email,
      rol: u.rol,
      secretariaId: u.secretaria_id,
      sid: payload.sid,
    };
  }
}
