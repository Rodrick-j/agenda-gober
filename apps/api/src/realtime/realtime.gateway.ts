import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import type { AuthenticatedUser, JwtPayload } from '../auth/jwt-payload';

// CORS abierto porque todavia no hay frontend con un origen fijo -- acotar
// esto al dominio real antes de exponer el backend fuera de tu maquina.
@Injectable()
@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwt: JwtService) {}

  // No hay handshake HTTP acá (los guards globales no aplican a WebSockets),
  // así que el JWT se verifica a mano con el mismo secreto/servicio que usa
  // el login. Sin token válido, se corta la conexión de una.
  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const user: AuthenticatedUser = {
        userId: payload.sub,
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
