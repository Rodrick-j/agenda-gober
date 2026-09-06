import * as bcrypt from 'bcrypt';

// Coste de bcrypt para los hashes NUEVOS. 12 es el mínimo razonable en 2026
// (10 -- el valor anterior -- ya queda corto). Configurable por si el
// hardware del despliegue obliga a ajustarlo; los hashes viejos con coste
// menor siguen validando, porque bcrypt.compare lee el coste del propio hash.
const ROUNDS = Math.min(15, Math.max(10, Number(process.env.BCRYPT_ROUNDS) || 12));

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
