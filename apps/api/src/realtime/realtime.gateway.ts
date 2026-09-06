import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { parse as parseCookies } from 'cookie';
import type { AuthenticatedUser, JwtPayload } from '../auth/jwt-payload';

// credentials: true + origen explícito (nunca '*' -- el navegador rechaza
// mandar cookies a un wildcard) porque el JWT ahora viaja en la cookie
// httpOnly del handshake, no en un payload de auth armado a mano por JS.
@Injectable()
@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3002', credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwt: JwtService) {}

  // No hay handshake HTTP con Guards acá (los guards globales no aplican a
  // WebSockets), así que el JWT se verifica a mano con el mismo secreto/
  // servicio que usa el login -- pero ahora se lee de la cookie que el
  // navegador ya adjuntó solo, igual que en cualquier request HTTP normal
  // (el cliente se conecta con `withCredentials: true`, sin tocar el token).
  async handleConnection(client: Socket) {
    const rawCookies = client.handshake.headers.cookie;
    const token = rawCookies ? parseCookies(rawCookies).access_token : undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const user: AuthenticatedUser = {
        userId: payload.sub,
        email: payload.email,
        rol: payload.rol,
        secretariaId: payload.secretariaId,
      };
      client.data.user = user;
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // No hay estado propio que limpiar: socket.io ya saca el socket de
    // server.sockets.sockets al desconectarse.
  }

  getAuthenticatedSockets(): Array<Socket & { data: { user: AuthenticatedUser } }> {
    return [...this.server.sockets.sockets.values()].filter(
      (s): s is Socket & { data: { user: AuthenticatedUser } } => !!s.data.user,
    );
  }
}
