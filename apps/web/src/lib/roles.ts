// Espejo, solo para la UI, de rol_rango() en db/migrations/005_permisos_finos.sql.
// No es la autorización real -- eso lo decide siempre Postgres (RLS +
// trigger). Esto únicamente evita mostrar botones que el backend va a
// rechazar de todas formas.
const RANGOS: Record<string, number> = { operador: 1, director: 2, secretario: 3 };
// unicom es "sin secretaría" pero NO tiene alcance de supervisión (auditoría,
// gabinete, indicadores) -- su transversalidad es sólo para el calendario de
// Comunicación, que se gatea con rol === "unicom" explícito.
const TRANSVERSALES = ["gobernador", "jefe_gabinete", "admin"];

export function rangoDeRol(rol: string): number {
  if (TRANSVERSALES.includes(rol)) return 99;
  return RANGOS[rol] ?? 0;
}
