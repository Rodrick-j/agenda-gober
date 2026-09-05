import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser, JwtPayload } from './jwt-payload';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Lo que devuelve queda en req.user. No se vuelve a tocar la base de datos
  // acá: se confía en los claims ya firmados del token (por eso el token
  // dura poco — ver JwtModule.registerAsync en auth.module.ts).
  validate(payload: JwtPayload): AuthenticatedUser {
    return { userId: payload.sub, rol: payload.rol, secretariaId: payload.secretariaId };
  }
}
