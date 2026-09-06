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
  let itemId: string;

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

    // Una tarea de la secretaría A, con el secretario como asignado (así lo
    // hace el desglose real: la persona responsable está en tarea_asignados).
    await setContext('secretario', secretariaA, uSecretarioA);
    const t = await db.query<{ id: string }>(
      `INSERT INTO tareas (secretaria_id, titulo, descripcion, nivel_confidencialidad, creado_por)
       VALUES ($1, $2, 'de prueba', 'interna', $3) RETURNING id`,
      [secretariaA, `Tarea despacho ${rand}`, uSecretarioA],
    );
    tareaId = t.rows[0].id;
    await db.query(`INSERT INTO tarea_asignados (tarea_id, usuario_id) VALUES ($1, $2)`, [
      tareaId,
      uSecretarioA,
    ]);
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
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO instruccion_items (instruccion_id, tipo, ref_id, secretaria_id)
       VALUES ($1, 'tarea', $2, $3) RETURNING id`,
      [instruccionId, tareaId, secretariaA],
    );
    itemId = rows[0].id;
    expect(await instruccion('avance_porcentaje')).toBe(0);
    expect(await instruccion('estado')).toBe('en_ejecucion');
  });

  it('completar la tarea NO cierra la instrucción: queda pendiente de validación', async () => {
    await setContext('secretario', secretariaA, uSecretarioA);
    await db.query(`UPDATE tareas SET estado = 'completada' WHERE id = $1`, [tareaId]);

    await setContext('gobernador', '', uGobernador);
    expect(await instruccion('avance_porcentaje')).toBe(100);
    // el trabajo está hecho, pero Gabinete todavía no validó
    expect(await instruccion('estado')).toBe('en_ejecucion');
  });

  it('pedir la validación sin evidencia se rechaza', async () => {
    await setContext('secretario', secretariaA, uSecretarioA);
    await expectReject(
      () =>
        db.query(`UPDATE instruccion_items SET estado_validacion = 'pendiente_validacion' WHERE id = $1`, [
          itemId,
        ]),
      'evidencia',
    );
  });

  it('con evidencia adjunta, el responsable sí puede pedir la validación', async () => {
    await setContext('secretario', secretariaA, uSecretarioA);
    await db.query(
      `INSERT INTO item_evidencias (item_id, tipo, nombre_archivo, mime, tamano_bytes, contenido, subido_por)
       VALUES ($1, 'informe', 'informe.pdf', 'application/pdf', 3, $2, $3)`,
      [itemId, Buffer.from('pdf'), uSecretarioA],
    );
    await db.query(`UPDATE instruccion_items SET estado_validacion = 'pendiente_validacion' WHERE id = $1`, [
      itemId,
    ]);
    const { rows } = await db.query('SELECT estado_validacion AS v FROM instruccion_items WHERE id = $1', [
      itemId,
    ]);
    expect(rows[0].v).toBe('pendiente_validacion');
  });

  it('devolver un ítem sin motivo se rechaza', async () => {
    await setContext('jefe_gabinete', '', uJefe);
    await expectReject(
      () => db.query(`UPDATE instruccion_items SET estado_validacion = 'devuelto' WHERE id = $1`, [itemId]),
      'motivo',
    );
  });

  it('cuando Gabinete valida el ítem, la instrucción pasa sola a cumplida', async () => {
    await setContext('jefe_gabinete', '', uJefe);
    await db.query(
      `UPDATE instruccion_items
       SET estado_validacion = 'validado', validado_por = $2, validado_at = now()
       WHERE id = $1`,
      [itemId, uJefe],
    );

    await setContext('gobernador', '', uGobernador);
    expect(await instruccion('avance_porcentaje')).toBe(100);
    expect(await instruccion('estado')).toBe('cumplida');
  });

  it('la bitácora registró el circuito con actor y acción', async () => {
    await setContext('gobernador', '', uGobernador);
    const { rows } = await db.query<{ accion: string }>(
      `SELECT accion FROM instruccion_bitacora WHERE instruccion_id = $1 ORDER BY created_at`,
      [instruccionId],
    );
    const acciones = rows.map((r) => r.accion);
    expect(acciones).toEqual(
      expect.arrayContaining(['emitida', 'item_agregado', 'validacion_solicitada', 'validado', 'cumplida']),
    );
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

  it('la secretaría ve su tarea y su propio ítem, pero nunca la instrucción madre', async () => {
    await setContext('secretario', secretariaA, uSecretarioA);

    // su tarea
    const tarea = await db.query('SELECT count(*)::int AS n FROM tareas WHERE id = $1', [tareaId]);
    expect(tarea.rows[0].n).toBe(1);

    // su propio vínculo (para saber que está en un Despacho y su estado de validación)
    const items = await db.query('SELECT count(*)::int AS n, estado_validacion FROM instruccion_items GROUP BY estado_validacion');
    expect(items.rows).toEqual([{ n: 1, estado_validacion: 'validado' }]);

    // pero NO la instrucción (título/objetivo confidenciales)
    const instr = await db.query('SELECT count(*)::int AS n FROM instrucciones');
    expect(instr.rows[0].n).toBe(0);
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
