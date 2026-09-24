import { readFileSync } from 'node:fs';

// Convención "_FILE" (la misma que usan las imágenes oficiales de Postgres,
// MySQL, etc.): si existe JWT_SECRET_FILE, su contenido pisa a JWT_SECRET.
// Así el secreto puede venir de Docker/K8s secrets montados en /run/secrets/
// y NO queda en `environment:` (donde lo ve `docker inspect` o el listado de
// procesos). Ver docs/SECRETS.md.
const CLAVES_CON_FILE = [
  'JWT_SECRET',
  'DB_PASSWORD',
  'POSTGRES_PASSWORD',
  'APP_DB_PASSWORD',
  'SENTRY_DSN',
];

export function resolverSecretosDeArchivo(): void {
  for (const clave of CLAVES_CON_FILE) {
    const ruta = process.env[`${clave}_FILE`];
    if (!ruta) continue;
    try {
      process.env[clave] = readFileSync(ruta, 'utf8').trim();
    } catch (e) {
      throw new Error(`No se pudo leer ${clave}_FILE (${ruta}): ${(e as Error).message}`);
    }
  }
}

const EJEMPLOS = new Set(
  [
    'changeme',
    'change_me',
    'changeme_genera_uno_de_verdad',
    'changeme_dev_only',
    'changeme_dev_only_too',
    'secret',
    'jwt_secret',
    'password',
    'clave',
    'test',
    'localtest',
    'superclave',
    'supersecret',
  ].map((s) => s.toLowerCase()),
);

function motivoDebil(valor: string | undefined, minLen: number): string | null {
  if (!valor) return 'no está definido';
  const v = valor.toLowerCase();
  if (EJEMPLOS.has(v) || /^(changeme|change_me|placeholder|ejemplo)/i.test(valor)) {
    return 'es un valor de ejemplo';
  }
  if (valor.length < minLen) return `es muy corto (${valor.length} chars, mínimo ${minLen})`;
  return null;
}

// Se pasa a ConfigModule.forRoot({ validate }). JWT_SECRET débil ABORTA el
// arranque siempre; las claves de la base solo en producción. En desarrollo
// cualquier problema se advierte pero deja arrancar.
export function validarEntorno<T extends Record<string, unknown>>(env: T): T {
  resolverSecretosDeArchivo();
  const prod = (process.env.NODE_ENV ?? env.NODE_ENV) === 'production';
  const problemas: string[] = [];
  const criticos: string[] = [];

  const jwtStr = (process.env.JWT_SECRET ?? env.JWT_SECRET) as string | undefined;
  const jwt = motivoDebil(jwtStr, 32);
  if (jwt) {
    criticos.push(
      `JWT_SECRET ${jwt}. Generá uno con: bash scripts/gen-secrets.sh  (o node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")`,
    );
  }

  for (const clave of ['DB_PASSWORD', 'POSTGRES_PASSWORD', 'APP_DB_PASSWORD']) {
    const valStr = (process.env[clave] ?? env[clave]) as string | undefined;
    const m = motivoDebil(valStr, 12);
    if (valStr && m) (prod ? criticos : problemas).push(`${clave} ${m}`);
  }

  if (criticos.length || problemas.length) {
    const lista = [...criticos, ...problemas].map((p) => `  - ${p}`).join('\n');
    if (prod && criticos.length) {
      throw new Error(`Secretos inválidos (NODE_ENV=production):\n${lista}`);
    }
    if (criticos.length) {
      throw new Error(`Secretos inválidos:\n${lista}`);
    }
    // eslint-disable-next-line no-console
    console.warn(`\n⚠  Secretos flojos (en producción abortaría el arranque):\n${lista}\n`);
  }

  return env;
}
