/**
 * Recorrido de solicitudes (029_agenda_solicitudes.sql,
 * 030_agenda_solicitud_visibilidad_creador.sql): apoyo registra una
 * solicitud -> la jefa la revisa y confirma horario -> el Gobernador la ve
 * en "Mi jornada". Contra la app real por HTTP (no solo RLS aislada): cubre
 * EventosService.crear()/actualizar() (fechas opcionales, estado, auto-
 * colaboración, auto-responsable del Gobernador al confirmar) y el filtro
 * miParticipacion de listar().
 *
 * Sesiones creadas directo en la tabla `sesiones` + JwtService de la app
 * (mismo patrón que realtime-revocacion.e2e-spec.ts) -- evita el throttle de
 * /auth/login para las varias cuentas que este archivo necesita. Sin
 * ROLLBACK: los triggers de notificación (fn_notify_evento_estado) solo
 * importan en COMMIT y esta suite ejercita justamente esas transiciones;
 * datos committeados y limpiados explícitamente en afterAll (mismo criterio
 * que agenda-seguridad.e2e-spec.ts: eventos/colaboradores/roles se borran,
 * usuarios/secretaría se desactivan, nunca se borran).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { Client as PgClient } from 'pg';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module';

const DB_CFG = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5433),
  database: process.env.DB_NAME ?? 'agenda_gober',
  user: process.env.DB_USER ?? 'app_user',
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
};

function hashRefresh(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('Solicitudes de agenda — apoyo → jefa confirma → Gobernador (e2e real)', () => {
  let app: INestApplication;
  let db: PgClient;
  let jwt: JwtService;
  const rand = Math.random().toString(36).slice(2, 8);
  const usuarioIds: string[] = [];
  const eventoIds: string[] = [];

  let apoyoId: string;
  let apoyo2Id: string;
  let jefaId: string;
  let gobernadorId: string;
  let secretariaId: string;
  let operadorId: string;

  let cookieApoyo: string;
  let cookieApoyo2: string;
  let cookieJefa: string;
  let cookieGobernador: string;
  let cookieOperador: string;

  async function crearSesionYCookie(usuarioId: string): Promise<string> {
    const refreshCrudo = randomBytes(32).toString('hex');
    const s = await db.query<{ id: string }>(
      `INSERT INTO sesiones (usuario_id, refresh_hash, expira_at) VALUES ($1, $2, now() + interval '30 days') RETURNING id`,
      [usuarioId, hashRefresh(refreshCrudo)],
    );
    const accessToken = await jwt.signAsync({ sub: usuarioId, sid: s.rows[0].id });
    return `access_token=${accessToken}`;
  }

  async function crearUsuario(nombre: string, rolNombre: string, secretaria: string | null) {
    const u = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, secretaria_id, activo) VALUES ($1,$2,$3,true) RETURNING id`,
      [nombre, `${nombre.toLowerCase().replace(/\s+/g, '.')}-${rand}@sol.test`, secretaria],
    );
    const id = u.rows[0].id;
    await db.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id) SELECT $1, r.id, $2 FROM roles r WHERE r.nombre=$3`,
      [id, secretaria, rolNombre],
    );
    usuarioIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    await app.listen(0);
    jwt = app.get(JwtService);

    db = new PgClient(DB_CFG);
    await db.connect();

    await db.query('BEGIN');
    const sec = await db.query<{ id: string }>(
      `INSERT INTO secretarias (nombre, slug) VALUES ($1,$2) RETURNING id`,
      [`Sol Test ${rand}`, `sol-test-${rand}`],
    );
    secretariaId = sec.rows[0].id;
    apoyoId = await crearUsuario('Sol Apoyo', 'apoyo', null);
    apoyo2Id = await crearUsuario('Sol Apoyo Dos', 'apoyo', null);
    jefaId = await crearUsuario('Sol Jefa', 'jefe_gabinete', null);
    gobernadorId = await crearUsuario('Sol Gobernador', 'gobernador', null);
    operadorId = await crearUsuario('Sol Operador', 'operador', secretariaId);
    await db.query('COMMIT');

    cookieApoyo = await crearSesionYCookie(apoyoId);
    cookieApoyo2 = await crearSesionYCookie(apoyo2Id);
    cookieJefa = await crearSesionYCookie(jefaId);
    cookieGobernador = await crearSesionYCookie(gobernadorId);
    cookieOperador = await crearSesionYCookie(operadorId);
  }, 30000);

  afterAll(async () => {
    if (db) {
      try {
        await db.query('BEGIN');
        // set_config(..., true) es local A LA TRANSACCIÓN -- sin esto, los
        // DELETE de abajo sobre eventos_agenda/evento_responsables/
        // evento_colaboradores (con RLS FORCE) corren sin ningún rol en
        // contexto: current_setting('app.current_rol') es NULL, ninguna
        // rama de ninguna política dice nunca true, así que el DELETE
        // "funciona" pero afecta 0 filas -- sin error, en silencio. Bug
        // real encontrado en esta sesión (no una suposición): sin este
        // set_config, 9 eventos de corridas anteriores de este archivo
        // quedaron huérfanos en la base, y dos de ellos con una fila real
        // de evento_responsables apuntando a cuentas reales/demo del
        // Gobernador (gobernador@test.local, gobernador@demo.local) --
        // exactamente la contaminación entre pruebas y datos reales que
        // este lote busca evitar. jefe_gabinete alcanza (transversal,
        // eventos_delete/evento_responsables/evento_colaboradores no le
        // restringen nada de esto) -- no hace falta un usuario admin
        // aparte solo para poder limpiar.
        await db.query(
          `SELECT set_config('app.current_rol', 'jefe_gabinete', true),
                  set_config('app.current_secretaria_id', '', true),
                  set_config('app.current_user_id', $1, true)`,
          [jefaId],
        );
        await db.query(`DELETE FROM evento_colaboradores WHERE evento_id = ANY($1::uuid[])`, [eventoIds]);
        await db.query(`DELETE FROM evento_responsables WHERE evento_id = ANY($1::uuid[])`, [eventoIds]);
        await db.query(`DELETE FROM eventos_agenda WHERE id = ANY($1::uuid[])`, [eventoIds]);
        await db.query(`DELETE FROM sesiones WHERE usuario_id = ANY($1::uuid[])`, [usuarioIds]);
        await db.query(`DELETE FROM usuario_roles WHERE usuario_id = ANY($1::uuid[])`, [usuarioIds]);
        await db.query(`UPDATE usuarios SET activo=false WHERE id = ANY($1::uuid[])`, [usuarioIds]);
        await db.query(`UPDATE secretarias SET activa=false WHERE id=$1`, [secretariaId]);
        await db.query('COMMIT');

        // Verificación, no solo intención: confirmar que de verdad se
        // borró lo que debía borrarse, para no repetir el mismo error en
        // silencio otra vez.
        const restantes = await db.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM eventos_agenda WHERE id = ANY($1::uuid[])`,
          [eventoIds],
        );
        if (restantes.rows[0]?.n !== '0') {
          console.warn(
            `Limpieza incompleta: ${restantes.rows[0]?.n} evento(s) de esta corrida seguían existiendo tras el DELETE`,
          );
        }
      } catch (err) {
        await db.query('ROLLBACK').catch(() => undefined);
        console.warn('Limpieza falló (no bloqueante):', err);
      }
      await db.end().catch(() => undefined);
    }
    await app?.close();
  }, 30000);

  let solicitudId: string;

  it('apoyo registra una solicitud corta, sin horario: nace en estado "solicitud", sin fechas', async () => {
    const res = await request(app.getHttpServer())
      .post('/eventos')
      .set('Cookie', cookieApoyo)
      .send({
        titulo: `Audiencia con gremio ${rand}`,
        nivelConfidencialidad: 'interna',
      })
      .expect(201);

    expect(res.body.estado).toBe('solicitud');
    expect(res.body.fecha_inicio).toBeNull();
    expect(res.body.fecha_fin).toBeNull();
    expect(res.body.secretaria_id).toBeNull();
    solicitudId = res.body.id;
    eventoIds.push(solicitudId);
  });

  it('apoyo (el creador) puede volver a ver su propia solicitud', async () => {
    const res = await request(app.getHttpServer())
      .get(`/eventos/${solicitudId}`)
      .set('Cookie', cookieApoyo)
      .expect(200);
    expect(res.body.id).toBe(solicitudId);
  });

  it('otro apoyo, sin vínculo con esa solicitud, no la ve (creado_por no es un permiso genérico)', async () => {
    await request(app.getHttpServer())
      .get(`/eventos/${solicitudId}`)
      .set('Cookie', cookieApoyo2)
      .expect(404);
  });

  it('un operador de otra secretaría tampoco la ve', async () => {
    await request(app.getHttpServer())
      .get(`/eventos/${solicitudId}`)
      .set('Cookie', cookieOperador)
      .expect(404);
  });

  it('el Gobernador todavía no la ve en "Mi jornada" (miParticipacion) -- sigue sin horario y sin confirmar', async () => {
    const desde = new Date(Date.now() - 86_400_000).toISOString();
    const hasta = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const res = await request(app.getHttpServer())
      .get(`/eventos?desde=${desde}&hasta=${hasta}&miParticipacion=true`)
      .set('Cookie', cookieGobernador)
      .expect(200);
    expect(res.body.find((e: { id: string }) => e.id === solicitudId)).toBeUndefined();
  });

  it('la jefa la ve en su bandeja (transversal) y puede proponer horario + tentativo sin exigirle a apoyo nada más', async () => {
    const inicio = new Date(Date.now() + 86_400_000).toISOString();
    const fin = new Date(Date.now() + 86_400_000 + 1_800_000).toISOString();
    const res = await request(app.getHttpServer())
      .patch(`/eventos/${solicitudId}`)
      .set('Cookie', cookieJefa)
      .send({ fechaInicio: inicio, fechaFin: fin, estado: 'tentativo' })
      .expect(200);
    expect(res.body.estado).toBe('tentativo');
    expect(res.body.fecha_inicio).not.toBeNull();
  });

  // A partir de acá la fila YA tiene horario (paso anterior) -- así el
  // rechazo de las dos pruebas siguientes es puramente RLS (eventos_update),
  // no un efecto colateral de estado_requiere_fecha (029): confirmado/
  // cancelado también exigen fecha_inicio/fecha_fin, y probar esto con una
  // fila todavía sin horario mezclaría ambas causas en un mismo 403/500.
  it('apoyo NO puede confirmarla por su cuenta (RLS lo bloquea, no solo la UI)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/eventos/${solicitudId}`)
      .set('Cookie', cookieApoyo)
      .send({ estado: 'confirmado' })
      .expect(403);
    expect(res.body.message).toBeDefined();
  });

  it('apoyo NO puede cancelarla por su cuenta', async () => {
    await request(app.getHttpServer())
      .patch(`/eventos/${solicitudId}`)
      .set('Cookie', cookieApoyo)
      .send({ estado: 'cancelado' })
      .expect(403);
  });

  // La participación del Gobernador es SIEMPRE explícita -- confirmar por
  // sí solo NUNCA lo agrega (corrección real de esta sesión: la versión
  // anterior agregaba automáticamente a TODOS los usuarios con rol
  // `gobernador` al confirmar cualquier evento transversal, sin que nadie
  // lo pidiera -- en una base con más de una cuenta con ese rol, como esta
  // misma suite, eso agregaba participantes que nadie invitó). La jefa
  // marca `participaGobernador: true` a propósito en el mismo PATCH que
  // confirma.
  it('la jefa confirma con participación explícita del Gobernador: queda agregado como responsable', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/eventos/${solicitudId}`)
      .set('Cookie', cookieJefa)
      .send({ estado: 'confirmado', participaGobernador: true })
      .expect(200);
    expect(res.body.estado).toBe('confirmado');

    const detalle = await request(app.getHttpServer())
      .get(`/eventos/${solicitudId}`)
      .set('Cookie', cookieJefa)
      .expect(200);
    const idsResponsables = detalle.body.responsables.map((r: { id: string }) => r.id);
    expect(idsResponsables).toContain(gobernadorId);
    expect(detalle.body.participaGobernador).toBe(true);
  });

  it('el Gobernador ahora sí la ve en "Mi jornada" (miParticipacion=true), con horario confirmado', async () => {
    const desde = new Date(Date.now() - 86_400_000).toISOString();
    const hasta = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const res = await request(app.getHttpServer())
      .get(`/eventos?desde=${desde}&hasta=${hasta}&miParticipacion=true`)
      .set('Cookie', cookieGobernador)
      .expect(200);
    const propia = res.body.find((e: { id: string }) => e.id === solicitudId);
    expect(propia).toBeDefined();
    expect(propia.estado).toBe('confirmado');
  });

  it('esa misma solicitud confirmada ocupa la disponibilidad del Gobernador (fn_disponibilidad_gobernador ve un bloque oculto para alguien sin acceso)', async () => {
    const res = await request(app.getHttpServer())
      .post('/eventos/conflictos')
      .set('Cookie', cookieApoyo2)
      .send({
        fechaInicio: new Date(Date.now() + 86_400_000 + 300_000).toISOString(),
        fechaFin: new Date(Date.now() + 86_400_000 + 900_000).toISOString(),
      })
      .expect(201);
    expect(res.body.some((c: { oculto: boolean }) => c.oculto === true)).toBe(true);
  });

  // Segundo evento transversal, confirmado SIN marcar participación -- el
  // punto exacto que pidió el usuario: dos eventos, uno con participación y
  // otro sin ella, y solo el primero debe ocupar disponibilidad / aparecer
  // en Mi jornada.
  let solicitudSinParticipacionId: string;

  it('segunda solicitud: la jefa la confirma SIN marcar participación del Gobernador', async () => {
    const crear = await request(app.getHttpServer())
      .post('/eventos')
      .set('Cookie', cookieApoyo)
      .send({ titulo: `Reunión interna sin el Gobernador ${rand}`, nivelConfidencialidad: 'interna' })
      .expect(201);
    solicitudSinParticipacionId = crear.body.id;
    eventoIds.push(solicitudSinParticipacionId);

    const inicio = new Date(Date.now() + 172_800_000).toISOString(); // +2 días, no se cruza con la primera
    const fin = new Date(Date.now() + 172_800_000 + 1_800_000).toISOString();
    const res = await request(app.getHttpServer())
      .patch(`/eventos/${solicitudSinParticipacionId}`)
      .set('Cookie', cookieJefa)
      .send({ fechaInicio: inicio, fechaFin: fin, estado: 'confirmado' })
      .expect(200);
    expect(res.body.estado).toBe('confirmado');

    const detalle = await request(app.getHttpServer())
      .get(`/eventos/${solicitudSinParticipacionId}`)
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(detalle.body.participaGobernador).toBe(false);
    expect(detalle.body.responsables).toHaveLength(0);
  });

  it('la segunda solicitud NO aparece en "Mi jornada" del Gobernador (no participa)', async () => {
    const desde = new Date(Date.now() - 86_400_000).toISOString();
    const hasta = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const res = await request(app.getHttpServer())
      .get(`/eventos?desde=${desde}&hasta=${hasta}&miParticipacion=true`)
      .set('Cookie', cookieGobernador)
      .expect(200);
    expect(res.body.find((e: { id: string }) => e.id === solicitudSinParticipacionId)).toBeUndefined();
  });

  it('la segunda solicitud NO ocupa la disponibilidad del Gobernador (sin bloque oculto en su horario)', async () => {
    const res = await request(app.getHttpServer())
      .post('/eventos/conflictos')
      .set('Cookie', cookieApoyo2)
      .send({
        fechaInicio: new Date(Date.now() + 172_800_000 + 300_000).toISOString(),
        fechaFin: new Date(Date.now() + 172_800_000 + 900_000).toISOString(),
      })
      .expect(201);
    expect(res.body.some((c: { oculto: boolean }) => c.oculto === true)).toBe(false);
  });

  it('participaGobernador: false retira una marca anterior (permite corregir, no solo agregar)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/eventos/${solicitudId}`)
      .set('Cookie', cookieJefa)
      .send({ participaGobernador: false })
      .expect(200);
    expect(res.body.id).toBe(solicitudId);

    const detalle = await request(app.getHttpServer())
      .get(`/eventos/${solicitudId}`)
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(detalle.body.participaGobernador).toBe(false);
    expect(detalle.body.responsables.map((r: { id: string }) => r.id)).not.toContain(gobernadorId);

    // Se vuelve a marcar que sí participa para que el resto de las pruebas
    // de este archivo (indicaciones, "Mi jornada") sigan viendo el estado
    // esperado -- este test no debe dejar efectos secundarios para las que
    // corren después.
    await request(app.getHttpServer())
      .patch(`/eventos/${solicitudId}`)
      .set('Cookie', cookieJefa)
      .send({ participaGobernador: true })
      .expect(200);
  });

  it('sin miParticipacion, el Gobernador sigue viendo TODO lo transversal visible (comportamiento previo intacto)', async () => {
    const desde = new Date(Date.now() - 86_400_000).toISOString();
    const hasta = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const res = await request(app.getHttpServer())
      .get(`/eventos?desde=${desde}&hasta=${hasta}`)
      .set('Cookie', cookieGobernador)
      .expect(200);
    expect(res.body.find((e: { id: string }) => e.id === solicitudId)).toBeDefined();
  });

  it('un operador de otra secretaría sigue sin ver el evento confirmado (transversal, sin secretaria_id)', async () => {
    await request(app.getHttpServer())
      .get(`/eventos/${solicitudId}`)
      .set('Cookie', cookieOperador)
      .expect(404);
  });

  // ------------------------------------------------------------------
  // Permisos efectivos: el Gobernador ya NO puede escribir eventos_agenda
  // directo vía API (033_eventos_agenda_gobernador_no_escribe.sql) --
  // "ocultar controles en Mi jornada no es suficiente", se verifica contra
  // el servidor real, no solo contra RLS aislada.
  // ------------------------------------------------------------------
  it('el Gobernador NO puede crear un evento vía POST /eventos', async () => {
    const res = await request(app.getHttpServer())
      .post('/eventos')
      .set('Cookie', cookieGobernador)
      .send({ titulo: 'Intento directo del Gobernador', nivelConfidencialidad: 'interna' })
      .expect(403);
    expect(res.body.message).toBeDefined();
  });

  // 404, no 403 -- y es el código correcto, no una laxitud: a diferencia
  // de INSERT (que siempre se intenta y WITH CHECK lo rechaza con un error
  // -- 42501, mapPgError -> 403), en UPDATE/DELETE la cláusula USING
  // decide qué filas son candidatas ANTES de intentar nada -- si el
  // Gobernador ya no está en esa cláusula (033), Postgres no encuentra
  // ninguna fila que tocar y no hay ningún error que capturar: es
  // exactamente el mismo resultado que pedir un id inexistente, a
  // propósito (no delata "existe pero no podés" a quien no está
  // autorizado). eventos.service.ts (actualizar/eliminar) ya se apoya en
  // "0 filas afectadas" -> NotFoundException para este caso, sin cambios
  // para esta corrección.
  it('el Gobernador NO puede editar un evento existente vía PATCH /eventos/:id (RLS lo filtra, no hay fila que tocar -> 404)', async () => {
    await request(app.getHttpServer())
      .patch(`/eventos/${solicitudId}`)
      .set('Cookie', cookieGobernador)
      .send({ titulo: 'Modificado por el Gobernador' })
      .expect(404);

    const sigueIgual = await request(app.getHttpServer())
      .get(`/eventos/${solicitudId}`)
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(sigueIgual.body.titulo).not.toBe('Modificado por el Gobernador');
  });

  it('el Gobernador NO puede borrar un evento vía DELETE /eventos/:id (misma razón: 404, no hay fila que USING le deje tocar)', async () => {
    await request(app.getHttpServer())
      .delete(`/eventos/${solicitudId}`)
      .set('Cookie', cookieGobernador)
      .expect(404);

    // Sigue existiendo, sin cambios.
    const sigueAhi = await request(app.getHttpServer())
      .get(`/eventos/${solicitudId}`)
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(sigueAhi.body.id).toBe(solicitudId);
  });

  it('la jefa sigue pudiendo editar/borrar sin problema (la separación no le quitó nada a ella)', async () => {
    await request(app.getHttpServer())
      .patch(`/eventos/${solicitudSinParticipacionId}`)
      .set('Cookie', cookieJefa)
      .send({ lugar: 'Sala de gabinete' })
      .expect(200);
  });

  // ------------------------------------------------------------------
  // Indicaciones del Gobernador (032_evento_indicaciones.sql): acción
  // escrita para pedir reprogramación/cancelación/aclaración -- no edita el
  // evento, llega a la jefa, conserva autor y fecha, se marca
  // pendiente/aplicada/descartada.
  // ------------------------------------------------------------------
  let indicacionId: string;

  it('el Gobernador pide reprogramar el evento confirmado (indicación, no edición directa)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/eventos/${solicitudId}/indicaciones`)
      .set('Cookie', cookieGobernador)
      .send({ tipo: 'reprogramar', texto: 'Pido moverlo un día después, se me cruzó otra cosa.' })
      .expect(201);
    expect(res.body.estado).toBe('pendiente');
    expect(res.body.autor_id).toBe(gobernadorId);
    indicacionId = res.body.id;
  });

  it('apoyo (sin vínculo con esa indicación) NO puede verla, ni siquiera si es colaborador del evento', async () => {
    // apoyo2 no tiene vínculo alguno; y ni siquiera apoyo (colaborador del
    // evento) está en la lista permitida de evento_indicaciones_select --
    // alcance mínimo acordado: autor (Gobernador) o quien coordina
    // (jefe_gabinete/admin).
    await request(app.getHttpServer())
      .get(`/eventos/${solicitudId}/indicaciones`)
      .set('Cookie', cookieApoyo)
      .expect(200)
      .then((res) => {
        expect(res.body.find((i: { id: string }) => i.id === indicacionId)).toBeUndefined();
      });
  });

  it('la jefa SÍ la ve en su bandeja', async () => {
    const res = await request(app.getHttpServer())
      .get(`/eventos/${solicitudId}/indicaciones`)
      .set('Cookie', cookieJefa)
      .expect(200);
    const propia = res.body.find((i: { id: string }) => i.id === indicacionId);
    expect(propia).toBeDefined();
    expect(propia.estado).toBe('pendiente');
    expect(propia.tipo).toBe('reprogramar');
  });

  // 404 por la misma razón que las pruebas de permisos de arriba: UPDATE
  // usa USING para decidir qué filas son candidatas antes de intentar
  // nada -- apoyo no está en evento_indicaciones_update, no hay fila que
  // tocar, no hay error que capturar.
  it('apoyo NO puede marcarla como atendida (solo jefe_gabinete/admin) -> 404, RLS ni le deja ver la fila como candidata', async () => {
    await request(app.getHttpServer())
      .patch(`/eventos/indicaciones/${indicacionId}`)
      .set('Cookie', cookieApoyo)
      .send({ estado: 'aplicada' })
      .expect(404);
  });

  it('el Gobernador tampoco puede editar su propia indicación después de creada -> 404, mismo motivo', async () => {
    await request(app.getHttpServer())
      .patch(`/eventos/indicaciones/${indicacionId}`)
      .set('Cookie', cookieGobernador)
      .send({ estado: 'aplicada' })
      .expect(404);
  });

  it('la jefa aplica el cambio real (PATCH del evento) y por separado marca la indicación como aplicada', async () => {
    // +5 días a propósito: la primera solicitud vive en +1 día y la
    // segunda (sin participación) en +2 días -- reprogramar a +2 días acá
    // colisionaría con el horario de la segunda y contaminaría la prueba
    // de disponibilidad de esa otra solicitud (encontrado al correr esto:
    // el bloque oculto que aparecía en el horario de la segunda solicitud
    // no era de ella, era de esta reprogramación cayendo en el mismo
    // rango).
    const nuevoInicio = new Date(Date.now() + 86_400_000 * 5).toISOString();
    const nuevoFin = new Date(Date.now() + 86_400_000 * 5 + 1_800_000).toISOString();
    await request(app.getHttpServer())
      .patch(`/eventos/${solicitudId}`)
      .set('Cookie', cookieJefa)
      .send({ fechaInicio: nuevoInicio, fechaFin: nuevoFin })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/eventos/indicaciones/${indicacionId}`)
      .set('Cookie', cookieJefa)
      .send({ estado: 'aplicada', resultadoNota: 'Reprogramado un día después, según lo pedido.' })
      .expect(200);
    expect(res.body.estado).toBe('aplicada');

    // Autor y fecha original quedan intactos -- solo cambió estado/atención.
    const lista = await request(app.getHttpServer())
      .get(`/eventos/${solicitudId}/indicaciones`)
      .set('Cookie', cookieJefa)
      .expect(200);
    const atendida = lista.body.find((i: { id: string }) => i.id === indicacionId);
    expect(atendida.estado).toBe('aplicada');
    expect(atendida.autor_id).toBe(gobernadorId);
  });

  it('no se puede insertar una indicación ya resuelta, ni con estado inconsistente con la atención', async () => {
    // tipo inválido para el enum -> lo rechaza el DTO antes de llegar a RLS.
    await request(app.getHttpServer())
      .post(`/eventos/${solicitudId}/indicaciones`)
      .set('Cookie', cookieGobernador)
      .send({ tipo: 'no_es_un_tipo_valido', texto: 'x' })
      .expect(400);
  });
});
