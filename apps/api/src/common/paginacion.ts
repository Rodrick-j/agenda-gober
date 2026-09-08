// Contrato de paginación común a todos los listados. `count(*) OVER()` trae el
// total en la misma consulta (sin segundo round-trip). Tope duro de 100 por
// página aunque el cliente pida más: ningún listado devuelve todo.
const POR_PAGINA_DEFAULT = 20;
const POR_PAGINA_MAX = 100;

export interface Paginado<T> {
  datos: T[];
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
}

// Normaliza pagina/porPagina (vienen como string o undefined del query) y da
// el LIMIT/OFFSET para el SQL. Entrada basura -> valores por defecto.
export function limites(pagina?: unknown, porPagina?: unknown) {
  const pg = Math.max(1, Math.trunc(Number(pagina)) || 1);
  const pp = Math.min(
    POR_PAGINA_MAX,
    Math.max(1, Math.trunc(Number(porPagina)) || POR_PAGINA_DEFAULT),
  );
  return { pagina: pg, porPagina: pp, limit: pp, offset: (pg - 1) * pp };
}

// Arma el envelope a partir de las filas (que traen una columna `_total` de
// count(*) OVER()) y de los límites ya normalizados.
export function paginar<T extends { _total?: number | string }>(
  filas: T[],
  lim: { pagina: number; porPagina: number },
): Paginado<Omit<T, '_total'>> {
  const total = filas.length > 0 ? Number(filas[0]._total ?? 0) : 0;
  const datos = filas.map(({ _total, ...resto }) => resto as Omit<T, '_total'>);
  return {
    datos,
    total,
    pagina: lim.pagina,
    porPagina: lim.porPagina,
    paginas: Math.max(1, Math.ceil(total / lim.porPagina)),
  };
}
