import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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
    // `estado` faltaba acá (encontrado al probar el recorrido de
    // solicitudes en tiempo real): sin él, un socket que recibe este
    // evento en vivo veía un objeto Evento con `estado` undefined --
    // ej. la píldora de estado del calendario quedaba mal pintada hasta el
    // próximo refresco manual, aunque el dato en la base ya fuera correcto.
    query: `SELECT id, secretaria_id, tipo, titulo, descripcion, lugar, fecha_inicio, fecha_fin,
                   nivel_confidencialidad, recordatorios_activos, estado, creado_por, created_at, updated_at
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
    const esReconexion = this.client !== undefined;
    const client = new Client({
      host: this.config.get<string>('DB_HOST'),
      port: this.config.get<number>('DB_PORT'),
      database: this.config.get<string>('DB_NAME'),
      user: this.config.get<string>('DB_USER'),
      password: this.config.get<string>('DB_PASSWORD'),
      ssl: { rejectUnauthorized: false },
      // Nombre fijo para poder identificar esta conexión en pg_stat_activity
      // (diagnóstico en producción, y necesario para simular de forma
      // dirigida "se cae la conexión LISTEN" en la suite de este lote sin
      // adivinar cuál de las conexiones del pool es esta).
      application_name: 'agenda_gober_pg_listener',
    });

    client.on('notification', (msg) => {
      if (msg.payload) void this.handleNotification(msg.channel, msg.payload);
    });

    client.on('error', (err) => {
      this.logger.error(`Conexión LISTEN caída: ${err.message}`);
      // Reintento fijo cada 3s -- es un intervalo ENTRE intentos, no una
      // cota máxima de "cuánto tarda en recuperarse". Si el corte real
      // (red, Postgres reiniciando) dura más que un intento, se sigue
      // reintentando cada 3s hasta que la conexión vuelve a ser posible; la
      // reconciliación de abajo recién corre en el intento que SÍ logra
      // conectar. En una prueba con un corte breve y puntual (matar una
      // conexión puntual) se midió ~3.1s de punta a punta -- eso es lo que
      // se midió en ese caso local, no una garantía de tiempo máximo para
      // cualquier corte real.
      if (!this.stopped) setTimeout(() => void this.connect(), 3000);
    });

    await client.connect();

    // Orden deliberado, no arbitrario: primero se escucha SOLO
    // 'sesiones_revocadas' (nunca empuja contenido, solo desconecta) y se
    // reconcilia contra el estado real de la base ANTES de escuchar
    // cualquier canal de contenido (CANALES). Si el orden fuera al revés,
    // una notificación de contenido real (alguien edita un evento, por
    // ejemplo) podría llegar y reenviarse a un socket que ya debería estar
    // desconectado -- pero que esta conexión todavía no tuvo chance de
    // revalidar -- usando su identidad vieja (rol/secretaría cacheados al
    // conectar) para decidir qué le llega. Escuchando 'sesiones_revocadas'
    // + reconciliando primero, ningún canal de contenido puede empujar nada
    // con una identidad que ya debería haber sido dada de baja.
    await client.query('LISTEN sesiones_revocadas');

    // Reconciliación: el canal de pub/sub por sí solo NO alcanza. Mientras
    // esta conexión LISTEN estuvo caída (red, reinicio de Postgres, el
    // propio arranque de la API), cualquier revocación ocurrida en el medio
    // nunca llegó como NOTIFY -- Postgres no reenvía notificaciones
    // perdidas al reconectar, se pierden para siempre como evento puntual.
    // Por eso, cada vez que esta conexión queda lista (primera vez o tras
    // reconectar), se revalida cada socket YA conectado contra el estado
    // actual de su sesión en la base, ANTES de habilitar los canales de
    // contenido de abajo.
    await this.revalidarSesionesConectadas(
      esReconexion ? 'reconexión' : 'arranque',
    );

    for (const canal of Object.keys(CANALES)) {
      await client.query(`LISTEN ${canal}`);
    }
    this.client = client;
    this.logger.log(
      `Escuchando: sesiones_revocadas, ${Object.keys(CANALES).join(', ')}`,
    );
  }

  // No hace ninguna suposición sobre CUÁNTO tiempo estuvo caída la conexión
  // ni sobre cuántas revocaciones se perdieron -- simplemente pregunta "de
  // los sockets que tengo conectados ahora, ¿cuáles siguen teniendo una
  // sesión válida en este momento?" y desconecta los que no. Es la misma
  // instrucción SQL que ya usa handleConnection, aplicada en lote.
  private async revalidarSesionesConectadas(motivo: string): Promise<void> {
    const sockets = this.gateway.getAuthenticatedSockets();
    if (sockets.length === 0) return;

    const sids = [...new Set(sockets.map((s) => s.data.user.sid))];
    try {
      const { rows } = await this.pool.query<{ id: string }>(
        `SELECT id FROM sesiones WHERE id = ANY($1::uuid[]) AND revocada_at IS NULL AND expira_at > now()`,
        [sids],
      );
      const validas = new Set(rows.map((r) => r.id));
      let totalDesconectados = 0;
      for (const sid of sids) {
        if (!validas.has(sid)) {
          totalDesconectados += this.gateway.desconectarSesion(sid);
        }
      }
      if (totalDesconectados > 0) {
        this.logger.warn(
          `Reconciliación (${motivo}): ${totalDesconectados} socket(s) con sesión ya inválida, de ${sids.length} sesión(es) conectada(s) revisada(s)`,
        );
      }
    } catch (err) {
      // Fallar acá no reabre nada que no estuviera ya así: los sockets que
      // ya estaban conectados quedan en el estado que tenían -- ni mejor ni
      // peor que antes de este intento. Una falla puntual de la base
      // durante la reconciliación no debe tirar abajo la conexión LISTEN.
      this.logger.error(
        `No se pudo reconciliar sesiones conectadas (${motivo}): ${(err as Error).message}`,
      );
    }
  }

  // Por cada socket autenticado, vuelve a pedir la fila CON el contexto de
  // sesión de ese usuario -- si RLS la bloquea, no llega nada y no se manda
  // el evento. Así el filtro de tiempo real es exactamente el mismo que el
  // de la API HTTP, sin reimplementar la regla en TypeScript.
  private async handleNotification(channel: string, rawPayload: string) {
    if (channel === 'sesiones_revocadas') {
      this.handleSesionRevocada(rawPayload);
      return;
    }

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
      // pool.connect() vive DENTRO del try, no antes -- bug real
      // encontrado en esta sesión (no hipotético): con el pool agotado
      // (rolconnlimit de app_user alcanzado, ej. varias suites de prueba
      // corriendo a la vez contra la misma base), pool.connect() rechaza
      // su promesa; handleNotification() se llama con `void` (fire-and-
      // forget) desde el listener de 'notification', así que esa
      // excepción quedaba sin capturar y tiraba abajo el proceso entero
      // del servidor (unhandled rejection) -- reproducido en esta misma
      // sesión: un pico transitorio de conexiones hizo caer la API real
      // que estaba corriendo para la demostración. Con el connect() dentro
      // del try, un pool agotado para UN socket puntual ya no puede volar
      // el proceso -- se loguea y se sigue con el resto de los sockets,
      // mismo criterio de aislamiento por error que ya tenía el resto de
      // este bloque.
      try {
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
            socket.emit(canal.socketEvent, {
              accion: payload.accion,
              [canal.payloadKey]: rows[0],
            });
          }
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          this.logger.error(
            `Error reenviando evento en tiempo real: ${(err as Error).message}`,
          );
        } finally {
          client.release();
        }
      } catch (err) {
        // No se pudo ni obtener una conexión del pool (ej. límite de
        // conexiones alcanzado) -- ese socket puntual se queda sin este
        // aviso de tiempo real, nunca peor que eso.
        this.logger.error(
          `No se pudo obtener conexión para reenviar evento en tiempo real: ${(err as Error).message}`,
        );
      }
    }
  }

  // Desconecta, si estan conectados, los sockets de la sesion revocada
  // (nunca "todas las del usuario" -- otra sesion viva del mismo usuario,
  // en otra pestaña o dispositivo, no debe verse afectada). No hace ninguna
  // consulta a la base (todo en memoria via el gateway) y nunca deja
  // escapar una excepcion: si algo sale mal aca, el peor caso es que ese
  // socket siga vivo hasta que se desconecte solo -- exactamente el estado
  // que existia ANTES de este canal, nunca algo peor ni un fallo que afecte
  // a los otros canales que comparte esta misma conexion LISTEN.
  private handleSesionRevocada(rawPayload: string): void {
    try {
      const payload = JSON.parse(rawPayload) as {
        sesionId?: string;
        usuarioId?: string;
      };
      if (!payload.sesionId) return;
      const n = this.gateway.desconectarSesion(payload.sesionId);
      if (n > 0) {
        this.logger.log(
          `Sesion revocada: ${n} socket(s) desconectado(s) (sesion ${payload.sesionId}, usuario ${payload.usuarioId ?? '?'})`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Error procesando sesiones_revocadas: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    this.stopped = true;
    await this.client?.end();
  }
}
