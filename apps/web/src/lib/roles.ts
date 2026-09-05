// Espejo, solo para la UI, de rol_rango() en db/migrations/005_permisos_finos.sql.
// No es la autorización real -- eso lo decide siempre Postgres (RLS +
// trigger). Esto únicamente evita mostrar botones que el backend va a
// rechazar de todas formas.
const RANGOS: Record<string, number> = { operador: 1, director: 2, secretario: 3 };
const TRANSVERSALES = ["gobernador", "jefe_gabinete", "admin"];

export function rangoDeRol(rol: string): number {
  if (TRANSVERSALES.includes(rol)) return 99;
  return RANGOS[rol] ?? 0;
}
