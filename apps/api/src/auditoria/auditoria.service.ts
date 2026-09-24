import { Injectable, NotFoundException } from '@nestjs/common';
import { TxService } from '../context/tx.service';
import { limites, paginar } from '../common/paginacion';

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

export interface FiltrosAuditoria {
  q?: string; // texto libre: email del actor / módulo / id del registro
  modulo?: string; // csv de nombres de tabla (a.tabla)
  accion?: string; // csv de INSERT,UPDATE,DELETE
  usuarioId?: string; // uuid del responsable
  secretariaId?: string; // uuid; se compara contra datos_*->>'secretaria_id'
  desde?: string; // ISO timestamptz (límite inferior, inclusive)
  hasta?: string; // ISO timestamptz (límite superior, inclusive)
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCIONES = ['INSERT', 'UPDATE', 'DELETE'];

// El controller entrega los query params crudos; esto los normaliza antes de
// que toquen el SQL. Entrada basura -> se ignora ese filtro (mismo criterio
// que limites() en common/paginacion.ts), nunca un 500 por un uuid mal
// tipeado o una fecha inválida.
export function sanearFiltros(
  q: Record<string, string | undefined>,
): FiltrosAuditoria {
  const iso = (v?: string) =>
    v && !Number.isNaN(Date.parse(v)) ? v : undefined;
  const uuid = (v?: string) => (v && UUID_RE.test(v) ? v : undefined);
  const txt = (v?: string) => {
    const t = v?.trim();
    return t ? t.slice(0, 200) : undefined;
  };
  return {
    q: txt(q.q),
    modulo: txt(q.modulo),
    accion: txt(q.accion),
    usuarioId: uuid(q.usuarioId),
    secretariaId: uuid(q.secretariaId),
    desde: iso(q.desde),
    hasta: iso(q.hasta),
  };
}

const csv = (v?: string) =>
  v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

// Arma el WHERE compartido por listado / métricas / export. Devuelve el
// fragmento y sus params ya numerados; el llamador sigue desde
// params.length + 1 para LIMIT/OFFSET.
function construirWhere(f: FiltrosAuditoria): {
  where: string;
  params: unknown[];
} {
  const cond: string[] = [];
  const params: unknown[] = [];
  const P = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (f.q) {
    const like = P(`%${f.q}%`);
    cond.push(
      `(u.email ILIKE ${like} OR a.tabla ILIKE ${like} OR a.registro_id::text ILIKE ${like})`,
    );
  }
  const modulos = csv(f.modulo);
  if (modulos.length) cond.push(`a.tabla = ANY(${P(modulos)})`);

  const acciones = csv(f.accion).filter((a) => ACCIONES.includes(a));
  if (acciones.length) cond.push(`a.accion = ANY(${P(acciones)})`);

  if (f.usuarioId) cond.push(`a.usuario_id = ${P(f.usuarioId)}`);

  if (f.secretariaId) {
    cond.push(
      `COALESCE(a.datos_nuevos->>'secretaria_id', a.datos_anteriores->>'secretaria_id') = ${P(f.secretariaId)}`,
    );
  }
  if (f.desde) cond.push(`a.created_at >= ${P(f.desde)}::timestamptz`);
  if (f.hasta) cond.push(`a.created_at <= ${P(f.hasta)}::timestamptz`);

  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

// ---------------------------------------------------------------------------
// Diff / resumen (puros, compartidos entre listado, detalle y export)
// ---------------------------------------------------------------------------

// Nunca salen del backend: el trigger ya recorta password_hash (012) y
// contenido (007), pero si mañana un trigger nuevo se olvida, esto lo tapa
// igual en la respuesta y en el CSV. El match es por segmento (_-separado)
// para no pisar campos legítimos como secretaria_id (que contiene "secret").
const SENSIBLES =
  /(^|_)(password|passwd|hash|token|secret|secreto|salt)(_|$)|contenido/i;

type Blob = Record<string, unknown> | null;

export interface CampoCambio {
  campo: string;
  antesPresente: boolean; // false = la clave no existía en datos_anteriores
  antes: unknown;
  despuesPresente: boolean;
  despues: unknown;
  cambiado: boolean;
}

function diffCampos(antes: Blob, despues: Blob): CampoCambio[] {
  const claves = new Set<string>([
    ...Object.keys(antes ?? {}),
    ...Object.keys(despues ?? {}),
  ]);
  const out: CampoCambio[] = [];
  for (const campo of claves) {
    if (SENSIBLES.test(campo)) continue;
    const antesPresente = !!antes && campo in antes;
    const despuesPresente = !!despues && campo in despues;
    const a = antesPresente
      ? (antes as Record<string, unknown>)[campo]
      : undefined;
    const d = despuesPresente
      ? (despues as Record<string, unknown>)[campo]
      : undefined;
    out.push({
      campo,
      antesPresente,
      antes: a ?? null,
      despuesPresente,
      despues: d ?? null,
      cambiado: JSON.stringify(a ?? null) !== JSON.stringify(d ?? null),
    });
  }
  // Cambiados primero (lo que se investiga), después alfabético.
  out.sort((x, y) =>
    x.cambiado !== y.cambiado
      ? x.cambiado
        ? -1
        : 1
      : x.campo.localeCompare(y.campo),
  );
  return out;
}

const CAMPO_ETIQUETA: Record<string, string> = {
  titulo: 'título',
  nombre: 'nombre',
  estado: 'estado',
  prioridad: 'prioridad',
  fecha_inicio: 'fecha de inicio',
  fecha_fin: 'fecha de fin',
  fecha_vencimiento: 'vencimiento',
  fecha_limite: 'fecha límite',
  fecha_fin_estimada: 'fecha estimada de fin',
  avance_porcentaje: 'avance',
  nivel_confidencialidad: 'confidencialidad',
  secretaria_id: 'secretaría',
  activo: 'estado de la cuenta',
  descripcion: 'descripción',
  objetivo: 'objetivo',
  presupuesto: 'presupuesto',
  lugar: 'lugar',
  organiza_id: 'unidad organizadora',
  estado_validacion: 'validación',
};

const etiqueta = (campo: string) =>
  CAMPO_ETIQUETA[campo] ?? campo.replace(/_/g, ' ');

function nombreLegible(blob: Blob): string | null {
  if (!blob) return null;
  for (const k of [
    'titulo',
    'nombre',
    'asunto',
    'objetivo',
    'nombre_archivo',
  ]) {
    const v = blob[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

// Frase corta en español para la columna "Resumen" de la lista y del CSV.
// El detalle campo-a-campo va aparte (diffCampos).
export function resumirCambio(
  accion: string,
  antes: Blob,
  despues: Blob,
): string {
  if (accion === 'INSERT') {
    const n = nombreLegible(despues);
    return n ? `Creó «${n}»` : 'Creó el registro';
  }
  if (accion === 'DELETE') {
    const n = nombreLegible(antes);
    return n ? `Eliminó «${n}»` : 'Eliminó el registro';
  }
  const campos = diffCampos(antes, despues).filter((c) => c.cambiado);
  if (campos.length === 0) return 'Actualización sin cambios visibles';
  const nombres = campos.slice(0, 3).map((c) => etiqueta(c.campo));
  const extra = campos.length > 3 ? ` y ${campos.length - 3} más` : '';
  return `Cambió ${nombres.join(', ')}${extra}`;
}

function limpiarBlob(blob: Blob): Blob {
  if (!blob) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(blob))
    out[k] = SENSIBLES.test(k) ? '·oculto·' : v;
  return out;
}

// Anti-inyección de fórmulas en CSV (Excel/Sheets ejecutan celdas que
// arrancan con = + - @) + comillado RFC-4180.
function celdaCsv(valor: unknown): string {
  let s = valor == null ? '' : String(valor);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/["\r\n,]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

// secretarias / usuarios no tienen RLS: los JOIN de enriquecimiento traen
// todas las filas. La barrera de acceso es la política auditoria_select
// (solo gobernador/jefe_gabinete/admin); un secretario recibe 0 filas.
const JOINS = `
  LEFT JOIN usuarios u ON u.id = a.usuario_id
  LEFT JOIN secretarias sec
    ON sec.id::text = COALESCE(a.datos_nuevos->>'secretaria_id', a.datos_anteriores->>'secretaria_id')
`;

@Injectable()
export class AuditoriaService {
  constructor(private readonly tx: TxService) {}

  async findAll(f: FiltrosAuditoria, pagina?: string, porPagina?: string) {
    const lim = limites(pagina, porPagina);
    const { where, params } = construirWhere(f);
    const { rows } = await this.tx.query(
      `SELECT a.id, a.created_at, a.accion, a.tabla, a.registro_id,
              u.email AS usuario_email, u.nombre AS usuario_nombre,
              sec.id AS secretaria_id, sec.nombre AS secretaria_nombre,
              a.datos_anteriores, a.datos_nuevos,
              count(*) OVER() AS _total
       FROM auditoria a
       ${JOINS}
       ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, lim.limit, lim.offset],
    );

    const p = paginar(rows as Array<{ _total?: string | number }>, lim);
    return {
      ...p,
      datos: (p.datos as Record<string, unknown>[]).map((r) => ({
        id: Number(r.id),
        created_at: r.created_at,
        accion: r.accion,
        tabla: r.tabla,
        registro_id: r.registro_id,
        usuario_email: r.usuario_email ?? null,
        usuario_nombre: r.usuario_nombre ?? null,
        secretaria_id: r.secretaria_id ?? null,
        secretaria_nombre: r.secretaria_nombre ?? null,
        resumen: resumirCambio(
          r.accion as string,
          r.datos_anteriores as Blob,
          r.datos_nuevos as Blob,
        ),
      })),
    };
  }

  // Métricas del conjunto COMPLETO que matchea los filtros (no de la página).
  async resumen(f: FiltrosAuditoria) {
    const { where, params } = construirWhere(f);
    const { rows } = await this.tx.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE a.accion = 'INSERT')::int  AS creaciones,
              count(*) FILTER (WHERE a.accion = 'UPDATE')::int  AS actualizaciones,
              count(*) FILTER (WHERE a.accion = 'DELETE')::int  AS eliminaciones,
              count(DISTINCT a.usuario_id)::int                 AS actores
       FROM auditoria a
       ${JOINS}
       ${where}`,
      params,
    );
    return rows[0];
  }

  async obtener(id: string) {
    // a.id es bigint GENERATED: si no es dígitos, ni consultamos.
    if (!/^\d+$/.test(id))
      throw new NotFoundException('Evento de auditoría no encontrado');

    const { rows } = await this.tx.query(
      `SELECT a.id, a.created_at, a.accion, a.tabla, a.registro_id,
              a.datos_anteriores, a.datos_nuevos,
              u.email AS usuario_email, u.nombre AS usuario_nombre,
              rol.nombre AS usuario_rol_actual,
              us.nombre AS usuario_area_actual,
              sec.id AS secretaria_id, sec.nombre AS secretaria_nombre
       FROM auditoria a
       ${JOINS}
       LEFT JOIN LATERAL (
         SELECT r.nombre
         FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id
         WHERE ur.usuario_id = u.id
         ORDER BY ur.secretaria_id NULLS LAST
         LIMIT 1
       ) rol ON true
       LEFT JOIN secretarias us ON us.id = u.secretaria_id
       WHERE a.id = $1`,
      [id],
    );
    if (rows.length === 0)
      throw new NotFoundException('Evento de auditoría no encontrado');

    const r = rows[0] as Record<string, unknown>;
    const antes = r.datos_anteriores as Blob;
    const despues = r.datos_nuevos as Blob;
    return {
      id: Number(r.id),
      created_at: r.created_at,
      accion: r.accion,
      tabla: r.tabla,
      registro_id: r.registro_id,
      usuario_email: r.usuario_email ?? null,
      usuario_nombre: r.usuario_nombre ?? null,
      // Rol/área ACTUALES del responsable. El histórico ("qué rol tenía al
      // momento del evento") no se captura -- ver backlog de Auditoría.
      usuario_rol_actual: r.usuario_rol_actual ?? null,
      usuario_area_actual: r.usuario_area_actual ?? null,
      secretaria_id: r.secretaria_id ?? null,
      secretaria_nombre: r.secretaria_nombre ?? null,
      resumen: resumirCambio(r.accion as string, antes, despues),
      cambios: diffCampos(antes, despues),
      datos_anteriores: limpiarBlob(antes),
      datos_nuevos: limpiarBlob(despues),
    };
  }

  // CSV de los resultados filtrados (no solo la página). Tope duro: por
  // encima, el archivo sale truncado con una fila de aviso -- la salida
  // profesional para volúmenes grandes es acotar el rango de fechas.
  async exportarCsv(f: FiltrosAuditoria): Promise<string> {
    const TOPE = 5000;
    const { where, params } = construirWhere(f);
    const { rows } = await this.tx.query(
      `SELECT a.id, a.accion, a.tabla, a.registro_id,
              to_char(a.created_at AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_local,
              u.email AS usuario_email,
              sec.nombre AS secretaria_nombre,
              a.datos_anteriores, a.datos_nuevos
       FROM auditoria a
       ${JOINS}
       ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ${TOPE + 1}`,
      params,
    );

    const truncado = rows.length > TOPE;
    const filas = truncado ? rows.slice(0, TOPE) : rows;
    const cab = [
      'id',
      'fecha_bolivia',
      'responsable',
      'secretaria',
      'modulo',
      'accion',
      'registro_id',
      'resumen',
    ];
    const lineas = [cab.join(',')];
    for (const r of filas as Record<string, unknown>[]) {
      lineas.push(
        [
          r.id,
          r.fecha_local,
          r.usuario_email ?? '',
          r.secretaria_nombre ?? '',
          r.tabla,
          r.accion,
          r.registro_id,
          resumirCambio(
            r.accion as string,
            r.datos_anteriores as Blob,
            r.datos_nuevos as Blob,
          ),
        ]
          .map(celdaCsv)
          .join(','),
      );
    }
    if (truncado) {
      lineas.push(
        celdaCsv(
          `— Export truncado en ${TOPE} filas: acotá el rango de fechas —`,
        ),
      );
    }
    return lineas.join('\r\n');
  }
}
