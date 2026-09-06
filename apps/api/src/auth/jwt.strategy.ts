import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';
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
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: extractFromCookie,
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Lo que devuelve queda en req.user. No se vuelve a tocar la base de datos
  // acá: se confía en los claims ya firmados del token (por eso el token
  // dura poco — ver JwtModule.registerAsync en auth.module.ts).
  validate(payload: JwtPayload): AuthenticatedUser {
    return { userId: payload.sub, email: payload.email, rol: payload.rol, secretariaId: payload.secretariaId };
  }
}
