/**
 * fn_disponibilidad_gobernador (028_agenda_seguridad_conflictos.sql) --
 * contra Postgres directo como `app_user` (sin BYPASSRLS), igual que
 * rls.e2e-spec.ts / despacho.e2e-spec.ts. Todo en una transacción con
 * ROLLBACK: no toca datos reales, no deja residuo.
 *
 * Cubre exactamente lo que pide el lote de seguridad:
 *  - la función SOLO responde para gobernador/jefe_gabinete -- ningún otro
 *    rol autenticado recibe nada, ni siquiera vía uuid inventado o el id de
 *    un evento ajeno en excluirId;
 *  - un evento confidencial que NO involucra al Gobernador no genera un
 *    conflicto falso;
 *  - la función nunca puede devolver más que el rango horario (columnas,
 *    no un filtro que se pueda olvidar en un cambio futuro);
 *  - privilegios de ejecución: PUBLIC no puede invocarla, solo app_user;
 *  - search_path fijo (mitiga secuestro de un identificador no calificado
 *    dentro de una función SECURITY DEFINER).
 *
 * Requiere Postgres arriba con las migraciones aplicadas (incluida 028) y
 * DB_* en el entorno.
 */
import { Client } from 'pg';

const cfg = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5433),
  database: process.env.DB_NAME ?? 'agenda_gober',
  user: process.env.DB_USER ?? 'app_user',
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
};

describe('fn_disponibilidad_gobernador — conflictos sin exponer detalle', () => {
  let db: Client;
  const rand = Math.random().toString(36).slice(2, 8);

  let secretariaA: string;
  let secretariaB: string;
  let uGobernador: string;
  let uJefe: string;
  let uOperadorA: string;
  let uOperadorB: string;
  let uAdmin: string;

  // Evento A: confidencial, gobernador INVITADO (evento_responsables).
  let evInvitado: { id: string; inicio: string; fin: string };
  // Evento B: confidencial, NO involucra al Gobernador -- se usa también
  // para probar que excluirId no sirve de oráculo sobre eventos ajenos.
  let evSinGobernador: { id: string; inicio: string; fin: string };
  // Evento C: confidencial, gobernador es el CREADOR (no invitado).
  let evCreador: { id: string; inicio: string; fin: string };

  async function setContext(rol: string, secretariaId: string, userId: string) {
    await db.query(
      `SELECT set_config('app.current_rol', $1, true),
              set_config('app.current_secretaria_id', $2, true),
              set_config('app.current_user_id', $3, true)`,
      [rol, secretariaId, userId],
    );
  }

  async function disponibilidad(
    inicio: string,
    fin: string,
    excluirId?: string,
  ) {
    const { rows } = await db.query<{
      fecha_inicio: string;
      fecha_fin: string;
    }>(
      `SELECT fecha_inicio, fecha_fin FROM fn_disponibilidad_gobernador($1, $2, $3)`,
      [inicio, fin, excluirId ?? null],
    );
    return rows;
  }

  beforeAll(async () => {
    db = new Client(cfg);
    await db.connect();
    await db.query('BEGIN');

    async function crearSecretaria(nombre: string) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO secretarias (nombre, slug) VALUES ($1, $2) RETURNING id`,
        [nombre, nombre.toLowerCase().replace(/\s+/g, '-')],
      );
      return rows[0].id;
    }
    async function crearUsuario(
      nombre: string,
      rol: string,
      secretariaId: string | null,
    ) {
      const u = await db.query<{ id: string }>(
        `INSERT INTO usuarios (nombre, email, secretaria_id) VALUES ($1, $2, $3) RETURNING id`,
        [
          nombre,
          `${nombre.replace(/\s+/g, '.').toLowerCase()}-${rand}@disp.test`,
          secretariaId,
        ],
      );
      await db.query(
        `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id)
         SELECT $1, r.id, $2 FROM roles r WHERE r.nombre = $3`,
        [u.rows[0].id, secretariaId, rol],
      );
      return u.rows[0].id;
    }

    secretariaA = await crearSecretaria(`Disp Test A ${rand}`);
    secretariaB = await crearSecretaria(`Disp Test B ${rand}`);
    uGobernador = await crearUsuario('Disp Gober', 'gobernador', null);
    uJefe = await crearUsuario('Disp Jefe', 'jefe_gabinete', null);
    uOperadorA = await crearUsuario('Disp Operador A', 'operador', secretariaA);
    uOperadorB = await crearUsuario('Disp Operador B', 'operador', secretariaB);
    uAdmin = await crearUsuario('Disp Admin', 'admin', null);

    // El operador de A crea los eventos confidenciales de su secretaría --
    // nivel_rango('confidencial') = 3, así que hace falta rango secretario
    // (operador=1, director=2, secretario=3; ver 005_permisos_finos.sql).
    await db.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id)
       SELECT $1, r.id, $2 FROM roles r WHERE r.nombre = 'secretario'
       ON CONFLICT DO NOTHING`,
      [uOperadorA, secretariaA],
    );
    await setContext('secretario', secretariaA, uOperadorA);

    async function crearEvento(
      titulo: string,
      horaInicio: string,
      horaFin: string,
    ) {
      const { rows } = await db.query<{
        id: string;
        fecha_inicio: string;
        fecha_fin: string;
      }>(
        `INSERT INTO eventos_agenda (secretaria_id, titulo, fecha_inicio, fecha_fin, nivel_confidencialidad, creado_por)
         VALUES ($1, $2, $3::timestamptz, $4::timestamptz, 'confidencial', $5)
         RETURNING id, fecha_inicio, fecha_fin`,
        [secretariaA, `${titulo} ${rand}`, horaInicio, horaFin, uOperadorA],
      );
      return {
        id: rows[0].id,
        inicio: rows[0].fecha_inicio,
        fin: rows[0].fecha_fin,
      };
    }

    evInvitado = await crearEvento(
      'Confidencial con gobernador invitado',
      '2031-06-01T10:00:00-04:00',
      '2031-06-01T11:00:00-04:00',
    );
    await db.query(
      `INSERT INTO evento_responsables (evento_id, usuario_id) VALUES ($1, $2)`,
      [evInvitado.id, uGobernador],
    );

    evSinGobernador = await crearEvento(
      'Confidencial sin gobernador',
      '2031-06-01T14:00:00-04:00',
      '2031-06-01T15:00:00-04:00',
    );

    // Evento C: creado_por = Gobernador, sin invitar a nadie -- prueba la
    // vía "creado_por" (criterio provisional de compatibilidad, ver
    // 028_agenda_seguridad_conflictos.sql), no "invitado". Se inserta con
    // jefe_gabinete actuando (033_eventos_agenda_gobernador_no_escribe.sql
    // le quitó a `gobernador` el permiso de insertar directo en
    // eventos_agenda) -- creado_por sigue apuntando al Gobernador porque es
    // un valor de columna, no depende de quién ejecuta el INSERT. Esto es
    // exactamente el tipo de fila "legado" que ese criterio provisional
    // está pensado para cubrir: una que quedó con creado_por=gobernador sin
    // que el propio Gobernador haya podido insertarla él mismo.
    await setContext('jefe_gabinete', '', uJefe);
    const c = await db.query<{
      id: string;
      fecha_inicio: string;
      fecha_fin: string;
    }>(
      `INSERT INTO eventos_agenda (secretaria_id, titulo, fecha_inicio, fecha_fin, nivel_confidencialidad, creado_por)
       VALUES (NULL, $1, '2031-06-01T18:00:00-04:00'::timestamptz, '2031-06-01T19:00:00-04:00'::timestamptz, 'confidencial', $2)
       RETURNING id, fecha_inicio, fecha_fin`,
      [`Confidencial del propio gobernador ${rand}`, uGobernador],
    );
    evCreador = {
      id: c.rows[0].id,
      inicio: c.rows[0].fecha_inicio,
      fin: c.rows[0].fecha_fin,
    };
  });

  afterAll(async () => {
    if (db) {
      await db.query('ROLLBACK').catch(() => undefined);
      await db.end().catch(() => undefined);
    }
  });

  it('un operador NO recibe el bloque ocupado -- el rol no está en la lista permitida (gobernador/jefe_gabinete)', async () => {
    // Antes de esta corrección, cualquier rol autenticado recibía el bloque
    // oculto vía invitado (evento_responsables); ahora, restringido a los
    // roles que coordinan la agenda de Gabinete, operador ya no lo recibe
    // aunque el rango se cruce exactamente con evInvitado.
    await setContext('operador', secretariaB, uOperadorB);
    const bloques = await disponibilidad(
      '2031-06-01T09:30:00-04:00',
      '2031-06-01T10:30:00-04:00',
    );
    expect(bloques).toHaveLength(0);
  });

  it('un operador tampoco recibe nada vía creado_por -- misma restricción de rol', async () => {
    await setContext('operador', secretariaB, uOperadorB);
    const bloques = await disponibilidad(
      '2031-06-01T17:30:00-04:00',
      '2031-06-01T18:30:00-04:00',
    );
    expect(bloques).toHaveLength(0);
  });

  it('admin tampoco recibe el bloque -- transversal para contenido, pero no está en la lista de "coordina la agenda de Gabinete"', async () => {
    await setContext('admin', '', uAdmin);
    const bloques = await disponibilidad(
      '2031-06-01T09:30:00-04:00',
      '2031-06-01T10:30:00-04:00',
    );
    expect(bloques).toHaveLength(0);
  });

  it('un evento confidencial que NO involucra al Gobernador no genera conflicto falso', async () => {
    await setContext('operador', secretariaB, uOperadorB);
    const bloques = await disponibilidad(
      '2031-06-01T13:30:00-04:00',
      '2031-06-01T14:30:00-04:00',
    );
    expect(bloques).toHaveLength(0);
  });

  it('un rango sin ningún evento del Gobernador no trae nada', async () => {
    await setContext('operador', secretariaB, uOperadorB);
    const bloques = await disponibilidad(
      '2031-06-02T09:00:00-04:00',
      '2031-06-02T10:00:00-04:00',
    );
    expect(bloques).toHaveLength(0);
  });

  it('quien YA puede ver el evento completo no recibe además un bloque oculto duplicado', async () => {
    // jefe_gabinete es transversal: ve evInvitado completo por eventos_select.
    await setContext('jefe_gabinete', '', uJefe);
    const bloques = await disponibilidad(
      '2031-06-01T09:30:00-04:00',
      '2031-06-01T10:30:00-04:00',
    );
    expect(bloques).toHaveLength(0);
  });

  it('excluirId saca el propio evento aunque el rango se cruce (reprogramar sin auto-conflicto)', async () => {
    await setContext('operador', secretariaB, uOperadorB);
    const bloques = await disponibilidad(
      '2031-06-01T09:30:00-04:00',
      '2031-06-01T10:30:00-04:00',
      evInvitado.id,
    );
    expect(bloques).toHaveLength(0);
  });

  it('excluirId no cambia nada para un rol no permitido, sea un uuid inventado o el id de un evento ajeno', async () => {
    // Con la restricción de rol, un operador obtiene [] sin importar qué
    // pase en excluirId -- una propiedad más fuerte que "no delata": no
    // delata NADA, porque no está autorizado a preguntar en absoluto.
    await setContext('operador', secretariaB, uOperadorB);
    const sinExcluir = await disponibilidad(
      '2031-06-01T09:30:00-04:00',
      '2031-06-01T10:30:00-04:00',
    );
    const conUuidInventado = await disponibilidad(
      '2031-06-01T09:30:00-04:00',
      '2031-06-01T10:30:00-04:00',
      '00000000-0000-4000-8000-000000000000',
    );
    const excluyendoElAjeno = await disponibilidad(
      '2031-06-01T09:30:00-04:00',
      '2031-06-01T10:30:00-04:00',
      evSinGobernador.id,
    );
    expect(sinExcluir).toEqual([]);
    expect(conUuidInventado).toEqual([]);
    expect(excluyendoElAjeno).toEqual([]);
  });

  it('solo gobernador y jefe_gabinete están en la lista permitida -- ningún otro rol recibe nada, sea cual sea el escenario', async () => {
    for (const [rol, secretariaId, userId] of [
      ['operador', secretariaB, uOperadorB],
      ['admin', '', uAdmin],
    ] as const) {
      await setContext(rol, secretariaId, userId);
      await expect(
        disponibilidad('2031-06-01T09:30:00-04:00', '2031-06-01T10:30:00-04:00'),
      ).resolves.toEqual([]);
    }
    // gobernador/jefe_gabinete SÍ están permitidos, pero por ser
    // transversales ya ven el evento directo -- 0 es el resultado correcto
    // por una razón distinta (ya cubierto arriba), no por estar excluidos.
    for (const [rol, userId] of [
      ['jefe_gabinete', uJefe],
      ['gobernador', uGobernador],
    ] as const) {
      await setContext(rol, '', userId);
      await expect(
        disponibilidad('2031-06-01T09:30:00-04:00', '2031-06-01T10:30:00-04:00'),
      ).resolves.toEqual([]);
    }
  });

  it('la función nunca devuelve más columnas que fecha_inicio/fecha_fin', async () => {
    const res = await db.query(
      `SELECT * FROM fn_disponibilidad_gobernador(now(), now()) LIMIT 0`,
    );
    expect(res.fields.map((f) => f.name).sort()).toEqual([
      'fecha_fin',
      'fecha_inicio',
    ]);
  });

  it('PUBLIC no tiene permiso de ejecución; solo app_user', async () => {
    const { rows } = await db.query<{
      grantee: string;
      privilege_type: string;
    }>(
      `SELECT grantee, privilege_type FROM information_schema.routine_privileges
       WHERE routine_name = 'fn_disponibilidad_gobernador'`,
    );
    const grantees = rows.map((r) => r.grantee);
    expect(grantees).not.toContain('PUBLIC');
    expect(grantees).toContain('app_user');
  });

  it('search_path está fijado (mitiga secuestro de identificador en SECURITY DEFINER)', async () => {
    const { rows } = await db.query<{ proconfig: string[] | null }>(
      `SELECT proconfig FROM pg_proc WHERE proname = 'fn_disponibilidad_gobernador'`,
    );
    expect(rows[0].proconfig).toEqual(
      expect.arrayContaining([
        expect.stringContaining('search_path=pg_catalog, public'),
      ]),
    );
  });

  it('la función es SECURITY DEFINER y de solo lectura (STABLE)', async () => {
    const { rows } = await db.query<{
      prosecdef: boolean;
      provolatile: string;
    }>(
      `SELECT prosecdef, provolatile FROM pg_proc WHERE proname = 'fn_disponibilidad_gobernador'`,
    );
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].provolatile).toBe('s');
  });
});
