/**
 * Diagnóstico manual, NO parte de `npm run test:e2e` (no matchea
 * `*.e2e-spec.ts`, se corre aparte): aísla si la entrega en el evento
 * 'disconnect' de socket.io-client que se vio intermitente durante el
 * desarrollo de este lote era un artefacto de correr cliente y servidor en
 * el MISMO proceso Node (TestingModule de Nest + socket.io-client en el
 * mismo event loop), corriendo el servidor real como un PROCESO DEL
 * SISTEMA OPERATIVO separado (node dist/main.js) y el cliente en este
 * script, en otro proceso -- más cerca de la topología real (navegador +
 * servidor son siempre procesos separados) sin llegar a un navegador real.
 *
 * Uso (mismas variables de entorno que la API, igual que el resto de la
 * suite -- no usa dotenv a propósito, para no depender de una librería que
 * no es parte de las dependencias declaradas del proyecto):
 *   cd apps/api
 *   npm run build
 *   set -a; source .env; set +a   # (o exportar DB_* y JWT_SECRET a mano)
 *   npx ts-node test/manual/diagnostico-desconexion-proceso-separado.ts
 *
 * Requiere Postgres arriba (migraciones aplicadas). Crea sus propios datos
 * de prueba y los limpia al final (usuarios se desactivan, no se borran --
 * mismo criterio que el resto de la suite).
 */
import { spawn, ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import * as path from 'node:path';
import { Client as PgClient } from 'pg';
import { io, type Socket } from 'socket.io-client';

const REPETICIONES = 20;
const PUERTO = 3901;
const DB_CFG = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5433),
  database: process.env.DB_NAME ?? 'agenda_gober',
  user: process.env.DB_USER ?? 'app_user',
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
};

function httpGet(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
  });
}

async function esperarServidorListo(url: string, intentos = 40): Promise<void> {
  for (let i = 0; i < intentos; i++) {
    try {
      const status = await httpGet(url);
      if (status === 200) return;
    } catch {
      /* aún no responde */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('El proceso hijo (dist/main.js) no respondió /health a tiempo');
}

function hashRefresh(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// JWT HS256 firmado a mano (mismo algoritmo/payload {sub,sid} que
// @nestjs/jwt usa para AuthService) -- este script corre en un proceso
// aparte del servidor, sin acceso al JwtService de Nest.
function firmarAccessToken(payload: { sub: string; sid: string }, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const cuerpo = base64url(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }),
  );
  const firma = base64url(createHmac('sha256', secret).update(`${header}.${cuerpo}`).digest());
  return `${header}.${cuerpo}.${firma}`;
}

async function main() {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('Falta JWT_SECRET en el entorno');

  console.log(`Arrancando dist/main.js como proceso separado en :${PUERTO}...`);
  const hijo: ChildProcess = spawn('node', ['dist/main.js'], {
    cwd: path.join(__dirname, '../..'),
    env: {
      ...process.env,
      PORT: String(PUERTO),
      // El nuestro es el proceso "cliente" en este diagnóstico -- no hace
      // falta CORS abierto a nada en particular para socket.io-client (no
      // corre en navegador), pero WEB_ORIGIN debe existir para que
      // main.ts no reviente.
      WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:8500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  hijo.stdout?.on('data', (d) => process.stdout.write(`[hijo] ${d}`));
  hijo.stderr?.on('data', (d) => process.stderr.write(`[hijo:err] ${d}`));

  const db = new PgClient(DB_CFG);
  await db.connect();
  const rand = Math.random().toString(36).slice(2, 8);
  const usuarioIds: string[] = [];
  let secretariaId = '';

  try {
    await esperarServidorListo(`http://127.0.0.1:${PUERTO}/health`);
    console.log('Servidor listo. Creando fixtures...');

    await db.query('BEGIN');
    const sec = await db.query<{ id: string }>(
      `INSERT INTO secretarias (nombre, slug) VALUES ($1,$2) RETURNING id`,
      [`Diag Proc ${rand}`, `diag-proc-${rand}`],
    );
    secretariaId = sec.rows[0].id;
    const u = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nombre, email, secretaria_id, activo) VALUES ($1,$2,$3,true) RETURNING id`,
      [`Diag Operador ${rand}`, `diag.operador.${rand}@rt.test`, secretariaId],
    );
    const usuarioId = u.rows[0].id;
    usuarioIds.push(usuarioId);
    await db.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, secretaria_id) SELECT $1, r.id, $2 FROM roles r WHERE r.nombre='operador'`,
      [usuarioId, secretariaId],
    );
    await db.query('COMMIT');

    const resultados: { ok: boolean; ms: number; razon: string }[] = [];

    for (let i = 0; i < REPETICIONES; i++) {
      const sesion = await db.query<{ id: string }>(
        `INSERT INTO sesiones (usuario_id, refresh_hash, expira_at) VALUES ($1, $2, now() + interval '30 days') RETURNING id`,
        [usuarioId, hashRefresh(randomBytes(16).toString('hex'))],
      );
      const sesionId = sesion.rows[0].id;
      const accessToken = firmarAccessToken({ sub: usuarioId, sid: sesionId }, jwtSecret);

      const socket: Socket = io(`http://127.0.0.1:${PUERTO}`, {
        transports: ['websocket', 'polling'],
        extraHeaders: { Cookie: `access_token=${accessToken}` },
        forceNew: true,
      });

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout connect')), 5000);
        socket.once('connect', () => {
          clearTimeout(t);
          resolve();
        });
      });

      const t0 = Date.now();
      await db.query(`UPDATE sesiones SET revocada_at = now() WHERE id = $1`, [sesionId]);

      const resultado = await new Promise<{ ok: boolean; ms: number; razon: string }>((resolve) => {
        let resuelto = false;
        const limite = setTimeout(() => {
          if (!resuelto) {
            resuelto = true;
            resolve({ ok: false, ms: Date.now() - t0, razon: 'timeout (ni evento ni socket.connected=false)' });
          }
        }, 5000);
        socket.once('disconnect', (razon: string) => {
          if (!resuelto) {
            resuelto = true;
            clearTimeout(limite);
            resolve({ ok: true, ms: Date.now() - t0, razon: `evento disconnect: ${razon}` });
          }
        });
      });
      socket.close();
      resultados.push(resultado);
      process.stdout.write(
        `  intento ${i + 1}/${REPETICIONES}: ${resultado.ok ? 'OK' : 'FALLÓ'} en ${resultado.ms}ms (${resultado.razon})\n`,
      );
    }

    const exitosos = resultados.filter((r) => r.ok);
    const tiempos = exitosos.map((r) => r.ms);
    console.log('\n=== Resultado del diagnóstico (procesos separados) ===');
    console.log(`Éxito del evento 'disconnect': ${exitosos.length}/${REPETICIONES}`);
    if (tiempos.length > 0) {
      console.log(
        `Tiempos (ms) — min: ${Math.min(...tiempos)}, max: ${Math.max(...tiempos)}, promedio: ${(
          tiempos.reduce((a, b) => a + b, 0) / tiempos.length
        ).toFixed(1)}`,
      );
    }
    console.log(
      exitosos.length === REPETICIONES
        ? 'CONCLUSIÓN: con cliente y servidor en procesos separados, el evento "disconnect" llegó de forma consistente -- refuerza que la intermitencia observada antes era específica de correr cliente+servidor en el mismo proceso Node (TestingModule), no del mecanismo de revocación en sí.'
        : 'CONCLUSIÓN: la intermitencia SE REPRODUCE también con procesos separados -- no es exclusiva del arnés de prueba en un solo proceso. Sigue pendiente aislar la causa exacta; no depender solo del evento "disconnect" para decisiones de producto (usar socket.connected/reconciliación, ya presentes en el código).',
    );
  } finally {
    // sesiones/usuario_roles/usuarios no tienen RLS (019_sesiones.sql,
    // 001_init_schema.sql) -- no hace falta contexto de rol para esto.
    await db.query(`DELETE FROM sesiones WHERE usuario_id = ANY($1::uuid[])`, [usuarioIds]).catch(() => undefined);
    await db.query(`DELETE FROM usuario_roles WHERE usuario_id = ANY($1::uuid[])`, [usuarioIds]).catch(() => undefined);
    await db.query(`UPDATE usuarios SET activo=false WHERE id = ANY($1::uuid[])`, [usuarioIds]).catch(() => undefined);
    if (secretariaId) {
      await db.query(`UPDATE secretarias SET activa=false WHERE id=$1`, [secretariaId]).catch(() => undefined);
    }
    await db.end().catch(() => undefined);
    hijo.kill();
  }
}

main().catch((err) => {
  console.error('Diagnóstico falló:', err);
  process.exitCode = 1;
});
