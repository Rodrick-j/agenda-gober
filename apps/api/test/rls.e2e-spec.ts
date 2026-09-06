/**
 * Tests de las políticas Row Level Security -- el corazón de seguridad del
 * sistema. No arrancan Nest: hablan con Postgres directo como `app_user` (sin
 * superusuario, sin BYPASSRLS, igual que el backend en producción) y simulan
 * distintos usuarios con `set_config('app.current_*', ..., true)`, tal cual lo
 * hace TenantContextInterceptor en cada request.
 *
 * Todo corre dentro de UNA transacción que termina en ROLLBACK: no toca datos
 * reales, no necesita seeds y no deja residuo. Las aserciones de error usan
 * SAVEPOINT para no envenenar la transacción.
 *
 * Requiere Postgres arriba con las migraciones aplicadas y estas env vars
 * (las mismas que usa la API): DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.
 */
import { Client } from 'pg';

const cfg = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5433),
  database: process.env.DB_NAME ?? 'agenda_gober',
  user: process.env.DB_USER ?? 'app_user',
  password: process.env.DB_PASSWORD,
  // Igual que apps/api/src/database/database.module.ts: en dev el cert es
  // autofirmado, cifra pero no valida cadena.
  ssl: { rejectUnauthorized: false },
};

describe('RLS — publicaciones / auditoría / documentos', () => {
  let db: Client;

  // ids de fixtures, poblados en beforeAll
  let secretariaA: string;
  let secretariaB: string;
  let autorA: string;
  let autorB: string;
  let pubPublicaA: string;
  let pubReservadaA: string;
  let pubConfidencialA: string;
  let pubInternaB: string;

  const rand = Math.random().toString(36).slice(2, 8);

  async function setContext(rol: string, secretariaId: string) {
    await db.query(
      `SELECT set_config('app.current_rol', $1, true),
              set_config('app.current_secretaria_id', $2, true),
              set_config('app.current_user_id', $3, true)`,
      [rol, secretariaId, autorA ?? ''],
    );
  }

  async function visibleIds(): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM publicaciones');
    return rows.map((r) => r.id);
  }

  /** Corre `fn` esperando que Postgres la rechace; si pasa, falla el test. */
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

  async function insertPub(
    secretariaId: string,
    autorId: string,
    nivel: 'publica' | 'interna' | 'reservada' | 'confidencial',
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO publicaciones (secretaria_id, autor_id, titulo, contenido, nivel_confidencialidad)
       VALUES ($1, $2, $3, 'contenido de prueba', $4) RETURNING id`,
      [secretariaId, autorId, `pub ${nivel} ${rand}`, nivel],
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    db = new Client(cfg);
    await db.connect();
    await db.query('BEGIN');

    // secretarias / usuarios no tienen RLS: app_user puede insertarlos directo.
    const sa = await db.query<{ id: string }>(
      `INSERT INTO secretarias (nombre, slug) VALUES ($1, $2) RETURNING id`,
      [`RLS Test A ${rand}`, `rls-a-${rand}`],
    );
    secretariaA = sa.rows[0].id;
    const sb = await db.query<{ id: string }>(
      `INSERT INTO secretarias (nombre, slug) VALUES ($1, $2) RETURNING id`,
      [`RLS Test B ${rand}`, `rls-b-${rand}`],
    );
    secretariaB = sb.rows[0].id;

    const ua = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, secretaria_id) VALUES ($1, $2, $3) RETURNING id`,
      [`Autor A ${rand}`, `autor-a-${rand}@rls.test`, secretariaA],
    );
    autorA = ua.rows[0].id;
    const ub = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, secretaria_id) VALUES ($1, $2, $3) RETURNING id`,
      [`Autor B ${rand}`, `autor-b-${rand}@rls.test`, secretariaB],
    );
    autorB = ub.rows[0].id;

    // Publicaciones de A en los tres rangos de confidencialidad, más una de B.
    await setContext('secretario', secretariaA);
    pubPublicaA = await insertPub(secretariaA, autorA, 'publica');
    pubReservadaA = await insertPub(secretariaA, autorA, 'reservada');
    pubConfidencialA = await insertPub(secretariaA, autorA, 'confidencial');

    await setContext('secretario', secretariaB);
    pubInternaB = await insertPub(secretariaB, autorB, 'interna');
  });

  afterAll(async () => {
    if (db) {
      await db.query('ROLLBACK').catch(() => undefined);
      await db.end().catch(() => undefined);
    }
  });

  it('deniega por defecto: sin contexto de sesión no se ve ninguna fila', async () => {
    await setContext('', '');
    const { rows } = await db.query('SELECT count(*)::int AS n FROM publicaciones');
    expect(rows[0].n).toBe(0);
  });

  it('aísla por secretaría: un secretario de B no ve ninguna publicación de A', async () => {
    await setContext('secretario', secretariaB);
    const ids = await visibleIds();
    expect(ids).toContain(pubInternaB);
    expect(ids).not.toContain(pubPublicaA);
    expect(ids).not.toContain(pubReservadaA);
    expect(ids).not.toContain(pubConfidencialA);
  });

  it('rango del rol vs. nivel: un operador de A solo ve la publicación pública', async () => {
    await setContext('operador', secretariaA);
    const ids = await visibleIds();
    expect(ids).toContain(pubPublicaA);
    expect(ids).not.toContain(pubReservadaA);
    expect(ids).not.toContain(pubConfidencialA);
  });

  it('rango del rol vs. nivel: un director de A ve pública y reservada, no confidencial', async () => {
    await setContext('director', secretariaA);
    const ids = await visibleIds();
    expect(ids).toEqual(expect.arrayContaining([pubPublicaA, pubReservadaA]));
    expect(ids).not.toContain(pubConfidencialA);
  });

  it('rango del rol vs. nivel: un secretario de A ve las tres', async () => {
    await setContext('secretario', secretariaA);
    const ids = await visibleIds();
    expect(ids).toEqual(expect.arrayContaining([pubPublicaA, pubReservadaA, pubConfidencialA]));
  });

  it('rol transversal (gobernador) ve todo, incluso cruzando secretarías', async () => {
    await setContext('gobernador', '');
    const ids = await visibleIds();
    expect(ids).toEqual(
      expect.arrayContaining([pubPublicaA, pubReservadaA, pubConfidencialA, pubInternaB]),
    );
  });

  it('INSERT: un secretario de A no puede crear una publicación en la secretaría B', async () => {
    await setContext('secretario', secretariaA);
    await expectReject(() => insertPub(secretariaB, autorA, 'interna'), 'row-level security');
  });

  it('INSERT: un operador de A no puede crear una publicación reservada (rango insuficiente)', async () => {
    await setContext('operador', secretariaA);
    await expectReject(() => insertPub(secretariaA, autorA, 'reservada'), 'row-level security');
  });

  it('UPDATE: un secretario de B no afecta filas de A (RLS las filtra antes del UPDATE)', async () => {
    await setContext('secretario', secretariaB);
    const res = await db.query(
      `UPDATE publicaciones SET titulo = 'hackeado' WHERE id = $1`,
      [pubConfidencialA],
    );
    expect(res.rowCount).toBe(0);
  });

  it('máquina de estados: operador pide revisión (OK) pero no puede aprobar', async () => {
    await setContext('secretario', secretariaA);
    const nueva = await insertPub(secretariaA, autorA, 'publica');

    await setContext('operador', secretariaA);
    const r1 = await db.query(
      `UPDATE publicaciones SET estado = 'revision' WHERE id = $1`,
      [nueva],
    );
    expect(r1.rowCount).toBe(1);

    await expectReject(
      () => db.query(`UPDATE publicaciones SET estado = 'aprobado' WHERE id = $1`, [nueva]),
      'de estado no permitida',
    );

    await setContext('director', secretariaA);
    const r2 = await db.query(
      `UPDATE publicaciones SET estado = 'aprobado' WHERE id = $1`,
      [nueva],
    );
    expect(r2.rowCount).toBe(1);
  });

  it('auditoría: solo roles transversales la leen', async () => {
    await setContext('operador', secretariaA);
    const noVe = await db.query('SELECT count(*)::int AS n FROM auditoria');
    expect(noVe.rows[0].n).toBe(0);

    await setContext('admin', '');
    const ve = await db.query('SELECT count(*)::int AS n FROM auditoria');
    // beforeAll + este archivo ya generaron inserts de auditoría por trigger.
    expect(ve.rows[0].n).toBeGreaterThan(0);
  });

  it('documentos hereda la visibilidad de su publicación padre', async () => {
    await setContext('secretario', secretariaA);
    await db.query(
      `INSERT INTO documentos (publicacion_id, nombre_archivo, mime, tamano_bytes, contenido, subido_por)
       VALUES ($1, 'secreto.pdf', 'application/pdf', 3, $2, $3)`,
      [pubConfidencialA, Buffer.from('pdf'), autorA],
    );

    // El secretario (ve la confidencial) ve el adjunto.
    const siVe = await db.query(
      'SELECT count(*)::int AS n FROM documentos WHERE publicacion_id = $1',
      [pubConfidencialA],
    );
    expect(siVe.rows[0].n).toBe(1);

    // El operador de A no ve la publicación confidencial -> tampoco su adjunto.
    await setContext('operador', secretariaA);
    const noVeOp = await db.query(
      'SELECT count(*)::int AS n FROM documentos WHERE publicacion_id = $1',
      [pubConfidencialA],
    );
    expect(noVeOp.rows[0].n).toBe(0);

    // Un secretario de B tampoco.
    await setContext('secretario', secretariaB);
    const noVeB = await db.query(
      'SELECT count(*)::int AS n FROM documentos WHERE publicacion_id = $1',
      [pubConfidencialA],
    );
    expect(noVeB.rows[0].n).toBe(0);
  });
});
