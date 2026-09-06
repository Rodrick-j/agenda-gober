/**
 * Módulo Despacho — RLS + automatización, contra Postgres directo como
 * `app_user` (sin BYPASSRLS). Todo en una transacción con ROLLBACK: no
 * necesita seeds ni deja residuo. Ver también rls.e2e-spec.ts.
 *
 * Requiere Postgres arriba con las migraciones aplicadas y DB_* en el entorno.
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

describe('Despacho — instrucciones / rollup / notificaciones', () => {
  let db: Client;
  const rand = Math.random().toString(36).slice(2, 8);

  let secretariaA: string;
  let uGobernador: string;
  let uJefe: string;
  let uSecretarioA: string;
  let uOperadorA: string;
  let tareaId: string;
  let instruccionId: string;

  async function setContext(rol: string, secretariaId: string, userId: string) {
    await db.query(
      `SELECT set_config('app.current_rol', $1, true),
              set_config('app.current_secretaria_id', $2, true),
              set_config('app.current_user_id', $3, true)`,
      [rol, secretariaId, userId],
    );
  }

  async function expectReject(fn: () => Promise<unknown>, mustContain?: string) {
    await db.query('SAVEPOINT sp');
    let failed = false;
    try {
      await fn();
    } catch (err) {
      failed = true;
      await db.query('ROLLBACK TO SAVEPOINT sp');
      if (mustContain) {
        const e = err as { code?: string; message?: string };
        expect(`${e.code ?? ''} ${e.message ?? ''}`).toContain(mustContain);
      }
    }
    if (!failed) {
      await db.query('ROLLBACK TO SAVEPOINT sp');
      throw new Error('se esperaba que Postgres rechazara la operación, pero la aceptó');
    }
  }

  async function instruccion(campo: 'estado' | 'avance_porcentaje' | 'en_riesgo') {
    const { rows } = await db.query(`SELECT ${campo} AS v FROM instrucciones WHERE id = $1`, [
      instruccionId,
    ]);
    return rows[0]?.v;
  }

  beforeAll(async () => {
    db = new Client(cfg);
    await db.connect();
    await db.query('BEGIN');

    // roles (no tienen RLS; app_user tiene GRANT INSERT)
    await db.query(
      `INSERT INTO roles (nombre, ambito_secretaria) VALUES
         ('gobernador', false), ('jefe_gabinete', false),
         ('secretario', true), ('operador', true)
       ON CONFLICT (nombre) DO NOTHING`,
    );

    const sa = await db.query<{ id: string }>(
      `INSERT INTO secretarias (nombre, slug) VALUES ($1, $2) RETURNING id`,
      [`Despacho Test A ${rand}`, `desp-a-${rand}`],
    );
    secretariaA = sa.rows[0].id;

    async function crearUsuario(nombre: string, rol: string, secretariaId: string | null) {
      const u = await db.query<{ id: string }>(
        `INSERT INTO usuarios (nombre, email, secretaria_id) VALUES ($1, $2, $3) RETURNING id`,
        [nombre, `${nombre.replace(/\s+/g, '.').toLowerCase()}-${rand}@desp.test`, secretariaId],
      );
      await db.query(
        `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id)
         SELECT $1, r.id, $2 FROM roles r WHERE r.nombre = $3`,
        [u.rows[0].id, secretariaId, rol],
      );
      return u.rows[0].id;
    }

    uGobernador = await crearUsuario('Gober', 'gobernador', null);
    uJefe = await crearUsuario('Jefe Gabinete', 'jefe_gabinete', null);
    uSecretarioA = await crearUsuario('Secretario A', 'secretario', secretariaA);
    uOperadorA = await crearUsuario('Operador A', 'operador', secretariaA);

    // Una tarea de la secretaría A, todavía sin vincular a ninguna instrucción.
    await setContext('secretario', secretariaA, uSecretarioA);
    const t = await db.query<{ id: string }>(
      `INSERT INTO tareas (secretaria_id, titulo, descripcion, nivel_confidencialidad, creado_por)
       VALUES ($1, $2, 'de prueba', 'interna', $3) RETURNING id`,
      [secretariaA, `Tarea despacho ${rand}`, uSecretarioA],
    );
    tareaId = t.rows[0].id;
  });

  afterAll(async () => {
    if (db) {
      await db.query('ROLLBACK').catch(() => undefined);
      await db.end().catch(() => undefined);
    }
  });

  it('una secretaría no ve ninguna instrucción (deny by default)', async () => {
    await setContext('secretario', secretariaA, uSecretarioA);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM instrucciones');
    expect(rows[0].n).toBe(0);
  });

  it('solo el Gobernador puede emitir una instrucción', async () => {
    await setContext('operador', secretariaA, uOperadorA);
    await expectReject(
      () =>
        db.query(
          `INSERT INTO instrucciones (titulo, objetivo, emitida_por) VALUES ('x', 'y', $1)`,
          [uOperadorA],
        ),
      'row-level security',
    );
  });

  it('al emitir, le llega una notificación al Jefe de Gabinete', async () => {
    await setContext('gobernador', '', uGobernador);
    const ins = await db.query<{ id: string }>(
      `INSERT INTO instrucciones (titulo, objetivo, prioridad, emitida_por)
       VALUES ($1, 'Coordinar la respuesta', 'alta', $2) RETURNING id`,
      [`Instrucción ${rand}`, uGobernador],
    );
    instruccionId = ins.rows[0].id;

    await setContext('jefe_gabinete', '', uJefe);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM notificaciones
       WHERE tipo = 'instruccion_emitida' AND origen_id = $1`,
      [instruccionId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('el Jefe de Gabinete ve la instrucción; el Gobernador también', async () => {
    for (const [rol, uid] of [
      ['jefe_gabinete', uJefe],
      ['gobernador', uGobernador],
    ] as const) {
      await setContext(rol, '', uid);
      const { rows } = await db.query('SELECT count(*)::int AS n FROM instrucciones WHERE id = $1', [
        instruccionId,
      ]);
      expect(rows[0].n).toBe(1);
    }
  });

  it('al vincular una tarea, el avance se recalcula solo (pendiente → 0, en_ejecucion)', async () => {
    await setContext('jefe_gabinete', '', uJefe);
    await db.query(
      `INSERT INTO instruccion_items (instruccion_id, tipo, ref_id, secretaria_id)
       VALUES ($1, 'tarea', $2, $3)`,
      [instruccionId, tareaId, secretariaA],
    );
    expect(await instruccion('avance_porcentaje')).toBe(0);
    expect(await instruccion('estado')).toBe('en_ejecucion');
  });

  it('cuando la secretaría completa la tarea, la instrucción pasa sola a cumplida', async () => {
    await setContext('secretario', secretariaA, uSecretarioA);
    await db.query(`UPDATE tareas SET estado = 'completada' WHERE id = $1`, [tareaId]);

    await setContext('gobernador', '', uGobernador);
    expect(await instruccion('avance_porcentaje')).toBe(100);
    expect(await instruccion('estado')).toBe('cumplida');
  });

  it('las notificaciones están aisladas por usuario', async () => {
    // El Gobernador NO ve la notificación "instruccion_emitida" del Jefe...
    await setContext('gobernador', '', uGobernador);
    const ajenas = await db.query(
      `SELECT count(*)::int AS n FROM notificaciones WHERE tipo = 'instruccion_emitida'`,
    );
    expect(ajenas.rows[0].n).toBe(0);

    // ...pero sí ve la suya de "instruccion_cumplida".
    const propias = await db.query(
      `SELECT count(*)::int AS n FROM notificaciones WHERE tipo = 'instruccion_cumplida' AND origen_id = $1`,
      [instruccionId],
    );
    expect(propias.rows[0].n).toBe(1);
  });

  it('una secretaría ve su tarea pero nunca el vínculo instruccion_items', async () => {
    await setContext('secretario', secretariaA, uSecretarioA);
    const tarea = await db.query('SELECT count(*)::int AS n FROM tareas WHERE id = $1', [tareaId]);
    expect(tarea.rows[0].n).toBe(1);
    const items = await db.query('SELECT count(*)::int AS n FROM instruccion_items');
    expect(items.rows[0].n).toBe(0);
  });

  it('acuse de recibo: el Gobernador registra su "visto" sobre la instrucción', async () => {
    await setContext('gobernador', '', uGobernador);
    await db.query(
      `INSERT INTO vistos (entidad_tipo, entidad_id, usuario_id, tipo)
       VALUES ('instruccion', $1, $2, 'acuse')
       ON CONFLICT (entidad_tipo, entidad_id, usuario_id) DO UPDATE SET tipo = 'acuse', visto_at = now()`,
      [instruccionId, uGobernador],
    );
    const { rows } = await db.query(
      `SELECT tipo FROM vistos WHERE entidad_tipo = 'instruccion' AND entidad_id = $1 AND usuario_id = $2`,
      [instruccionId, uGobernador],
    );
    expect(rows[0].tipo).toBe('acuse');
  });
});
