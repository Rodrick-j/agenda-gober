import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from './public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import type { AuthenticatedUser } from './jwt-payload';

// 2h, igual que la expiración del JWT (JwtModule.registerAsync en
// auth.module.ts) -- que la cookie no sobreviva al token no tendría sentido.
const COOKIE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @HttpCode(200)
  // Cierra el hallazgo del pentest: máximo 5 intentos por minuto por IP.
  // Esta sí es la superficie real de fuerza bruta (login de usuarios
  // finales) — a diferencia de la credencial interna de Postgres.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, user } = await this.auth.login(dto);
    // httpOnly: JavaScript (incluido un XSS inyectado) no puede leer esta
    // cookie -- solo el navegador la reenvía, y solo al origen que la emitió.
    res.cookie('access_token', accessToken, { ...cookieOptions(), maxAge: COOKIE_MAX_AGE_MS });
    return { user };
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token', cookieOptions());
    return { ok: true };
  }

  // Para restaurar la sesión al recargar la página: como el token ya no es
  // legible por JS, el frontend no puede "decodificarlo" localmente como
  // antes -- le pregunta al backend quién es según la cookie que llegó.
  @Get('me')
  me(@Req() req: Request & { user: AuthenticatedUser }) {
    const { userId, email, rol, secretariaId } = req.user;
    return { user: { userId, email, rol, secretariaId } };
  }
}
