/**
 * Lote de seguridad (sockets con autorización revocada + conflictos de
 * disponibilidad del Gobernador) -- de punta a punta: app Nest real
 * escuchando en un puerto real, login real (cookies reales), socket.io-client
 * real.
 *
 * A diferencia de rls.e2e-spec.ts / despacho.e2e-spec.ts, ACÁ NO SE USA
 * ROLLBACK: pg_notify (la base del canal 'sesiones_revocadas' y de todo el
 * tiempo real) solo se entrega a los LISTEN cuando la transacción que lo
 * emite hace COMMIT -- una prueba envuelta en BEGIN...ROLLBACK jamás
 * dispararía el aviso, así que no puede usarse acá. Los datos de prueba se
 * crean de verdad (usuarios/secretaría con nombre y email únicos por
 * corrida) y se limpian explícitamente en afterAll -- ver la nota ahí sobre
 * por qué usuarios/secretaría se desactivan en vez de borrarse.
 *
 * Requiere Postgres arriba con las migraciones aplicadas (incluida 028) y
 * las mismas variables de entorno que usa la API (DB_HOST, DB_PORT, DB_NAME,
 * DB_USER, DB_PASSWORD, JWT_SECRET).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { Client as PgClient } from 'pg';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common/password.util';

const DB_CFG = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5433),
  database: process.env.DB_NAME ?? 'agenda_gober',
  user: process.env.DB_USER ?? 'app_user',
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
};

const PASSWORD = 'Test-Pass-1234!';

type SetCookieHeader = string | string[] | undefined;

function cookieValor(
  setCookieHeader: SetCookieHeader,
  nombre: string,
): string | null {
  const lista = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
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

async function conectarYAsentar(socket: Socket): Promise<void> {
  await esperarEvento(socket, 'connect');
}

// Espera a que el socket quede realmente desconectado, verificando la
// propiedad observable (`socket.connected`) por sondeo en vez de depender
// únicamente del evento 'disconnect'. Se investigó con logging temporal por
// qué la suite fallaba de forma intermitente (~1 de cada 4-5 corridas)
// esperando solo el evento: en cada corrida fallida, el servidor
// identificaba correctamente el socket y llamaba a socket.disconnect(true)
// (confirmado con logs: "desconectarSesion ... desconectados=1"), pero el
// evento 'disconnect' del cliente, en esos casos puntuales, nunca llegaba a
// dispararse pese a que la conexión sí se cerraba. No se pudo aislar la
// causa exacta dentro del tiempo de esta tarea (parece un caso límite de
// socket.io-client cuando cliente y servidor comparten el mismo proceso
// Node -- un patrón de prueba distinto de cliente/navegador y servidor en
// procesos separados, que es como corre en producción). Sondear la
// propiedad en sí prueba exactamente lo que importa para el criterio de
// aceptación -- que el socket deja de poder usarse -- sin depender de que
// un evento puntual se entregue de forma perfecta en este arnés de prueba.
function esperarDesconexionReal(
  socket: Socket,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let motivo = 'sondeo: socket.connected=false';
    socket.once('disconnect', (reason: string) => {
      motivo = `evento disconnect: ${reason}`;
    });
    const inicio = Date.now();
    const intervalo = setInterval(() => {
      if (!socket.connected) {
        clearInterval(intervalo);
        resolve(motivo);
      } else if (Date.now() - inicio > timeoutMs) {
        clearInterval(intervalo);
        reject(
          new Error(
            'timeout esperando desconexión (socket.connected sigue true)',
          ),
        );
      }
    }, 10);
  });
}

describe('Agenda — seguridad de sockets y conflictos del Gobernador (e2e real)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: PgClient;
  const rand = Math.random().toString(36).slice(2, 8);

  let secretariaOperadorId: string;
  let secretariaOtraId: string;
  let gobernadorId: string;
  let secretarioOtraId: string;
  let operadorId: string;
  let apoyoId: string;
  let eventoConfidencialId: string;
  let eventoVisibleId: string;
  const sockets: Socket[] = [];

  // /auth/login tiene @Throttle(5/60s) por IP (auth.controller.ts) -- todas
  // las pruebas de este archivo pegan desde 127.0.0.1, así que comparten el
  // mismo balde. Se loguea UNA vez por cuenta acá (más una cuarta vez,
  // dedicada, para la prueba de logout que necesita destruir SU PROPIA
  // sesión sin tocar la que usan las demás) y se reusan las cookies --
  // nunca más de 4 POST /auth/login en todo el archivo (deja margen bajo
  // el balde de 5).
  let cookieOperador: string;
  let cookieGobernador: string;
  let cookieApoyo: string;

  async function login(
    email: string,
  ): Promise<{ access: string; refresh: string }> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const setCookie: SetCookieHeader = res.headers['set-cookie'];
    const access = cookieValor(setCookie, 'access_token');
    const refresh = cookieValor(setCookie, 'refresh_token');
    if (!access) throw new Error(`login sin access_token para ${email}`);
    return {
      access: `access_token=${access}`,
      refresh: refresh ? `refresh_token=${refresh}` : '',
    };
  }

  async function setContext(rol: string, secretariaId: string, userId: string) {
    await db.query(
      `SELECT set_config('app.current_rol', $1, true),
              set_config('app.current_secretaria_id', $2, true),
              set_config('app.current_user_id', $3, true)`,
      [rol, secretariaId, userId],
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    // Replica lo esencial de main.ts que este test SÍ necesita (Nest no
    // corre bootstrap() en TestingModule): cookie-parser es obligatorio,
    // sin él req.cookies.access_token siempre es undefined y todo login
    // fallaría en silencio (ver jwt.strategy.ts). ValidationPipe, para
    // fidelidad con producción en los DTO que se ejercitan acá.
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

    db = new PgClient(DB_CFG);
    await db.connect();

    const passHash = await hashPassword(PASSWORD);

    await db.query('BEGIN');

    const secOp = await db.query<{ id: string }>(
      `INSERT INTO secretarias (nombre, slug) VALUES ($1,$2) RETURNING id`,
      [`Seg Operador ${rand}`, `seg-operador-${rand}`],
    );
    secretariaOperadorId = secOp.rows[0].id;

    const secOtra = await db.query<{ id: string }>(
      `INSERT INTO secretarias (nombre, slug) VALUES ($1,$2) RETURNING id`,
      [`Seg Otra ${rand}`, `seg-otra-${rand}`],
    );
    secretariaOtraId = secOtra.rows[0].id;

    const gob = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, secretaria_id, password_hash, activo)
       VALUES ($1,$2,NULL,$3,true) RETURNING id`,
      [`Seg Gobernador ${rand}`, `seg.gobernador.${rand}@x.test`, passHash],
    );
    gobernadorId = gob.rows[0].id;
    await db.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id)
       SELECT $1, r.id, NULL FROM roles r WHERE r.nombre='gobernador'`,
      [gobernadorId],
    );

    const secretario = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, secretaria_id, password_hash, activo)
       VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [
        `Seg Secretario Otra ${rand}`,
        `seg.secretario.${rand}@x.test`,
        secretariaOtraId,
        passHash,
      ],
    );
    secretarioOtraId = secretario.rows[0].id;
    await db.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id)
       SELECT $1, r.id, $2 FROM roles r WHERE r.nombre='secretario'`,
      [secretarioOtraId, secretariaOtraId],
    );

    const operador = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, secretaria_id, password_hash, activo)
       VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [
        `Seg Operador ${rand}`,
        `seg.operador.${rand}@x.test`,
        secretariaOperadorId,
        passHash,
      ],
    );
    operadorId = operador.rows[0].id;
    await db.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id)
       SELECT $1, r.id, $2 FROM roles r WHERE r.nombre='operador'`,
      [operadorId, secretariaOperadorId],
    );

    // apoyo (029_agenda_solicitudes.sql): a diferencia de operador, SÍ está
    // en la lista de roles permitidos de fn_disponibilidad_gobernador --
    // sirve para probar el bloque oculto con un caller real, en vez de uno
    // que la función rechaza de entrada por rol.
    const apoyo = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, secretaria_id, password_hash, activo)
       VALUES ($1,$2,NULL,$3,true) RETURNING id`,
      [`Seg Apoyo ${rand}`, `seg.apoyo.${rand}@x.test`, passHash],
    );
    apoyoId = apoyo.rows[0].id;
    await db.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id)
       SELECT $1, r.id, NULL FROM roles r WHERE r.nombre='apoyo'`,
      [apoyoId],
    );

    // Evento confidencial de OTRA secretaría, con el Gobernador invitado --
    // el operador de abajo no tiene ningún vínculo con él.
    await setContext('secretario', secretariaOtraId, secretarioOtraId);
    const evC = await db.query<{ id: string }>(
      `INSERT INTO eventos_agenda (secretaria_id, titulo, fecha_inicio, fecha_fin, nivel_confidencialidad, creado_por)
       VALUES ($1,$2,'2032-03-01T10:00:00-04:00','2032-03-01T11:00:00-04:00','confidencial',$3)
       RETURNING id`,
      [secretariaOtraId, `Confidencial e2e ${rand}`, secretarioOtraId],
    );
    eventoConfidencialId = evC.rows[0].id;
    await db.query(
      `INSERT INTO evento_responsables (evento_id, usuario_id) VALUES ($1,$2)`,
      [eventoConfidencialId, gobernadorId],
    );

    // Evento visible del propio operador (nivel interna, rango operador
    // alcanza) -- para confirmar que el camino "conflicto visible" sigue
    // funcionando igual por HTTP.
    await setContext('operador', secretariaOperadorId, operadorId);
    const evV = await db.query<{ id: string }>(
      `INSERT INTO eventos_agenda (secretaria_id, titulo, fecha_inicio, fecha_fin, nivel_confidencialidad, creado_por)
       VALUES ($1,$2,'2032-03-02T09:00:00-04:00','2032-03-02T10:00:00-04:00','interna',$3)
       RETURNING id`,
      [secretariaOperadorId, `Visible e2e ${rand}`, operadorId],
    );
    eventoVisibleId = evV.rows[0].id;

    await db.query('COMMIT');

    cookieOperador = (await login(`seg.operador.${rand}@x.test`)).access;
    cookieGobernador = (await login(`seg.gobernador.${rand}@x.test`)).access;
    cookieApoyo = (await login(`seg.apoyo.${rand}@x.test`)).access;
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
      // Limpieza real (no rollback): se borra lo que el propio app_user
      // tiene permiso de borrar (eventos, invitados, roles, sesiones) y se
      // DESACTIVA -- nunca se borra -- lo que el sistema nunca borra en
      // producción tampoco (usuarios, secretarías): app_user ni siquiera
      // tiene GRANT DELETE sobre esas dos tablas (ver 001_init_schema.sql),
      // a propósito, para no romper FKs de auditoría/creado_por/etc. Usar
      // una cuenta de superusuario acá solo para "limpiar más" rompería la
      // misma garantía de integridad que el sistema protege siempre.
      try {
        // set_config(..., true) es local a LA TRANSACCIÓN -- sin un BEGIN
        // explícito, cada statement es su propia transacción implícita y el
        // contexto 'admin' se pierde antes de llegar al DELETE (que entonces
        // corre sin RLS a favor y borra 0 filas en silencio). Iba suelto en
        // una primera versión de esta limpieza y dejó eventos de prueba sin
        // borrar -- comprobado con una consulta manual después de correr la
        // suite, no es un supuesto.
        await db.query('BEGIN');
        await setContext('admin', '', '');
        await db.query(
          `DELETE FROM evento_responsables WHERE evento_id = ANY($1::uuid[])`,
          [[eventoConfidencialId, eventoVisibleId].filter(Boolean)],
        );
        await db.query(
          `DELETE FROM eventos_agenda WHERE id = ANY($1::uuid[])`,
          [[eventoConfidencialId, eventoVisibleId].filter(Boolean)],
        );
        await db.query('COMMIT');
      } catch (err) {
        await db.query('ROLLBACK').catch(() => undefined);
        console.warn(
          'Limpieza de eventos de prueba falló (no bloqueante):',
          err,
        );
      }

      try {
        const usuarioIds = [
          gobernadorId,
          secretarioOtraId,
          operadorId,
          apoyoId,
        ].filter(Boolean);
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
        await db.query(
          `UPDATE secretarias SET activa = false WHERE id = ANY($1::uuid[])`,
          [[secretariaOperadorId, secretariaOtraId].filter(Boolean)],
        );
      } catch (err) {
        console.warn(
          'Limpieza de usuarios/sesiones de prueba falló (no bloqueante):',
          err,
        );
      }

      await db.end().catch(() => undefined);
    }

    await app?.close();
  }, 30000);

  it('login real: el operador obtiene una sesión válida (/auth/me responde con ella)', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieOperador)
      .expect(200);
  });

  it('el conflicto oculto aparece para un rol permitido (apoyo) que no puede leer el evento real; operador no recibe nada por esa vía (no está en la lista permitida)', async () => {
    // apoyo SÍ está en la lista permitida de fn_disponibilidad_gobernador
    // (029_agenda_solicitudes.sql) y no tiene ningún vínculo con el evento
    // confidencial del fixture -- caller real para probar el bloque oculto.
    const res = await request(app.getHttpServer())
      .post('/eventos/conflictos')
      .set('Cookie', cookieApoyo)
      .send({
        fechaInicio: '2032-03-01T09:30:00-04:00',
        fechaFin: '2032-03-01T10:30:00-04:00',
      })
      .expect(201);

    const ocultos = res.body.filter(
      (c: { oculto: boolean }) => c.oculto === true,
    );
    expect(ocultos).toHaveLength(1);
    expect(ocultos[0].id).toBeNull();
    expect(ocultos[0].titulo).toBeNull();
    // No debe filtrar NINGUNA otra clave del evento real (lugar, descripcion,
    // secretaria_id, nivel_confidencialidad, etc.) -- solo lo esperado.
    expect(Object.keys(ocultos[0]).sort()).toEqual(
      ['fecha_fin', 'fecha_inicio', 'id', 'oculto', 'titulo'].sort(),
    );

    // operador NO está en la lista permitida (solo coordinan/consultan la
    // agenda de Gabinete: gobernador/jefe_gabinete/apoyo) -- no recibe el
    // bloque oculto, ni ningún otro resultado, para el mismo rango. Esto es
    // el diseño acordado, no un hueco: operador tampoco podría agendar
    // sobre ese horario sin pasar por alguien que sí coordina esa agenda.
    const resOperador = await request(app.getHttpServer())
      .post('/eventos/conflictos')
      .set('Cookie', cookieOperador)
      .send({
        fechaInicio: '2032-03-01T09:30:00-04:00',
        fechaFin: '2032-03-01T10:30:00-04:00',
      })
      .expect(201);
    expect(resOperador.body).toHaveLength(0);

    // Un evento confidencial que NO involucra al Gobernador (ninguno de los
    // fixtures de este archivo cae en 2032-03-03) no debe generar nada,
    // tampoco para un rol permitido.
    const res2 = await request(app.getHttpServer())
      .post('/eventos/conflictos')
      .set('Cookie', cookieApoyo)
      .send({
        fechaInicio: '2032-03-03T09:30:00-04:00',
        fechaFin: '2032-03-03T10:30:00-04:00',
      })
      .expect(201);
    expect(res2.body).toHaveLength(0);
  });

  it('un conflicto visible sigue trayendo el detalle completo (oculto:false, sin duplicarse)', async () => {
    const res = await request(app.getHttpServer())
      .post('/eventos/conflictos')
      .set('Cookie', cookieOperador)
      .send({
        fechaInicio: '2032-03-02T08:30:00-04:00',
        fechaFin: '2032-03-02T09:30:00-04:00',
      })
      .expect(201);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].oculto).toBe(false);
    expect(res.body[0].id).toBe(eventoVisibleId);
    expect(res.body[0].titulo).toContain('Visible e2e');
  });

  it('logout revoca SOLO esa sesión: se mide el plazo (< 2s) y OTRA sesión del mismo usuario no se ve afectada', async () => {
    // Sesión dedicada (no cookieOperador) -- es la única que se destruye a
    // propósito acá. cookieOperador (otra sesión del MISMO usuario, ya
    // logueada en beforeAll) se usa en paralelo para probar que revocar una
    // no desconecta la otra -- antes de la corrección esto fallaba: la
    // primera versión desconectaba por usuario, no por sesión.
    const { access, refresh } = await login(`seg.operador.${rand}@x.test`);

    const socketSesionRevocada = io(baseUrl, {
      transports: ['websocket', 'polling'],
      extraHeaders: { Cookie: access },
      forceNew: true,
    });
    const socketOtraSesion = io(baseUrl, {
      transports: ['websocket', 'polling'],
      extraHeaders: { Cookie: cookieOperador },
      forceNew: true,
    });
    sockets.push(socketSesionRevocada, socketOtraSesion);
    await Promise.all([
      conectarYAsentar(socketSesionRevocada),
      conectarYAsentar(socketOtraSesion),
    ]);
    expect(socketSesionRevocada.connected).toBe(true);

    // GET /auth/me con la cookie vieja funciona ANTES de revocar (control).
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', access)
      .expect(200);

    const t0 = Date.now();
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `${access}; ${refresh}`)
      .expect(200);

    const disconnectReason = await esperarDesconexionReal(
      socketSesionRevocada,
      5000,
    );
    const plazoMs = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(
      `[medición] socket desconectado ${plazoMs} ms después de /auth/logout (razón: ${disconnectReason})`,
    );
    expect(plazoMs).toBeLessThan(2000);
    expect(socketSesionRevocada.connected).toBe(false);

    // La OTRA sesión del mismo usuario (cookieOperador) sigue viva --
    // revocar una sesión no debe tocar las demás del mismo usuario.
    expect(socketOtraSesion.connected).toBe(true);

    // HTTP con la cookie vieja ya no funciona -- falla cerrado, no queda
    // ningún envío autorizado con el permiso anterior.
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', access)
      .expect(401);

    // Control: cookieOperador (otra sesión, del mismo usuario) sigue viva --
    // revocar UNA sesión no revoca todas las del usuario de rebote.
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieOperador)
      .expect(200);
  }, 15000);

  it('revocar la sesión de un usuario no desconecta el socket de otro (aislamiento)', async () => {
    const socketOperador = io(baseUrl, {
      transports: ['websocket', 'polling'],
      extraHeaders: { Cookie: cookieOperador },
      forceNew: true,
    });
    const socketGobernador = io(baseUrl, {
      transports: ['websocket', 'polling'],
      extraHeaders: { Cookie: cookieGobernador },
      forceNew: true,
    });
    sockets.push(socketOperador, socketGobernador);
    await Promise.all([
      conectarYAsentar(socketOperador),
      conectarYAsentar(socketGobernador),
    ]);

    // Revocación directa (mismo UPDATE que admin.service.revocarSesiones
    // ejecuta al desactivar un usuario o cambiarle el rol -- se prueba el
    // mecanismo compartido por esos 3 escenarios, no la ruta HTTP de
    // /admin/usuarios, que exige una sesión admin aparte y no es el objeto
    // de este lote) solo sobre la sesión de cookieOperador.
    await db.query(
      `UPDATE sesiones SET revocada_at = now() WHERE usuario_id = $1 AND revocada_at IS NULL`,
      [operadorId],
    );

    await esperarDesconexionReal(socketOperador, 5000);
    expect(socketOperador.connected).toBe(false);

    // El del Gobernador sigue vivo -- no se desconecta como efecto
    // colateral de revocar la sesión de otro usuario.
    expect(socketGobernador.connected).toBe(true);
  }, 15000);

  it('flujos HTTP no relacionados siguen funcionando después de todo lo anterior', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieGobernador)
      .expect(200);
  });
});
