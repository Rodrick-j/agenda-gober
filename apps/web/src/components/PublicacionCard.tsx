"use client";

import type { EstadoPublicacion, Publicacion } from "@/lib/api";
import { rangoDeRol } from "@/lib/roles";

const NIVEL_ESTILO: Record<string, string> = {
  publica: "bg-slate-100 text-slate-700",
  interna: "bg-blue-100 text-blue-700",
  reservada: "bg-amber-100 text-amber-800",
  confidencial: "bg-red-100 text-red-700",
};

const ESTADO_ESTILO: Record<string, string> = {
  borrador: "bg-slate-100 text-slate-600",
  revision: "bg-amber-100 text-amber-700",
  aprobado: "bg-sky-100 text-sky-700",
  publicado: "bg-green-100 text-green-700",
};

interface Accion {
  estado: EstadoPublicacion;
  etiqueta: string;
  rangoMinimo: number;
}

function accionesPara(estado: EstadoPublicacion): Accion[] {
  const acciones: Accion[] = [];
  if (estado === "borrador") acciones.push({ estado: "revision", etiqueta: "Pedir revisión", rangoMinimo: 1 });
  if (estado === "revision") acciones.push({ estado: "aprobado", etiqueta: "Aprobar", rangoMinimo: 2 });
  if (estado === "aprobado") acciones.push({ estado: "publicado", etiqueta: "Publicar", rangoMinimo: 3 });
  if (estado !== "borrador") acciones.push({ estado: "borrador", etiqueta: "Rechazar", rangoMinimo: 2 });
  return acciones;
}

interface Props {
  publicacion: Publicacion;
  rol: string;
  onTransicion: (id: string, estado: EstadoPublicacion) => void;
}

export function PublicacionCard({ publicacion, rol, onTransicion }: Props) {
  const miRango = rangoDeRol(rol);
  // El backend es quien realmente decide (trigger de transición de estado) —
  // esto solo evita mostrar un botón que sabemos que va a rebotar con 403.
  const acciones = accionesPara(publicacion.estado).filter((a) => miRango >= a.rangoMinimo);

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-medium text-slate-900">{publicacion.titulo}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${NIVEL_ESTILO[publicacion.nivel_confidencialidad]}`}>
          {publicacion.nivel_confidencialidad}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_ESTILO[publicacion.estado]}`}>
          {publicacion.estado}
        </span>
      </div>
      <p className="mb-3 whitespace-pre-wrap text-sm text-slate-600">{publicacion.contenido}</p>
      {acciones.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {acciones.map((a) => (
            <button
              key={a.estado}
              onClick={() => onTransicion(publicacion.id, a.estado)}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {a.etiqueta}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
