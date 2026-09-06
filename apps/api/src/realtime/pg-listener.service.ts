import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { RealtimeGateway } from './realtime.gateway';

interface CambioPayload {
  id: string;
  accion: 'INSERT' | 'UPDATE' | 'DELETE';
}

interface CanalConfig {
  // Evento de socket.io que recibe el frontend.
  socketEvent: string;
  // Nombre de la clave que lleva la fila en el payload emitido, ej.
  // { accion, publicacion } vs. { accion, evento } -- cada modulo mantiene
  // su propia forma en vez de un "data" generico.
  payloadKey: string;
  // Debe devolver como maximo 1 fila; RLS decide si hay fila o no segun el
  // contexto (rol/secretaria/usuario) ya seteado antes de correrla.
  query: string;
}

// Un canal por tabla con tiempo real. Agregar un modulo nuevo (Tareas,
// Reuniones...) es sumar una entrada acá + el trigger pg_notify equivalente
// en su migracion -- no hace falta tocar el resto de esta clase.
const CANALES: Record<string, CanalConfig> = {
  publicaciones_cambios: {
    socketEvent: 'publicacion:cambio',
    payloadKey: 'publicacion',
    query: `SELECT id, secretaria_id, titulo, contenido, nivel_confidencialidad, estado, created_at, updated_at
            FROM publicaciones WHERE id = $1`,
  },
  eventos_cambios: {
    socketEvent: 'evento:cambio',
    payloadKey: 'evento',
    query: `SELECT id, secretaria_id, titulo, descripcion, lugar, fecha_inicio, fecha_fin,
                   nivel_confidencialidad, creado_por, created_at, updated_at
            FROM eventos_agenda WHERE id = $1`,
  },
  tareas_cambios: {
    socketEvent: 'tarea:cambio',
    payloadKey: 'tarea',
    // asignados agregado en la misma query (igual que TareasService.listar):
    // si a alguien le reasignan un responsable después de crearla, la
    // próxima notificación (la del propio PATCH) ya lo refleja.
    query: `SELECT t.id, t.secretaria_id, t.titulo, t.descripcion, t.estado, t.prioridad, t.fecha_vencimiento,
                   t.nivel_confidencialidad, t.creado_por, t.created_at, t.updated_at,
                   COALESCE(
                     (SELECT json_agg(json_build_object('id', u.id, 'nombre', u.nombre) ORDER BY u.nombre)
                      FROM tarea_asignados ta JOIN usuarios u ON u.id = ta.usuario_id
                      WHERE ta.tarea_id = t.id),
                     '[]'
                   ) AS asignados
            FROM tareas t WHERE t.id = $1`,
  },
  proyectos_cambios: {
    socketEvent: 'proyecto:cambio',
    payloadKey: 'proyecto',
    query: `SELECT id, secretaria_id, nombre, descripcion, estado, avance_porcentaje, presupuesto,
                   fecha_inicio, fecha_fin_estimada, nivel_confidencialidad, creado_por, created_at, updated_at
            FROM proyectos WHERE id = $1`,
  },
  compromisos_cambios: {
    socketEvent: 'compromiso:cambio',
    payloadKey: 'compromiso',
    query: `SELECT c.id, c.evento_id, c.descripcion, c.responsable_id, c.fecha_limite, c.estado,
                   c.created_at, c.updated_at, u.nombre AS responsable_nombre
            FROM compromisos c LEFT JOIN usuarios u ON u.id = c.responsable_id
            WHERE c.id = $1`,
  },
  // Despacho: la instruccion solo la re-consulta bajo RLS un socket
  // transversal (instrucciones_select); el resto no recibe nada.
  instrucciones_cambios: {
    socketEvent: 'instruccion:cambio',
    payloadKey: 'instruccion',
    query: `SELECT id, titulo, objetivo, prioridad, fecha_limite, estado, emitida_por, organiza_id,
                   avance_porcentaje, en_riesgo, created_at, updated_at
            FROM instrucciones WHERE id = $1`,
  },
  // notificaciones tiene RLS por usuario_id: la re-consulta solo devuelve
  // fila para el socket del destinatario, asi que el evento llega a esa
  // persona y a nadie mas -- sin logica extra de filtrado en TypeScript.
  notificaciones_cambios: {
    socketEvent: 'notificacion:nueva',
    payloadKey: 'notificacion',
    query: `SELECT id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id, leida, leida_at, created_at
            FROM notificaciones WHERE id = $1`,
  },
};

// LISTEN necesita una conexión propia y de larga duración -- no se puede
// hacer desde el pool (que reparte y recicla clientes por request).
@Injectable()
export class PgListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgListenerService.name);
  private client?: Client;
  private stopped = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly gateway: RealtimeGateway,
  ) {}

  async onModuleInit() {
    await this.connect();
  }

  private async connect() {
    const client = new Client({
      host: this.config.get<string>('DB_HOST'),
      port: this.config.get<number>('DB_PORT'),
      database: this.config.get<string>('DB_NAME'),
      user: this.config.get<string>('DB_USER'),
      password: this.config.get<string>('DB_PASSWORD'),
      ssl: { rejectUnauthorized: false },
    });

    client.on('notification', (msg) => {
      if (msg.payload) void this.handleNotification(msg.channel, msg.payload);
    });

    client.on('error', (err) => {
      this.logger.error(`Conexión LISTEN caída: ${err.message}`);
      if (!this.stopped) setTimeout(() => void this.connect(), 3000);
    });

    await client.connect();
    for (const canal of Object.keys(CANALES)) {
      await client.query(`LISTEN ${canal}`);
    }
    this.client = client;
    this.logger.log(`Escuchando: ${Object.keys(CANALES).join(', ')}`);
  }

  // Por cada socket autenticado, vuelve a pedir la fila CON el contexto de
  // sesión de ese usuario -- si RLS la bloquea, no llega nada y no se manda
  // el evento. Así el filtro de tiempo real es exactamente el mismo que el
  // de la API HTTP, sin reimplementar la regla en TypeScript.
  private async handleNotification(channel: string, rawPayload: string) {
    const canal = CANALES[channel];
    if (!canal) return;

    let payload: CambioPayload;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      return;
    }

    if (payload.accion === 'DELETE') {
      // La fila ya no existe: no hay nada que re-consultar bajo RLS para
      // decidir a quién le llega. Se avisa el id "pelado" a todo el mundo
      // (no revela contenido, solo que ese id dejó de existir) y cada
      // cliente lo saca de su vista si lo tenía cargado -- si nunca lo tuvo
      // cargado, el aviso no le dice nada.
      for (const socket of this.gateway.getAuthenticatedSockets()) {
        socket.emit(canal.socketEvent, { accion: 'DELETE', id: payload.id });
      }
      return;
    }

    for (const socket of this.gateway.getAuthenticatedSockets()) {
      const { userId, rol, secretariaId } = socket.data.user;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.current_rol', $1, true),
                  set_config('app.current_secretaria_id', $2, true),
                  set_config('app.current_user_id', $3, true)`,
          [rol, secretariaId ?? '', userId],
        );
        const { rows } = await client.query(canal.query, [payload.id]);
        await client.query('COMMIT');
        if (rows.length > 0) {
          socket.emit(canal.socketEvent, { accion: payload.accion, [canal.payloadKey]: rows[0] });
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        this.logger.error(`Error reenviando evento en tiempo real: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
  }

  async onModuleDestroy() {
    this.stopped = true;
    await this.client?.end();
  }
}
