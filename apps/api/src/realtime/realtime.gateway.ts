import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
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
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  // Segunda red, redundante a propósito -- ninguna de las dos es "la única
  // garantía" (ver §2 de la revisión de este lote):
  //  1) la revalidación inmediata en handleConnection (abajo) repregunta a
  //     la base justo antes de aceptar, así que cubre una autenticación
  //     lenta (JWT + consultas bajo carga, aunque tarde varios segundos) --
  //     no depende de ningún techo de tiempo fijo.
  //  2) esta caché cubre el hueco final, de microsegundos, entre que esa
  //     repregunta respondió y se acepta el socket -- si el aviso de
  //     revocación llegó justo ahí, ya se emitió una sola vez y esta es la
  //     última oportunidad de no perderlo. 10s es deliberadamente generoso
  //     para ese hueco puntual, no un plazo que algo dependa de agotar.
  private readonly sesionesRevocadasRecientes = new Map<string, number>();
  private static readonly VENTANA_REVOCACION_RECIENTE_MS = 10_000;

  // Los guards HTTP no aplican a WebSockets: se verifica el JWT a mano y,
  // como el token ya no lleva rol/secretaría, se releen de la base (misma
  // consulta que JwtStrategy.validate: sesión viva + usuario activo).
  async handleConnection(client: Socket) {
    const rawCookies = client.handshake.headers.cookie;
    const token = rawCookies
      ? parseCookies(rawCookies).access_token
      : undefined;
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

      // Revalidación inmediatamente antes de aceptar (no depende de la
      // caché de abajo ni de cuánto tardó lo anterior): cierra la ventana
      // entre la consulta de arriba y este punto sin importar si la
      // autenticación tomó milisegundos o varios segundos bajo carga.
      const revalidacion = await this.pool.query(
        `SELECT 1 FROM sesiones WHERE id = $1 AND revocada_at IS NULL AND expira_at > now()`,
        [payload.sid],
      );
      if (!revalidacion.rowCount) {
        client.disconnect(true);
        return;
      }
      if (this.fueRevocadaRecientemente(payload.sid)) {
        client.disconnect(true);
        return;
      }
      client.data.user = user;
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // socket.io ya saca el socket de server.sockets.sockets al desconectarse.
  }

  getAuthenticatedSockets(): Array<
    Socket & { data: { user: AuthenticatedUser } }
  > {
    return [...this.server.sockets.sockets.values()].filter(
      (s): s is Socket & { data: { user: AuthenticatedUser } } => !!s.data.user,
    );
  }

  // Fuerza la desconexion de los sockets de UNA sesion especifica -- llamado
  // desde PgListenerService cuando Postgres avisa que se revoco esa sesion
  // (canal 'sesiones_revocadas', ver 028_agenda_seguridad_conflictos.sql).
  // Sin esto, un socket conectado seguia recibiendo tiempo real con la
  // autorizacion de la conexion original hasta que se cerraba solo -- el
  // HTTP ya se cortaba al instante (JwtStrategy revalida contra la base en
  // cada request), pero el socket no.
  //
  // Se filtra por `sid` (la sesion), NO por usuario: un usuario puede tener
  // mas de una sesion viva (dos pestañas, dos dispositivos) y revocar una
  // sola no debe desconectar las otras -- exactamente el mismo criterio que
  // ya usa JwtStrategy.validate para HTTP (compara `sesiones.id`, nunca
  // "todas las sesiones de este usuario").
  //
  // El cliente no reintenta la conexion automaticamente tras un disconnect
  // iniciado por el servidor (comportamiento por defecto de socket.io) --
  // vuelve a conectar con contexto fresco recien la proxima vez que la
  // pagina cargue el RealtimeProvider.
  desconectarSesion(sesionId: string): number {
    this.sesionesRevocadasRecientes.set(sesionId, Date.now());
    this.limpiarRevocacionesVencidas();

    let desconectados = 0;
    for (const socket of this.getAuthenticatedSockets()) {
      if (socket.data.user.sid === sesionId) {
        socket.disconnect(true);
        desconectados++;
      }
    }
    return desconectados;
  }

  private fueRevocadaRecientemente(sesionId: string): boolean {
    const marca = this.sesionesRevocadasRecientes.get(sesionId);
    if (marca === undefined) return false;
    if (Date.now() - marca > RealtimeGateway.VENTANA_REVOCACION_RECIENTE_MS) {
      this.sesionesRevocadasRecientes.delete(sesionId);
      return false;
    }
    return true;
  }

  // Se apoya en cada desconexión nueva (evento poco frecuente) para no
  // necesitar un @Interval propio: el mapa nunca crece más allá de "sesiones
  // revocadas en los últimos 10s".
  private limpiarRevocacionesVencidas(): void {
    const ahora = Date.now();
    for (const [sid, marca] of this.sesionesRevocadasRecientes) {
      if (ahora - marca > RealtimeGateway.VENTANA_REVOCACION_RECIENTE_MS) {
        this.sesionesRevocadasRecientes.delete(sid);
      }
    }
  }
}
