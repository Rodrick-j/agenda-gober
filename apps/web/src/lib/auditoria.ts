// Etiquetas y helpers compartidos entre la lista de Auditoría y su panel de
// detalle. El backend guarda el nombre de tabla crudo (`a.tabla`); acá se
// traduce a lenguaje institucional.

export const MODULO_LABEL: Record<string, string> = {
  publicaciones: "Publicaciones",
  documentos: "Publicaciones · adjunto",
  eventos_agenda: "Agenda",
  reuniones: "Reuniones",
  reunion_actas: "Reuniones · acta",
  compromisos: "Reuniones · compromiso",
  tareas: "Tareas",
  proyectos: "Proyectos",
  instrucciones: "Despacho",
  instruccion_items: "Despacho · ítem",
  item_evidencias: "Despacho · evidencia",
  usuarios: "Usuarios",
  usuario_roles: "Usuarios · rol",
  secretarias: "Secretarías",
};

export function moduloLabel(tabla: string): string {
  return MODULO_LABEL[tabla] ?? tabla;
}

export const ACCION_LABEL: Record<string, string> = {
  INSERT: "Creación",
  UPDATE: "Actualización",
  DELETE: "Eliminación",
};

export const ACCION_ESTILO: Record<string, string> = {
  INSERT: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  UPDATE: "bg-amber-50 text-amber-700 ring-amber-200",
  DELETE: "bg-red-50 text-red-700 ring-red-200",
};

// Agrupaciones para el filtro "Módulo": una etiqueta amable -> las tablas que
// la componen. Se manda al backend como csv de tablas (?modulo=...).
export const MODULOS: { label: string; tablas: string[] }[] = [
  { label: "Publicaciones", tablas: ["publicaciones", "documentos"] },
  { label: "Agenda", tablas: ["eventos_agenda"] },
  { label: "Reuniones", tablas: ["reuniones", "reunion_actas", "compromisos"] },
  { label: "Tareas", tablas: ["tareas"] },
  { label: "Proyectos", tablas: ["proyectos"] },
  { label: "Despacho", tablas: ["instrucciones", "instruccion_items", "item_evidencias"] },
  { label: "Usuarios", tablas: ["usuarios", "usuario_roles"] },
  { label: "Secretarías", tablas: ["secretarias"] },
];

// --- Fechas -------------------------------------------------------------------
// Toda la app opera en horario de Bolivia (America/La_Paz = UTC-4 fijo, sin
// horario de verano). Los <input type="date"/"time"> dan hora local del
// navegador; acá se fuerza el offset -04:00 para que el backend recorte el
// rango en el huso correcto sin importar dónde esté el que consulta.

const TZ = "America/La_Paz";
const OFFSET = "-04:00";

function diaBolivia(base: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

export function hoyBolivia(): string {
  return diaBolivia(new Date());
}

function diaBoliviaMas(dias: number): string {
  const ref = new Date(`${hoyBolivia()}T12:00:00${OFFSET}`);
  ref.setUTCDate(ref.getUTCDate() + dias);
  return diaBolivia(ref);
}

// Combina un día (YYYY-MM-DD) y una hora opcional (HH:MM) en un ISO con el
// offset de Bolivia. `finDeDia` decide la hora por defecto cuando no se pasó.
export function aIso(dia: string, hora: string, finDeDia: boolean): string | undefined {
  if (!dia) return undefined;
  const h = hora || (finDeDia ? "23:59:59" : "00:00:00");
  const hhmmss = h.length === 5 ? `${h}:${finDeDia ? "59" : "00"}` : h;
  return `${dia}T${hhmmss}${OFFSET}`;
}

export type RangoRapido = "hoy" | "ayer" | "7d" | "30d";

export function rangoRapido(clave: RangoRapido): { desdeDia: string; hastaDia: string } {
  const hoy = hoyBolivia();
  if (clave === "hoy") return { desdeDia: hoy, hastaDia: hoy };
  if (clave === "ayer") {
    const a = diaBoliviaMas(-1);
    return { desdeDia: a, hastaDia: a };
  }
  if (clave === "7d") return { desdeDia: diaBoliviaMas(-6), hastaDia: hoy };
  return { desdeDia: diaBoliviaMas(-29), hastaDia: hoy };
}

export function fechaHoraBolivia(iso: string): string {
  return new Date(iso).toLocaleString("es-BO", {
    timeZone: TZ,
    dateStyle: "medium",
    timeStyle: "short",
  });
}
