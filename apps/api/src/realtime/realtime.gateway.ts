import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import { Server, Socket } from 'socket.io';
import { parse as parseCookies } from 'cookie';
import { PG_POOL } from '../database/database.module';
import type { AuthenticatedUser, JwtPayload } from '../auth/jwt-payload';

// credentials: true + origen explícito (nunca '*' -- el navegador rechaza
// mandar cookies a un wildcard) porque el JWT viaja en la cookie httpOnly del
// handshake. Mismo criterio multi-origen que main.ts.
const WS_ORIGINS = (process.env.WEB_ORIGIN ?? 'http://localhost:3002')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

@Injectable()
@WebSocketGateway({ cors: { origin: WS_ORIGINS, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  // Los guards HTTP no aplican a WebSockets: se verifica el JWT a mano y,
  // como el token ya no lleva rol/secretaría, se releen de la base (misma
  // consulta que JwtStrategy.validate: sesión viva + usuario activo).
  async handleConnection(client: Socket) {
    const rawCookies = client.handshake.headers.cookie;
    const token = rawCookies ? parseCookies(rawCookies).access_token : undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const { rows } = await this.pool.query(
        `SELECT u.id, u.email, u.secretaria_id, r.nombre AS rol
         FROM sesiones s
         JOIN usuarios u       ON u.id = s.usuario_id
         JOIN usuario_roles ur ON ur.usuario_id = u.id
         JOIN roles r          ON r.id = ur.rol_id
         WHERE s.id = $1 AND s.usuario_id = $2
           AND s.revocada_at IS NULL AND s.expira_at > now() AND u.activo = true
         ORDER BY ur.secretaria_id NULLS LAST
         LIMIT 1`,
        [payload.sid, payload.sub],
      );
      if (rows.length === 0) {
        client.disconnect(true);
        return;
      }
      const u = rows[0];
      const user: AuthenticatedUser = {
        userId: u.id,
        email: u.email,
        rol: u.rol,
        secretariaId: u.secretaria_id,
        sid: payload.sid,
      };
      client.data.user = user;
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // socket.io ya saca el socket de server.sockets.sockets al desconectarse.
  }

  getAuthenticatedSockets(): Array<Socket & { data: { user: AuthenticatedUser } }> {
    return [...this.server.sockets.sockets.values()].filter(
      (s): s is Socket & { data: { user: AuthenticatedUser } } => !!s.data.user,
    );
  }
}
