import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // JwtStrategy.validate revalida la sesión contra la base en CADA
        // request (sesión viva + no revocada + usuario activo), así que
        // desactivar a alguien o revocar su sesión lo corta al instante sin
        // importar este TTL. Por eso 60 min: menos ciclos de refresh (y menos
        // 401 intermedios en la consola del navegador) sin perder revocación.
        signOptions: {
          expiresIn: config.get<string>('JWT_ACCESS_TTL') ?? '60m',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  // JwtModule exportado: RealtimeGateway también necesita verificar tokens
  // (el handshake de WebSocket no pasa por los guards HTTP).
  exports: [JwtModule],
})
export class AuthModule {}
