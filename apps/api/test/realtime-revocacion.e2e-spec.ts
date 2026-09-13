/**
 * Robustez de la revocación en tiempo real -- lo que
 * agenda-seguridad.e2e-spec.ts no cubre:
 *  - las 4 vías de revocación por separado (logout, baja, cambio de rol,
 *    revocación directa), cada una probando AUSENCIA DE CONTENIDO real
 *    (no solo `socket.connected`) y que otras sesiones válidas siguen
 *    funcionando;
 *  - pérdida y recuperación real de la conexión LISTEN (se mata la conexión
 *    en Postgres, se revoca una sesión mientras está caída, se reconecta
 *    sola, se verifica que la reconciliación al reconectar revalida y
 *    desconecta lo que quedó pendiente);
 *  - fallo de la base de datos durante la autenticación de un socket
 *    (debe fallar cerrado, nunca aceptar);
 *  - autenticación demorada más de diez segundos: demuestra que la
 *    revalidación inmediata (no la caché de corto plazo) es la que
 *    realmente cierra la carrera cuando la autenticación tarda más que la
 *    ventana de la caché.
 *
 * La mayoría de las "sesiones" de este archivo NO pasan por POST /auth/login
 * (throttle de 5/min por IP, compartido por todo el archivo): se crean
 * directo en la tabla `sesiones` y se firma el access_token con el mismo
 * JwtService que usa la app real (app.get(JwtService)) -- exactamente el
 * mismo mecanismo que AuthService.emitirSesion, sin pasar por el límite de
 * intentos. Se reserva un login real para probar el circuito completo de
 * logout, y uno de admin (reusado para baja + cambio de rol).
 *
 * Sin ROLLBACK (igual que agenda-seguridad.e2e-spec.ts): pg_notify solo se
 * entrega en COMMIT. Datos committeados y limpiados explícitamente.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { Client as PgClient, Pool } from 'pg';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/database/database.module';
import { hashPassword } from '../src/common/password.util';

// Mismo algoritmo que AuthService.hash() (sha256 hex) -- se necesita para
// crear una sesión "de mentira" (sin pasar por /auth/login) cuyo
// refresh_token igual sea válido para /auth/logout, que revoca por
// refresh_hash, no por el access_token.
function hashRefresh(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const DB_CFG = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5433),
  database: process.env.DB_NAME ?? 'agenda_gober',
  user: process.env.DB_USER ?? 'app_user',
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
};

const PASSWORD = 'Test-Pass-1234!';

// Pool "con fallas" controlables por texto de la consulta: envuelve el pool
// real con un Proxy que solo intercepta .query -- todo lo demás (.connect,
// .end, .on, etc.) se delega tal cual, así que el resto de la aplicación
// (TxService, TenantContextInterceptor, otros servicios) sigue funcionando
// exactamente igual. Se usa para simular, de forma dirigida y una sola vez
// por bandera, un fallo de base de datos o una autenticación lenta -- sin
// esto habría que adivinar timings o tocar código de producción para
// hacerlo "testeable".
interface ControlDeFallas {
  patronFalla: string | null;
  patronRetraso: string | null;
  retrasoMs: number;
}

function envolverPoolConFallas(real: Pool): {
  proxy: Pool;
  control: ControlDeFallas;
} {
  const control: ControlDeFallas = {
    patronFalla: null,
    patronRetraso: null,
    retrasoMs: 0,
  };
  const proxy = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return async (text: unknown, params?: unknown) => {
          const sql =
            typeof text === 'string'
              ? text
              : ((text as { text?: string })?.text ?? '');
          if (control.patronFalla && sql.includes(control.patronFalla)) {
            control.patronFalla = null;
            throw new Error(
              'Fallo simulado de base de datos (prueba dirigida)',
            );
          }
          if (control.patronRetraso && sql.includes(control.patronRetraso)) {
            const ms = control.retrasoMs;
            control.patronRetraso = null;
            await new Promise((r) => setTimeout(r, ms));
          }
          return (target.query as (...a: unknown[]) => unknown)(text, params);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { proxy: proxy as Pool, control };
}

// Distintivo de la consulta de autenticación del gateway/JwtStrategy (las
// dos usan el mismo texto -- ver realtime.gateway.ts y jwt.strategy.ts).
// La revalidación inmediata (segunda consulta del gateway) usa un texto sin
// este fragmento, así que no se ve afectada por estas banderas.
const SQL_AUTENTICACION = 'ur.secretaria_id NULLS LAST';

function cookieValor(
  header: string | string[] | undefined,
  nombre: string,
): string | null {
  const lista = Array.isArray(header) ? header : header ? [header] : [];
  for (const raw of lista) {
    const [par] = raw.split(';');
    const [k, v] = par.split('=');
    if (k === nombre) return v;
  }
  return null;
}

function esperarEvento(
  socket: Socket,
  evento: string,
  timeoutMs = 5000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`timeout esperando '${evento}'`)),
      timeoutMs,
    );
    socket.once(evento, (arg?: unknown) => {
      clearTimeout(t);
      resolve(arg);
    });
  });
}

function esperarDesconexionReal(
  socket: Socket,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    const intervalo = setInterval(() => {
      if (!socket.connected) {
        clearInterval(intervalo);
        resolve();
      } else if (Date.now() - inicio > timeoutMs) {
        clearInterval(intervalo);
        reject(new Error('timeout esperando desconexión'));
      }
    }, 10);
  });
}

function esperarMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Revocación en tiempo real — robustez (listener, DB, latencia, contenido)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: PgClient; // fixtures (secretarias/usuarios/eventos), commit real
  let jwt: JwtService;
  let poolControl: ControlDeFallas;
  const rand = Math.random().toString(36).slice(2, 8);
  const sockets: Socket[] = [];
  const usuarioIds: string[] = [];

  let secretariaId: string;
  let secretarioId: string; // crea los eventos de control/contenido
  let adminId: string;
  let cookieAdmin: string;

  async function setContext(
    rol: string,
    secretariaCtx: string,
    userId: string,
  ) {
    await db.query(
      `SELECT set_config('app.current_rol', $1, true),
              set_config('app.current_secretaria_id', $2, true),
              set_config('app.current_user_id', $3, true)`,
      [rol, secretariaCtx, userId],
    );
  }

  async function crearOperador(nombre: string): Promise<string> {
    const u = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, secretaria_id, activo) VALUES ($1, $2, $3, true) RETURNING id`,
      [
        nombre,
        `${nombre.toLowerCase().replace(/\s+/g, '.')}-${rand}@rt.test`,
        secretariaId,
      ],
    );
    const id = u.rows[0].id;
    await db.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id) SELECT $1, r.id, $2 FROM roles r WHERE r.nombre='operador'`,
      [id, secretariaId],
    );
    usuarioIds.push(id);
    return id;
  }

  // Crea una sesión directo en la base y firma su access_token con el mismo
  // JwtService que usa la app -- evita el throttle de /auth/login (5/min
  // por IP, compartido por todo el archivo) para las muchas sesiones que
  // este archivo necesita. Es el mismo payload {sub, sid} que
  // AuthService.emitirSesion firma.
  async function crearSesionYCookie(
    usuarioId: string,
  ): Promise<{ cookie: string; refreshCookie: string; sesionId: string }> {
    const refreshCrudo = randomBytes(32).toString('hex');
    const s = await db.query<{ id: string }>(
      `INSERT INTO sesiones (usuario_id, refresh_hash, expira_at) VALUES ($1, $2, now() + interval '30 days') RETURNING id`,
      [usuarioId, hashRefresh(refreshCrudo)],
    );
    const sesionId = s.rows[0].id;
    const accessToken = await jwt.signAsync({ sub: usuarioId, sid: sesionId });
    return {
      cookie: `access_token=${accessToken}`,
      refreshCookie: `refresh_token=${refreshCrudo}`,
      sesionId,
    };
  }

  // set_config(..., true) es local A LA TRANSACCIÓN: sin BEGIN/COMMIT
  // explícito acá, cada consulta de `db` es su propia transacción implícita
  // y el contexto se pierde antes del INSERT (que entonces viola RLS en vez
  // de aplicarla). Además necesita COMMIT real (no ROLLBACK): pg_notify
  // solo se entrega en el commit, y el evento debe persistir para poder
  // limpiarlo en afterAll.
  async function crearEventoInterna(titulo: string): Promise<string> {
    await db.query('BEGIN');
    try {
      await setContext('secretario', secretariaId, secretarioId);
      const inicio = new Date(Date.now() + 3_600_000).toISOString();
      const fin = new Date(Date.now() + 7_200_000).toISOString();
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO eventos_agenda (secretaria_id, titulo, fecha_inicio, fecha_fin, nivel_confidencialidad, creado_por)
         VALUES ($1, $2, $3, $4, 'interna', $5) RETURNING id`,
        [secretariaId, `${titulo} ${rand}`, inicio, fin, secretarioId],
      );
      await db.query('COMMIT');
      return rows[0].id;
    } catch (err) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  function conectarSocket(cookie: string): Socket {
    const socket = io(baseUrl, {
      transports: ['websocket', 'polling'],
      extraHeaders: { Cookie: cookie },
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PG_POOL)
      .useFactory({
        factory: () => {
          // max bajo a propósito: app_user tiene rolconnlimit=20 GLOBAL (todo
          // el rol, no por pool) -- con varios archivos e2e abriendo cada
          // uno su propio pool en la misma corrida, un max:20 por archivo
          // puede sumar más que el límite del rol. Los tests de este archivo
          // no necesitan concurrencia alta.
          const real = new Pool({ ...DB_CFG, max: 5 });
          const { proxy, control } = envolverPoolConFallas(real);
          poolControl = control;
          return proxy;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port =
      typeof address === 'object' && address ? address.port : address;
    baseUrl = `http://127.0.0.1:${port}`;
    jwt = app.get(JwtService);

    db = new PgClient(DB_CFG);
    await db.connect();

    const passHash = await hashPassword(PASSWORD);
    await db.query('BEGIN');

    const sec = await db.query<{ id: string }>(
      `INSERT INTO secretarias (nombre, slug) VALUES ($1,$2) RETURNING id`,
      [`RT Test ${rand}`, `rt-test-${rand}`],
    );
    secretariaId = sec.rows[0].id;

    const secr = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, secretaria_id, activo) VALUES ($1,$2,$3,true) RETURNING id`,
      [`RT Secretario ${rand}`, `rt.secretario.${rand}@rt.test`, secretariaId],
    );
    secretarioId = secr.rows[0].id;
    usuarioIds.push(secretarioId);
    await db.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id) SELECT $1, r.id, $2 FROM roles r WHERE r.nombre='secretario'`,
      [secretarioId, secretariaId],
    );

    const adm = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, secretaria_id, password_hash, activo) VALUES ($1,$2,NULL,$3,true) RETURNING id`,
      [`RT Admin ${rand}`, `rt.admin.${rand}@rt.test`, passHash],
    );
    adminId = adm.rows[0].id;
    usuarioIds.push(adminId);
    await db.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id) SELECT $1, r.id, NULL FROM roles r WHERE r.nombre='admin'`,
      [adminId],
    );

    await db.query('COMMIT');

    // Único login real de este archivo que necesita password (admin, vía
    // RolesGuard('admin') real en /admin/usuarios) -- reusado para baja y
    // cambio de rol.
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `rt.admin.${rand}@rt.test`, password: PASSWORD })
      .expect(200);
    cookieAdmin = `access_token=${cookieValor(loginAdmin.headers['set-cookie'], 'access_token')}`;
  }, 30000);

  afterAll(async () => {
    for (const s of sockets) {
      try {
        s.close();
      } catch {
        /* noop */
      }
    }
    if (db) {
      try {
        await db.query('BEGIN');
        await setContext('admin', '', '');
        await db.query(`DELETE FROM eventos_agenda WHERE secretaria_id = $1`, [
          secretariaId,
        ]);
        await db.query('COMMIT');
      } catch (err) {
        await db.query('ROLLBACK').catch(() => undefined);
        console.warn('Limpieza de eventos falló (no bloqueante):', err);
      }
      try {
        await db.query(
          `DELETE FROM sesiones WHERE usuario_id = ANY($1::uuid[])`,
          [usuarioIds],
        );
        await db.query(
          `DELETE FROM usuario_roles WHERE usuario_id = ANY($1::uuid[])`,
          [usuarioIds],
        );
        await db.query(
          `UPDATE usuarios SET activo = false WHERE id = ANY($1::uuid[])`,
          [usuarioIds],
        );
        await db.query(`UPDATE secretarias SET activa = false WHERE id = $1`, [
          secretariaId,
        ]);
      } catch (err) {
        console.warn(
          'Limpieza de usuarios/sesiones falló (no bloqueante):',
          err,
        );
      }
      await db.end().catch(() => undefined);
    }
    await app?.close();
  }, 30000);

  // ------------------------------------------------------------------
  // 1) Las 4 vías de revocación, cada una probando AUSENCIA DE CONTENIDO
  //    real (no solo socket.connected) y que otra sesión sigue viva.
  // ------------------------------------------------------------------
  async function probarRevocacionYAusenciaDeContenido(
    etiqueta: string,
    revocar: (
      usuarioId: string,
      cookie: string,
      refreshCookie: string,
    ) => Promise<void>,
  ) {
    const opId = await crearOperador(`Op ${etiqueta}`);
    const { cookie, refreshCookie } = await crearSesionYCookie(opId);
    const socket = conectarSocket(cookie);
    await esperarEvento(socket, 'connect');

    // Control positivo: ANTES de revocar, el socket sí recibe contenido de
    // su propia secretaría -- si esto no pasara, "no recibió nada después"
    // no probaría nada (podría ser que nunca recibió nada).
    const eventoControlPromise = esperarEvento(socket, 'evento:cambio', 5000);
    const idControl = await crearEventoInterna(`Control ${etiqueta}`);
    const payloadControl = (await eventoControlPromise) as {
      evento?: { id: string };
    };
    expect(payloadControl.evento?.id).toBe(idControl);

    await revocar(opId, cookie, refreshCookie);
    await esperarDesconexionReal(socket, 5000);
    expect(socket.connected).toBe(false);

    // Después de revocar: se genera contenido nuevo que ANTES sí le habría
    // llegado (misma secretaría, mismo nivel). No debe llegar nada -- se
    // registra cualquier evento recibido para que la aserción sea explícita
    // en vez de "no hubo excepción".
    const recibidosTrasRevocar: unknown[] = [];
    socket.onAny((evento, payload) =>
      recibidosTrasRevocar.push({ evento, payload }),
    );
    await crearEventoInterna(`Después de revocar ${etiqueta}`);
    await esperarMs(800);
    expect(recibidosTrasRevocar).toHaveLength(0);
  }

  it('logout: se desconecta y deja de recibir contenido; el circuito HTTP real corta el acceso', async () => {
    await probarRevocacionYAusenciaDeContenido(
      'logout',
      async (_opId, cookie, refreshCookie) => {
        // /auth/logout revoca por refresh_hash (no por el access_token) --
        // ver auth.controller.ts/auth.service.ts.revocarPorRefresh.
        await request(app.getHttpServer())
          .post('/auth/logout')
          .set('Cookie', `${cookie}; ${refreshCookie}`)
          .expect(200);
        await request(app.getHttpServer())
          .get('/auth/me')
          .set('Cookie', cookie)
          .expect(401);
      },
    );
  }, 20000);

  it('baja (admin desactiva la cuenta): se desconecta y deja de recibir contenido', async () => {
    await probarRevocacionYAusenciaDeContenido('baja', async (opId) => {
      await request(app.getHttpServer())
        .patch(`/admin/usuarios/${opId}`)
        .set('Cookie', cookieAdmin)
        .send({ activo: false })
        .expect(200);
    });
  }, 20000);

  it('cambio de rol (admin): se desconecta y deja de recibir contenido', async () => {
    await probarRevocacionYAusenciaDeContenido('cambio-rol', async (opId) => {
      await request(app.getHttpServer())
        .patch(`/admin/usuarios/${opId}`)
        .set('Cookie', cookieAdmin)
        .send({ rol: 'director', secretariaId })
        .expect(200);
    });
  }, 20000);

  it('revocación directa de la sesión: se desconecta y deja de recibir contenido', async () => {
    await probarRevocacionYAusenciaDeContenido('directa', async (opId) => {
      await db.query(
        `UPDATE sesiones SET revocada_at = now() WHERE usuario_id = $1 AND revocada_at IS NULL`,
        [opId],
      );
    });
  }, 20000);

  it('una sesión válida no relacionada sigue recibiendo contenido después de las 4 revocaciones de arriba', async () => {
    const opId = await crearOperador('Op control final');
    const { cookie } = await crearSesionYCookie(opId);
    const socket = conectarSocket(cookie);
    await esperarEvento(socket, 'connect');

    const promesa = esperarEvento(socket, 'evento:cambio', 5000);
    const id = await crearEventoInterna('Control final');
    const payload = (await promesa) as { evento?: { id: string } };
    expect(payload.evento?.id).toBe(id);
    expect(socket.connected).toBe(true);
  }, 15000);

  // ------------------------------------------------------------------
  // 2) Fallo de base de datos durante la autenticación del socket.
  // ------------------------------------------------------------------
  it('si la consulta de autenticación falla (DB caída), el socket se rechaza -- nunca se acepta a ciegas', async () => {
    const opId = await crearOperador('Op DB falla');
    const { cookie } = await crearSesionYCookie(opId);
    poolControl.patronFalla = SQL_AUTENTICACION;

    const socket = conectarSocket(cookie);
    // No debe llegar 'connect' -- el gateway desconecta apenas la consulta
    // de autenticación tira la excepción simulada (catch-all en
    // handleConnection). Si "conectara" igual, esto fallaría por timeout
    // esperando 'disconnect' o por que 'connect' nunca dispara.
    await esperarDesconexionReal(socket, 5000).catch(() => undefined);
    expect(socket.connected).toBe(false);
    expect(poolControl.patronFalla).toBeNull(); // se consumió: la falla ocurrió
  }, 15000);

  // ------------------------------------------------------------------
  // 3) Autenticación demorada más de 10s: la caché de corto plazo (10s) NO
  //    es la única garantía -- la revalidación inmediata, que corre después
  //    de la demora y no depende de ningún reloj, es la que de verdad cierra
  //    la carrera.
  // ------------------------------------------------------------------
  it('autenticación de >10s: una revocación ocurrida durante la demora igual se detecta (no depende de la caché de 10s)', async () => {
    const opId = await crearOperador('Op lento');
    const { cookie, sesionId } = await crearSesionYCookie(opId);

    // Retrasa SOLO la próxima consulta que matchee (la de autenticación
    // del gateway) 11s -- más que la ventana de la caché de corto plazo
    // (10s, ver realtime.gateway.ts). El listener sigue funcionando con
    // normalidad durante la demora: la revocación de abajo SÍ dispara el
    // trigger/notify/desconectarSesion de inmediato, y ESO es lo que deja
    // la marca de caché con timestamp de "ahora" -- para cuando la
    // consulta demorada por fin responda, esa marca ya tiene más de 10s.
    poolControl.patronRetraso = SQL_AUTENTICACION;
    poolControl.retrasoMs = 11_000;

    const socket = conectarSocket(cookie);

    // Revocar mientras el socket sigue "atascado" en su primera consulta.
    await esperarMs(500);
    await db.query(`UPDATE sesiones SET revocada_at = now() WHERE id = $1`, [
      sesionId,
    ]);

    // El socket debe terminar desconectado igual, gracias a la
    // revalidación inmediata (no a la caché, que para entonces ya
    // expiró). Margen amplio: 11s de demora + reconexión/red.
    await esperarDesconexionReal(socket, 20_000);
    expect(socket.connected).toBe(false);
  }, 30000);

  // ------------------------------------------------------------------
  // 4) Pérdida y recuperación de la conexión LISTEN.
  // ------------------------------------------------------------------
  it('si la conexión LISTEN se cae, una revocación ocurrida en ese momento se pierde como aviso puntual -- pero al reconectar, la reconciliación revalida y desconecta lo pendiente', async () => {
    const opId = await crearOperador('Op listener caido');
    const { cookie, sesionId } = await crearSesionYCookie(opId);
    const socket = conectarSocket(cookie);
    await esperarEvento(socket, 'connect');

    // Matar la conexión LISTEN en el servidor de Postgres (no en el
    // cliente) -- simula una caída de red real, no un cierre prolijo.
    // app_user puede terminar otro backend con el MISMO rol sin ser
    // superusuario (Postgres permite esto desde v10 sin requerir
    // pg_signal_backend cuando el rol coincide).
    //
    // ORDER BY backend_start DESC LIMIT 1 es necesario, no cosmético: se
    // encontró (investigación dirigida, no una corrida más de la suite)
    // que Jest con forceExit:true puede terminar el proceso antes de que
    // PgListenerService.onModuleDestroy() cierre su cliente -- la conexión
    // queda huérfana en Postgres, viva e IDLE, con el mismo
    // application_name (es fijo, compartido con producción a propósito
    // para diagnóstico). En una sesión de desarrollo con varias corridas
    // de esta suite, pg_stat_activity puede tener más de una fila con este
    // nombre. Sin este ORDER BY, `rows[0]` podía apuntar a una conexión
    // huérfana de una corrida anterior en vez de la que realmente sirve el
    // socket de ESTA prueba -- matar la huérfana no interrumpe nada real,
    // la revocación se entrega por el camino normal (rápido), y la
    // aserción de "sigue conectado durante la caída" fallaba porque nunca
    // hubo caída real. Esto reprodujo exactamente el fallo intermitente
    // visto en corridas de la suite completa (confirmado con
    // `SELECT pid, backend_start FROM pg_stat_activity WHERE
    // application_name='agenda_gober_pg_listener'`: 4 filas encontradas,
    // la más vieja de más de una hora). La conexión de ESTA app siempre es
    // la más nueva (se crea en el beforeAll de este archivo, justo antes
    // de este test), así que ordenar por backend_start DESC la identifica
    // de forma confiable sin depender de que no haya huérfanas.
    const { rows } = await db.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE application_name = 'agenda_gober_pg_listener'
       ORDER BY backend_start DESC LIMIT 1`,
    );
    expect(rows.length).toBeGreaterThan(0);
    await db.query('SELECT pg_terminate_backend($1)', [rows[0].pid]);

    // Mientras el listener está caído (el reconnect tiene un backoff fijo
    // de 3s en pg-listener.service.ts), revocar -- el NOTIFY se emite
    // igual (es parte de la misma transacción del UPDATE) pero no hay
    // nadie escuchando en ese instante: se pierde como aviso puntual.
    await esperarMs(300);
    await db.query(`UPDATE sesiones SET revocada_at = now() WHERE id = $1`, [
      sesionId,
    ]);

    // Mientras sigue caído, el socket NO se desconecta -- demuestra que,
    // en efecto, el aviso puntual se perdió (si esto fallara, el resto
    // del test no probaría la reconciliación, probaría otra cosa). Ventana
    // corta a propósito (antes eran 1500ms, dejando solo ~1.2s de margen
    // contra el backoff fijo de 3s): en una corrida de la suite completa
    // esto falló una vez porque el margen era demasiado ajustado frente a
    // jitter real del proceso (Jest compilando/descubriendo más archivos a
    // la vez) -- no una interferencia real entre archivos (confirmado:
    // PgListenerService.onModuleDestroy cierra su conexión LISTEN en
    // app.close(), y una corrida dirigida de este archivo junto a
    // agenda-seguridad.e2e-spec.ts -- que también levanta un
    // PgListenerService propio -- pasó limpia). 400ms sigue siendo
    // suficiente: durante la caída no hay forma de que el aviso llegue,
    // sin importar cuánto se espere, así que el chequeo es válido igual de
    // temprano, y deja ~2.6s de margen contra el backoff.
    await esperarMs(400);
    expect(socket.connected).toBe(true);

    // Esperar a que el propio servicio reconecte solo (backoff de 3s) y
    // corra la reconciliación -- sin llamar a nada manualmente: se prueba
    // el mecanismo real, no un atajo de test.
    await esperarDesconexionReal(socket, 15_000);
    expect(socket.connected).toBe(false);
  }, 30000);
});
