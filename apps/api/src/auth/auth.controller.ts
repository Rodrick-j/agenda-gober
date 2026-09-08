import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from './public.decorator';
import { AuthService, type SesionMeta } from './auth.service';
import { LoginDto } from './dto/login.dto';
import type { AuthenticatedUser } from './jwt-payload';

// access token: 15 min. refresh token: 30 días, y su cookie sólo se manda a
// /auth/* (path acotado) para no exponerla en cada request.
const ACCESS_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function baseCookie() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
  };
}
const accessCookie = () => ({ ...baseCookie(), path: '/' });
const refreshCookie = () => ({ ...baseCookie(), path: '/auth' });

function metaDe(req: Request): SesionMeta {
  return {
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 300) || undefined,
    ip: req.ip,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setTokens(res: Response, accessToken: string, refreshToken: string) {
    res.cookie('access_token', accessToken, { ...accessCookie(), maxAge: ACCESS_MAX_AGE_MS });
    res.cookie('refresh_token', refreshToken, { ...refreshCookie(), maxAge: REFRESH_MAX_AGE_MS });
  }

  private clearTokens(res: Response) {
    res.clearCookie('access_token', accessCookie());
    res.clearCookie('refresh_token', refreshCookie());
  }

  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, user } = await this.auth.login(dto, metaDe(req));
    this.setTokens(res, accessToken, refreshToken);
    return { user };
  }

  // Renueva el par de tokens a partir del refresh de la cookie. Público y
  // throttled: si falla, limpia las cookies y devuelve 401.
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { accessToken, refreshToken, user } = await this.auth.refresh(
        req.cookies?.refresh_token,
        metaDe(req),
      );
      this.setTokens(res, accessToken, refreshToken);
      return { user };
    } catch (err) {
      this.clearTokens(res);
      throw err;
    }
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.revocarPorRefresh(req.cookies?.refresh_token);
    this.clearTokens(res);
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: Request & { user: AuthenticatedUser }) {
    const { userId, email, rol, secretariaId } = req.user;
    return { user: { userId, email, rol, secretariaId } };
  }

  // Sesiones activas del usuario, para "cerrar sesión en otros dispositivos".
  @Get('sesiones')
  async sesiones(@Req() req: Request & { user: AuthenticatedUser }) {
    const lista = await this.auth.listarSesiones(req.user.userId);
    return lista.map((s: { id: string }) => ({ ...s, actual: s.id === req.user.sid }));
  }

  @Delete('sesiones/:id')
  revocarSesion(@Param('id') id: string, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.auth.revocarSesion(req.user.userId, id);
  }
}
