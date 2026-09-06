"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  actualizarProyecto,
  crearProyecto,
  eliminarProyecto,
  getProyectos,
  type CrearProyectoInput,
  type NivelConfidencialidad,
  type Proyecto,
  type ProyectoEstado,
} from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { useRealtime } from "@/lib/realtime-context";
import { rangoDeRol } from "@/lib/roles";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

const ESTADOS: (ProyectoEstado | "todos")[] = ["todos", "planificacion", "en_ejecucion", "pausado", "finalizado", "cancelado"];

const ESTADO_UI: Record<ProyectoEstado, { label: string; color: string; bar: string }> = {
  planificacion: { label: "Planificación", color: "bg-slate-100 text-slate-600", bar: "bg-slate-400" },
  en_ejecucion: { label: "En ejecución", color: "bg-blue-50 text-blue-700", bar: "bg-blue-500" },
  pausado: { label: "Pausado", color: "bg-amber-50 text-amber-700", bar: "bg-amber-400" },
  finalizado: { label: "Finalizado", color: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
  cancelado: { label: "Cancelado", color: "bg-red-50 text-red-700", bar: "bg-red-400" },
};

function formatoMoneda(valor: string | null) {
  if (!valor) return null;
  const n = Number(valor);
  return n.toLocaleString("es-BO", { style: "currency", currency: "BOB", maximumFractionDigits: 0 });
}

export default function ProyectosPage() {
  const { sesion } = useSession();
  const { onProyectoCambio } = useRealtime();

  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<ProyectoEstado | "todos">("todos");

  const [mostrarForm, setMostrarForm] = useState(false);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [presupuesto, setPresupuesto] = useState("");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFinEstimada, setFechaFinEstimada] = useState("");
  const [nivel, setNivel] = useState<NivelConfidencialidad>("interna");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setProyectos(await getProyectos());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando los proyectos");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(
    () =>
      onProyectoCambio(({ proyecto, id }) => {
        setProyectos((prev) => {
          if (!proyecto) return id ? prev.filter((p) => p.id !== id) : prev;
          const idx = prev.findIndex((p) => p.id === proyecto.id);
          if (idx === -1) return [proyecto, ...prev];
          const copy = [...prev];
          copy[idx] = proyecto;
          return copy;
        });
      }),
    [onProyectoCambio],
  );

  const visibles = useMemo(
    () => (filtro === "todos" ? proyectos : proyectos.filter((p) => p.estado === filtro)),
    [proyectos, filtro],
  );

  const miRango = rangoDeRol(sesion.rol);
  const rangoDirector = rangoDeRol("director");
  function puedeGestionar(p: Proyecto) {
    return miRango >= 99 || (miRango >= rangoDirector && p.secretaria_id === sesion.secretariaId);
  }

  function abrirNuevo() {
    setNombre("");
    setDescripcion("");
    setPresupuesto("");
    setFechaInicio("");
    setFechaFinEstimada("");
    setNivel("interna");
    setMostrarForm(true);
  }

  async function onGuardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const payload: CrearProyectoInput = {
        nombre,
        descripcion: descripcion || undefined,
        presupuesto: presupuesto ? Number(presupuesto) : undefined,
        fechaInicio: fechaInicio || undefined,
        fechaFinEstimada: fechaFinEstimada || undefined,
        nivelConfidencialidad: nivel,
      };
      await crearProyecto(payload);
      setMostrarForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el proyecto");
    } finally {
      setGuardando(false);
    }
  }

  async function onCambiarEstado(p: Proyecto, estado: ProyectoEstado) {
    setError(null);
    try {
      await actualizarProyecto(p.id, { estado });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el estado");
    }
  }

  async function onCambiarAvance(p: Proyecto, avancePorcentaje: number) {
    setError(null);
    try {
      await actualizarProyecto(p.id, { avancePorcentaje });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el avance");
    }
  }

  async function onEliminar(id: string) {
    setError(null);
    try {
      await eliminarProyecto(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el proyecto");
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0d5fc1]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0d5fc1]" /> Ejecución institucional
          </div>
          <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">Proyectos</h1>
          <p className="mt-1 text-xs text-slate-500">Obras y programas · <span className="font-bold capitalize text-[#0d5fc1]">{sesion.rol}</span></p>
        </div>
        <button
          onClick={abrirNuevo}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#890b32] to-[#6d0828] px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-rose-900/15 transition hover:-translate-y-0.5 hover:shadow-xl"
        >
          <InstitutionalIcon name="plus" className="h-4 w-4" /> Nuevo proyecto
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="mb-4 flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 [scrollbar-width:none]">
        {ESTADOS.map((estado) => (
          <button
            key={estado}
            onClick={() => setFiltro(estado)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-bold capitalize transition ${
              filtro === estado ? "bg-[#102a4c] text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
          >
            {estado === "todos" ? "Todos" : ESTADO_UI[estado].label}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-52 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <InstitutionalIcon name="folder" className="mx-auto mb-3 h-6 w-6 text-slate-300" />
          <p className="text-xs font-semibold text-slate-500">
            {proyectos.length ? "Ningún proyecto coincide con el filtro." : "Todavía no hay proyectos visibles para tu rol."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibles.map((p) => {
            const gestionable = puedeGestionar(p);
            const monto = formatoMoneda(p.presupuesto);
            return (
              <Panel key={p.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 p-4 pb-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-[#183558]">{p.nombre}</p>
                    {monto && <p className="mt-0.5 text-[10px] font-bold text-slate-400">{monto}</p>}
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-1 text-[9px] font-bold ${ESTADO_UI[p.estado].color}`}>
                    {ESTADO_UI[p.estado].label}
                  </span>
                </div>
                <div className="flex-1 p-4">
                  {p.descripcion && <p className="mb-3 text-[11px] text-slate-500">{p.descripcion}</p>}
                  <div className="mb-1 flex items-center justify-between text-[10px] font-bold">
                    <span className="text-slate-500">Avance</span>
                    <span className="text-[#183558]">{p.avance_porcentaje}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full transition-all duration-700 ${ESTADO_UI[p.estado].bar}`} style={{ width: `${p.avance_porcentaje}%` }} />
                  </div>
                  {(p.fecha_inicio || p.fecha_fin_estimada) && (
                    <p className="mt-3 text-[10px] text-slate-400">
                      {p.fecha_inicio ? new Date(p.fecha_inicio).toLocaleDateString("es-BO") : "—"}
                      {" → "}
                      {p.fecha_fin_estimada ? new Date(p.fecha_fin_estimada).toLocaleDateString("es-BO") : "—"}
                    </p>
                  )}
                </div>
                {gestionable && (
                  <div className="space-y-2 border-t border-slate-100 p-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={p.avance_porcentaje}
                      onChange={(e) => onCambiarAvance(p, Number(e.target.value))}
                      className="w-full accent-[#0d5fc1]"
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        value={p.estado}
                        onChange={(e) => onCambiarEstado(p, e.target.value as ProyectoEstado)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600"
                      >
                        {(Object.keys(ESTADO_UI) as ProyectoEstado[]).map((estado) => (
                          <option key={estado} value={estado}>{ESTADO_UI[estado].label}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => onEliminar(p.id)}
                        className="ml-auto rounded-lg border border-red-200 px-2.5 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {mostrarForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => setMostrarForm(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={onGuardar} className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-rose-50 to-white px-5 py-3.5">
              <h2 className="text-sm font-extrabold text-[#6f0b2b]">Nuevo proyecto</h2>
              <button type="button" onClick={() => setMostrarForm(false)} className="text-slate-400 hover:text-slate-700">
                <InstitutionalIcon name="chevronDown" className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <label className="block text-xs font-bold text-slate-700">
                Nombre
                <input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-bold text-slate-700">
                  Inicio
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                  />
                </label>
                <label className="block text-xs font-bold text-slate-700">
                  Fin estimado
                  <input
                    type="date"
                    value={fechaFinEstimada}
                    onChange={(e) => setFechaFinEstimada(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                  />
                </label>
              </div>
              <label className="block text-xs font-bold text-slate-700">
                Presupuesto (Bs)
                <input
                  type="number"
                  min={0}
                  value={presupuesto}
                  onChange={(e) => setPresupuesto(e.target.value)}
                  placeholder="Ej. 250000"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                />
              </label>
              <label className="block text-xs font-bold text-slate-700">
                Confidencialidad
                <select
                  value={nivel}
                  onChange={(e) => setNivel(e.target.value as NivelConfidencialidad)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                >
                  <option value="publica">Pública</option>
                  <option value="interna">Interna</option>
                  <option value="reservada">Reservada</option>
                  <option value="confidencial">Confidencial</option>
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-700">
                Descripción
                <textarea
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  rows={3}
                  className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal leading-relaxed outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
              <button type="button" onClick={() => setMostrarForm(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardando}
                className="rounded-xl bg-[#0d5fc1] px-5 py-2 text-xs font-bold text-white shadow-md shadow-blue-200 transition hover:bg-[#094f9f] disabled:cursor-wait disabled:opacity-60"
              >
                {guardando ? "Guardando…" : "Crear proyecto"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
