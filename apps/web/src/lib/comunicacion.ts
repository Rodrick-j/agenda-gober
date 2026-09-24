import type { CoberturaEstado } from "./api";

export const COBERTURA_ESTADO_LABEL: Record<CoberturaEstado, string> = {
  solicitada: "solicitada",
  planificada: "planificada",
  en_produccion: "en producción",
  lista: "lista",
  publicada: "publicada",
  descartada: "descartada",
};

export const COBERTURA_ESTADO_ESTILO: Record<CoberturaEstado, string> = {
  solicitada: "bg-amber-50 text-amber-700 ring-amber-200",
  planificada: "bg-sky-50 text-sky-700 ring-sky-200",
  en_produccion: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  lista: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  publicada: "bg-slate-100 text-slate-600 ring-slate-200",
  descartada: "bg-rose-50 text-rose-700 ring-rose-200",
};

// Transiciones que ofrece la UI de UNICOM (el backend no fuerza máquina de
// estados en v1: cualquier estado es válido para un rol autorizado).
export const COBERTURA_SIGUIENTES: Record<CoberturaEstado, CoberturaEstado[]> = {
  solicitada: ["planificada", "descartada"],
  planificada: ["en_produccion", "descartada"],
  en_produccion: ["lista", "descartada"],
  lista: ["publicada", "en_produccion"],
  publicada: [],
  descartada: ["solicitada"],
};

export const TIPO_PIEZA = ["nota_prensa", "redes", "transmision", "fotografia", "grafica"] as const;

export const TIPO_PIEZA_LABEL: Record<string, string> = {
  nota_prensa: "Nota de prensa",
  redes: "Redes",
  transmision: "Transmisión",
  fotografia: "Fotografía",
  grafica: "Gráfica",
};
