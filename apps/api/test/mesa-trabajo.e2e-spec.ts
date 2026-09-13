/**
 * Mesa de trabajo de Agenda (034_agenda_mesa_trabajo.sql, EventosService.
 * mesaTrabajo()): vista de tabla para la jefa de Gabinete sobre los MISMOS
 * eventos_agenda del calendario -- este archivo cubre lo nuevo de este lote,
 * no repite la matriz de RLS ya probada en solicitudes-agenda.e2e-spec.ts:
 *
 *   1) los filtros de la consulta (búsqueda, estado, sin horario,
 *      participación del Gobernador, indicación pendiente, responsable),
 *   2) que "persona de apoyo responsable" salga de evento_colaboradores
 *      (trabajo delegado) y NUNCA de ser invitado (evento_responsables) --
 *      el punto explícito del pedido ("no inventes un responsable a partir
 *      de ser invitado"),
 *   3) el bloqueo optimista (ifUpdatedAt): 409 con el estado real del
 *      servidor cuando otra persona ya guardó, y que ese mismo estado sirva
 *      para reintentar con éxito.
 *
 * Mismo patrón que solicitudes-agenda.e2e-spec.ts: sesiones directo en la
 * tabla `sesiones` + JwtService (evita el throttle de /auth/login), sin
 * ROLLBACK (algunas rutas dependen de triggers que solo corren en COMMIT),
 * limpieza explícita en afterAll con set_config de jefe_gabinete para poder
 * borrar bajo RLS.
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

describe('Mesa de trabajo de Agenda (e2e real)', () => {
  let app: INestApplication;
  let db: PgClient;
  let jwt: JwtService;
  const rand = Math.random().toString(36).slice(2, 8);
  const usuarioIds: string[] = [];
  const eventoIds: string[] = [];

  let apoyo1Id: string;
  let apoyo2Id: string;
  let jefaId: string;
  let gobernadorId: string;

  let cookieApoyo1: string;
  let cookieJefa: string;
  let cookieGobernador: string;

  async function crearSesionYCookie(usuarioId: string): Promise<string> {
    const refreshCrudo = randomBytes(32).toString('hex');
    const s = await db.query<{ id: string }>(
      `INSERT INTO sesiones (usuario_id, refresh_hash, expira_at) VALUES ($1, $2, now() + interval '30 days') RETURNING id`,
      [usuarioId, hashRefresh(refreshCrudo)],
    );
    const accessToken = await jwt.signAsync({ sub: usuarioId, sid: s.rows[0].id });
    return `access_token=${accessToken}`;
  }

  async function crearUsuario(nombre: string, rolNombre: string) {
    const u = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, secretaria_id, activo) VALUES ($1,$2,$3,true) RETURNING id`,
      [nombre, `${nombre.toLowerCase().replace(/\s+/g, '.')}-${rand}@mesa.test`, null],
    );
    const id = u.rows[0].id;
    await db.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id) SELECT $1, r.id, NULL FROM roles r WHERE r.nombre=$2`,
      [id, rolNombre],
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
    apoyo1Id = await crearUsuario('Mesa Apoyo Uno', 'apoyo');
    apoyo2Id = await crearUsuario('Mesa Apoyo Dos', 'apoyo');
    jefaId = await crearUsuario('Mesa Jefa', 'jefe_gabinete');
    gobernadorId = await crearUsuario('Mesa Gobernador', 'gobernador');
    await db.query('COMMIT');

    cookieApoyo1 = await crearSesionYCookie(apoyo1Id);
    cookieJefa = await crearSesionYCookie(jefaId);
    cookieGobernador = await crearSesionYCookie(gobernadorId);
  }, 30000);

  afterAll(async () => {
    if (db) {
      try {
        await db.query('BEGIN');
        // set_config local a la transacción: sin esto los DELETE de abajo
        // corren sin ningún rol en contexto y "funcionan" sin borrar nada
        // (mismo hallazgo que solicitudes-agenda.e2e-spec.ts).
        await db.query(
          `SELECT set_config('app.current_rol', 'jefe_gabinete', true),
                  set_config('app.current_secretaria_id', '', true),
                  set_config('app.current_user_id', $1, true)`,
          [jefaId],
        );
        // evento_indicaciones no se borra acá a propósito: ni jefe_gabinete
        // ni admin tienen DELETE sobre esa tabla (indicaciones del Gobernador
        // son un registro permanente, confirmado en vivo esta misma sesión --
        // "permission denied for table evento_indicaciones" intentando lo
        // contrario). Su FK a eventos_agenda es ON DELETE CASCADE, así que
        // se limpia sola al borrar el evento de abajo.
        await db.query(`DELETE FROM evento_colaboradores WHERE evento_id = ANY($1::uuid[])`, [eventoIds]);
        await db.query(`DELETE FROM evento_responsables WHERE evento_id = ANY($1::uuid[])`, [eventoIds]);
        await db.query(`DELETE FROM eventos_agenda WHERE id = ANY($1::uuid[])`, [eventoIds]);
        await db.query(`DELETE FROM sesiones WHERE usuario_id = ANY($1::uuid[])`, [usuarioIds]);
        await db.query(`DELETE FROM usuario_roles WHERE usuario_id = ANY($1::uuid[])`, [usuarioIds]);
        await db.query(`UPDATE usuarios SET activo=false WHERE id = ANY($1::uuid[])`, [usuarioIds]);
        await db.query('COMMIT');

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

  const organizacion = `Colegio de Auditores ${Math.random().toString(36).slice(2, 8)}`;
  let eventoId: string;

  it('apoyo1 registra una solicitud corta sin horario, con organización solicitante', async () => {
    const res = await request(app.getHttpServer())
      .post('/eventos')
      .set('Cookie', cookieApoyo1)
      .send({
        titulo: `Auditoría de instalaciones ${rand}`,
        organizacionSolicitante: organizacion,
        nivelConfidencialidad: 'interna',
        estado: 'solicitud',
      })
      .expect(201);
    eventoId = res.body.id;
    eventoIds.push(eventoId);
    expect(res.body.fecha_inicio).toBeNull();
  });

  it('búsqueda: la jefa la encuentra por organización solicitante', async () => {
    const res = await request(app.getHttpServer())
      .get(`/eventos/mesa-trabajo?busqueda=${encodeURIComponent(organizacion)}`)
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(res.body.datos.find((f: { id: string }) => f.id === eventoId)).toBeDefined();
  });

  it('búsqueda: no aparece con un texto que no coincide', async () => {
    const res = await request(app.getHttpServer())
      .get(`/eventos/mesa-trabajo?busqueda=${encodeURIComponent('texto que no existe ' + rand)}`)
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(res.body.datos.find((f: { id: string }) => f.id === eventoId)).toBeUndefined();
  });

  it('filtro sinHorario=true la incluye (todavía sin fecha_inicio)', async () => {
    const res = await request(app.getHttpServer())
      .get('/eventos/mesa-trabajo?sinHorario=true')
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(res.body.datos.find((f: { id: string }) => f.id === eventoId)).toBeDefined();
  });

  // El punto explícito del pedido: ser invitado (evento_responsables) NO
  // vuelve a nadie "persona de apoyo responsable" -- eso sale solo de
  // evento_colaboradores (trabajo delegado), donde apoyo1 ya quedó al crear
  // (crear(), "colaboración propia e inmediata").
  it('"persona de apoyo responsable" es apoyo1 (colaborador), no se inventa de ser invitado', async () => {
    const antes = await request(app.getHttpServer())
      .get(`/eventos/mesa-trabajo?busqueda=${encodeURIComponent(organizacion)}`)
      .set('Cookie', cookieJefa)
      .expect(200);
    const filaAntes = antes.body.datos.find((f: { id: string }) => f.id === eventoId);
    expect(filaAntes.responsable_apoyo_id).toBe(apoyo1Id);
    expect(filaAntes.responsable_apoyo_nombre).toBe('Mesa Apoyo Uno');
    expect(filaAntes.participa_gobernador).toBe(false);

    // La jefa invita al Gobernador como participante (evento_responsables) --
    // no como colaborador. Esto SÍ debe marcar participa_gobernador (ese
    // campo lee evento_responsables, sea cual sea el camino por el que se
    // llenó), pero NO debe tocar responsable_apoyo (ese lee
    // evento_colaboradores, un concepto distinto: trabajo delegado).
    await request(app.getHttpServer())
      .put(`/eventos/${eventoId}/responsables`)
      .set('Cookie', cookieJefa)
      .send({ usuarioIds: [gobernadorId] })
      .expect(200);

    const despues = await request(app.getHttpServer())
      .get(`/eventos/mesa-trabajo?busqueda=${encodeURIComponent(organizacion)}`)
      .set('Cookie', cookieJefa)
      .expect(200);
    const filaDespues = despues.body.datos.find((f: { id: string }) => f.id === eventoId);
    expect(filaDespues.participa_gobernador).toBe(true);
    expect(filaDespues.responsable_apoyo_id).toBe(apoyo1Id);
    expect(filaDespues.responsable_apoyo_nombre).toBe('Mesa Apoyo Uno');
  });

  it('filtro responsableApoyoId: aparece con el id de apoyo1, no con el de apoyo2', async () => {
    const conApoyo1 = await request(app.getHttpServer())
      .get(`/eventos/mesa-trabajo?responsableApoyoId=${apoyo1Id}`)
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(conApoyo1.body.datos.find((f: { id: string }) => f.id === eventoId)).toBeDefined();

    const conApoyo2 = await request(app.getHttpServer())
      .get(`/eventos/mesa-trabajo?responsableApoyoId=${apoyo2Id}`)
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(conApoyo2.body.datos.find((f: { id: string }) => f.id === eventoId)).toBeUndefined();
  });

  it('filtro participaGobernador=false ya no la incluye (el Gobernador quedó invitado en la prueba anterior)', async () => {
    const res = await request(app.getHttpServer())
      .get('/eventos/mesa-trabajo?participaGobernador=false')
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(res.body.datos.find((f: { id: string }) => f.id === eventoId)).toBeUndefined();
  });

  it('la jefa confirma con horario: filtro estado=confirmado la incluye, estado=solicitud ya no, sinHorario=true ya no', async () => {
    const inicio = new Date(Date.now() + 86_400_000).toISOString();
    const fin = new Date(Date.now() + 86_400_000 + 1_800_000).toISOString();
    await request(app.getHttpServer())
      .patch(`/eventos/${eventoId}`)
      .set('Cookie', cookieJefa)
      .send({ fechaInicio: inicio, fechaFin: fin, estado: 'confirmado' })
      .expect(200);

    const confirmado = await request(app.getHttpServer())
      .get('/eventos/mesa-trabajo?estado=confirmado')
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(confirmado.body.datos.find((f: { id: string }) => f.id === eventoId)).toBeDefined();

    const solicitud = await request(app.getHttpServer())
      .get('/eventos/mesa-trabajo?estado=solicitud')
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(solicitud.body.datos.find((f: { id: string }) => f.id === eventoId)).toBeUndefined();

    const sinHorario = await request(app.getHttpServer())
      .get('/eventos/mesa-trabajo?sinHorario=true')
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(sinHorario.body.datos.find((f: { id: string }) => f.id === eventoId)).toBeUndefined();
  });

  it('indicación pendiente: el Gobernador pide un cambio, el filtro conIndicacionPendiente=true la muestra con el tipo correcto', async () => {
    const indicacion = await request(app.getHttpServer())
      .post(`/eventos/${eventoId}/indicaciones`)
      .set('Cookie', cookieGobernador)
      .send({ tipo: 'aclaracion', texto: '¿Quién de la organización va a estar presente?' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/eventos/mesa-trabajo?conIndicacionPendiente=true')
      .set('Cookie', cookieJefa)
      .expect(200);
    const fila = res.body.datos.find((f: { id: string }) => f.id === eventoId);
    expect(fila).toBeDefined();
    expect(fila.indicacion_pendiente_id).toBe(indicacion.body.id);
    expect(fila.indicacion_pendiente_tipo).toBe('aclaracion');

    // La jefa la atiende -- deja de estar pendiente, el filtro ya no la trae.
    await request(app.getHttpServer())
      .patch(`/eventos/indicaciones/${indicacion.body.id}`)
      .set('Cookie', cookieJefa)
      .send({ estado: 'aplicada', resultadoNota: 'Va a estar el ingeniero a cargo.' })
      .expect(200);

    const despues = await request(app.getHttpServer())
      .get('/eventos/mesa-trabajo?conIndicacionPendiente=true')
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(despues.body.datos.find((f: { id: string }) => f.id === eventoId)).toBeUndefined();
  });

  // Protección frente a cambios simultáneos (punto 6 del pedido): si otra
  // persona ya guardó, no se sobrescribe en silencio -- 409 con el estado
  // real, y ese mismo estado sirve para reintentar.
  describe('bloqueo optimista (ifUpdatedAt)', () => {
    it('PATCH con el ifUpdatedAt correcto guarda normalmente', async () => {
      const actual = await request(app.getHttpServer())
        .get(`/eventos/${eventoId}`)
        .set('Cookie', cookieJefa)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/eventos/${eventoId}`)
        .set('Cookie', cookieJefa)
        .send({ lugar: 'Sala de auditorías, piso 2', ifUpdatedAt: actual.body.updated_at })
        .expect(200);
      expect(res.body.lugar).toBe('Sala de auditorías, piso 2');
    });

    it('PATCH reutilizando ese mismo ifUpdatedAt (ya vencido) choca con 409 y trae el estado real', async () => {
      const res = await request(app.getHttpServer())
        .get(`/eventos/${eventoId}`)
        .set('Cookie', cookieJefa)
        .expect(200);
      const updatedAtVencido = res.body.updated_at;

      // Alguien más (jefa, en otra pestaña) ya volvió a guardar -- avanza
      // updated_at más allá del que se acaba de leer.
      await request(app.getHttpServer())
        .patch(`/eventos/${eventoId}`)
        .set('Cookie', cookieJefa)
        .send({ lugar: 'Sala de auditorías, piso 3 (cambiada por otra persona)' })
        .expect(200);

      const conflicto = await request(app.getHttpServer())
        .patch(`/eventos/${eventoId}`)
        .set('Cookie', cookieJefa)
        .send({ lugar: 'Un cambio que llega tarde', ifUpdatedAt: updatedAtVencido })
        .expect(409);
      expect(conflicto.body.message).toBeDefined();
      expect(conflicto.body.actual.id).toBe(eventoId);
      expect(conflicto.body.actual.lugar).toBe('Sala de auditorías, piso 3 (cambiada por otra persona)');

      // No se aplicó el cambio que llegó tarde -- el lugar sigue siendo el
      // del guardado anterior, no se sobrescribió en silencio.
      const sigueIgual = await request(app.getHttpServer())
        .get(`/eventos/${eventoId}`)
        .set('Cookie', cookieJefa)
        .expect(200);
      expect(sigueIgual.body.lugar).toBe('Sala de auditorías, piso 3 (cambiada por otra persona)');

      // El "actual" que vino en el 409 sirve para reintentar con éxito.
      await request(app.getHttpServer())
        .patch(`/eventos/${eventoId}`)
        .set('Cookie', cookieJefa)
        .send({ lugar: 'Reintentado con la versión correcta', ifUpdatedAt: conflicto.body.actual.updated_at })
        .expect(200);
    });

    it('PATCH sin ifUpdatedAt (nadie pidió protección) sigue funcionando como siempre -- no es obligatorio', async () => {
      await request(app.getHttpServer())
        .patch(`/eventos/${eventoId}`)
        .set('Cookie', cookieJefa)
        .send({ descripcion: 'Sin bloqueo optimista, comportamiento previo intacto' })
        .expect(200);
    });
  });

  it('paginación: total/pagina/paginas coherentes con porPagina=1', async () => {
    const res = await request(app.getHttpServer())
      .get(`/eventos/mesa-trabajo?busqueda=${encodeURIComponent(organizacion)}&porPagina=1&pagina=1`)
      .set('Cookie', cookieJefa)
      .expect(200);
    expect(res.body.datos.length).toBeLessThanOrEqual(1);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.pagina).toBe(1);
    expect(res.body.porPagina).toBe(1);
    expect(res.body.paginas).toBeGreaterThanOrEqual(1);
  });
});
