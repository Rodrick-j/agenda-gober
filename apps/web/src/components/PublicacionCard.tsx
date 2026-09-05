"use client";

import type { EstadoPublicacion, Publicacion } from "@/lib/api";
import { rangoDeRol } from "@/lib/roles";
import { DocumentosPublicacion } from "./DocumentosPublicacion";

const NIVEL_ESTILO: Record<string, string> = {
  publica: "bg-slate-100 text-slate-600 ring-slate-200",
  interna: "bg-blue-50 text-blue-700 ring-blue-200",
  reservada: "bg-amber-50 text-amber-800 ring-amber-200",
  confidencial: "bg-red-50 text-red-700 ring-red-200",
};

const ESTADO_ESTILO: Record<string, string> = {
  borrador: "bg-slate-100 text-slate-600 ring-slate-200",
  revision: "bg-amber-50 text-amber-700 ring-amber-200",
  aprobado: "bg-sky-50 text-sky-700 ring-sky-200",
  publicado: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

interface Accion {
  estado: EstadoPublicacion;
  etiqueta: string;
  rangoMinimo: number;
  primaria?: boolean;
}

function accionesPara(estado: EstadoPublicacion): Accion[] {
  const acciones: Accion[] = [];
  if (estado === "borrador") acciones.push({ estado: "revision", etiqueta: "Pedir revisión", rangoMinimo: 1, primaria: true });
  if (estado === "revision") acciones.push({ estado: "aprobado", etiqueta: "Aprobar", rangoMinimo: 2, primaria: true });
  if (estado === "aprobado") acciones.push({ estado: "publicado", etiqueta: "Publicar", rangoMinimo: 3, primaria: true });
  if (estado !== "borrador") acciones.push({ estado: "borrador", etiqueta: "Rechazar", rangoMinimo: 2 });
  return acciones;
}

function Badge({ texto, clase }: { texto: string; clase: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${clase}`}>
      {texto}
    </span>
  );
}

interface Props {
  publicacion: Publicacion;
  rol: string;
  onTransicion: (id: string, estado: EstadoPublicacion) => void;
}

export function PublicacionCard({ publicacion, rol, onTransicion }: Props) {
  const miRango = rangoDeRol(rol);
  // El backend es quien realmente decide (trigger de transición) — esto solo
  // evita mostrar un botón que sabemos que va a rebotar con 403.
  const acciones = accionesPara(publicacion.estado).filter((a) => miRango >= a.rangoMinimo);

  return (
    <li className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_5px_24px_rgba(15,23,42,.045)] transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_14px_34px_rgba(15,23,42,.09)]">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[#840c32] via-amber-400 to-[#0d5fc1] opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="font-extrabold leading-snug text-[#183558]">{publicacion.titulo}</h3>
        <Badge texto={publicacion.estado} clase={ESTADO_ESTILO[publicacion.estado]} />
      </div>
      <div className="mb-3">
        <Badge texto={publicacion.nivel_confidencialidad} clase={NIVEL_ESTILO[publicacion.nivel_confidencialidad]} />
      </div>
      <p className="mb-4 line-clamp-5 flex-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
        {publicacion.contenido}
      </p>
      {acciones.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {acciones.map((a) => (
            <button
              key={a.estado}
              onClick={() => onTransicion(publicacion.id, a.estado)}
              className={
                a.primaria
                  ? "rounded-lg bg-[#0d5fc1] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#094f9f]"
                  : "rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-[#7d092a]"
              }
            >
              {a.etiqueta}
            </button>
          ))}
        </div>
      )}

      <DocumentosPublicacion publicacionId={publicacion.id} />
    </li>
  );
}
