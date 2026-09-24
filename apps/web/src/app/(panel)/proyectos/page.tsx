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
import { Panel } from "@/components/InstitutionalPanel";

const ESTADOS: (ProyectoEstado | "todos")[] = ["todos", "planificacion", "en_ejecucion", "pausado", "finalizado", "cancelado"];

const FORM_FIELD_CLASS =
  "mt-2 w-full rounded-xl border border-slate-200 bg-[#f8fafc] px-3.5 py-2.5 text-sm font-medium text-[#183558] outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#0d5fc1] focus:bg-white focus:ring-4 focus:ring-[#0d5fc1]/10";

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
    setError(null);
    setNombre("");
    setDescripcion("");
    setPresupuesto("");
    setFechaInicio("");
    setFechaFinEstimada("");
    setNivel("interna");
    setMostrarForm(true);
  }

  useEffect(() => {
    if (!mostrarForm) return;

    const bodyOverflow = document.body.style.overflow;
    const cerrarConEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !guardando) setMostrarForm(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", cerrarConEscape);
    return () => {
      document.body.style.overflow = bodyOverflow;
      window.removeEventListener("keydown", cerrarConEscape);
    };
  }, [guardando, mostrarForm]);

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
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-[#071b35]/70 px-3 py-4 backdrop-blur-[3px] sm:p-6"
          onClick={() => !guardando && setMostrarForm(false)}
        >
          <div className="flex min-h-full items-center justify-center">
            <form
              aria-describedby="nuevo-proyecto-descripcion"
              aria-labelledby="nuevo-proyecto-titulo"
              aria-modal="true"
              role="dialog"
              onClick={(e) => e.stopPropagation()}
              onSubmit={onGuardar}
              className="project-dialog-enter flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-[0_28px_80px_-18px_rgba(2,34,79,0.55)] sm:max-h-[calc(100vh-3rem)]"
            >
              <div className="relative shrink-0 overflow-hidden bg-[linear-gradient(118deg,#02224f_0%,#043472_62%,#075da8_100%)] px-5 py-5 text-white sm:px-7 sm:py-6">
                <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full border-[36px] border-white/5" />
                <div className="pointer-events-none absolute bottom-0 right-28 h-px w-44 bg-gradient-to-r from-transparent via-[#37f0fc]/70 to-transparent" />
                <div className="relative flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner shadow-white/10 backdrop-blur-sm sm:h-12 sm:w-12">
                    <InstitutionalIcon name="folder" className="h-5 w-5 text-[#37f0fc] sm:h-6 sm:w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#7cc7f6]">Gestión de proyectos</p>
                    <h2 id="nuevo-proyecto-titulo" className="text-lg font-black tracking-tight sm:text-xl">Registrar nuevo proyecto</h2>
                    <p id="nuevo-proyecto-descripcion" className="mt-1 max-w-md text-[11px] leading-relaxed text-blue-100/75 sm:text-xs">
                      Completa la información principal para iniciar su planificación y seguimiento.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMostrarForm(false)}
                    aria-label="Cerrar formulario"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-blue-100 transition hover:rotate-90 hover:border-white/30 hover:bg-white/20 hover:text-white focus:outline-none focus:ring-4 focus:ring-white/15"
                  >
                    <InstitutionalIcon name="close" className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto bg-[#f4f7fb] p-4 sm:p-6">
                {error && (
                  <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs font-semibold leading-relaxed text-red-700">
                    <InstitutionalIcon name="shield" className="mt-0.5 h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}

                <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/50 sm:p-5">
                  <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-[#0d5fc1]">
                      <InstitutionalIcon name="document" className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-xs font-extrabold text-[#183558]">Información general</h3>
                      <p className="mt-0.5 text-[10px] text-slate-400">Identifica el proyecto y define su alcance.</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label htmlFor="proyecto-nombre" className="block text-xs font-bold text-slate-700">
                      Nombre del proyecto <span className="text-[#8a1538]">*</span>
                      <input
                        id="proyecto-nombre"
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                        required
                        maxLength={160}
                        autoFocus
                        placeholder="Ej. Mejoramiento vial zona norte"
                        className={FORM_FIELD_CLASS}
                      />
                    </label>
                    <label htmlFor="proyecto-descripcion" className="block text-xs font-bold text-slate-700">
                      Descripción
                      <textarea
                        id="proyecto-descripcion"
                        value={descripcion}
                        onChange={(e) => setDescripcion(e.target.value)}
                        rows={3}
                        maxLength={1000}
                        placeholder="Resume el objetivo, alcance y resultados esperados…"
                        className={`${FORM_FIELD_CLASS} min-h-24 resize-y leading-relaxed`}
                      />
                      <span className="mt-1.5 block text-right text-[9px] font-medium text-slate-400">{descripcion.length}/1000</span>
                    </label>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/50 sm:p-5">
                  <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-[#0d5fc1]">
                      <InstitutionalIcon name="calendar" className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-xs font-extrabold text-[#183558]">Planificación y acceso</h3>
                      <p className="mt-0.5 text-[10px] text-slate-400">Establece el periodo, recursos y visibilidad.</p>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label htmlFor="proyecto-inicio" className="block text-xs font-bold text-slate-700">
                      Fecha de inicio
                      <input
                        id="proyecto-inicio"
                        type="date"
                        value={fechaInicio}
                        onChange={(e) => setFechaInicio(e.target.value)}
                        className={FORM_FIELD_CLASS}
                      />
                    </label>
                    <label htmlFor="proyecto-fin" className="block text-xs font-bold text-slate-700">
                      Finalización estimada
                      <input
                        id="proyecto-fin"
                        type="date"
                        min={fechaInicio || undefined}
                        value={fechaFinEstimada}
                        onChange={(e) => setFechaFinEstimada(e.target.value)}
                        className={FORM_FIELD_CLASS}
                      />
                    </label>
                    <label htmlFor="proyecto-presupuesto" className="block text-xs font-bold text-slate-700">
                      Presupuesto estimado
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center pt-2 text-xs font-extrabold text-slate-400">Bs</span>
                        <input
                          id="proyecto-presupuesto"
                          type="number"
                          min={0}
                          step="0.01"
                          value={presupuesto}
                          onChange={(e) => setPresupuesto(e.target.value)}
                          placeholder="250.000"
                          className={`${FORM_FIELD_CLASS} pl-10`}
                        />
                      </div>
                    </label>
                    <label htmlFor="proyecto-confidencialidad" className="block text-xs font-bold text-slate-700">
                      Nivel de confidencialidad
                      <div className="relative">
                        <InstitutionalIcon name="lock" className="pointer-events-none absolute left-3.5 top-[30px] h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <select
                          id="proyecto-confidencialidad"
                          value={nivel}
                          onChange={(e) => setNivel(e.target.value as NivelConfidencialidad)}
                          className={`${FORM_FIELD_CLASS} appearance-none pl-10 pr-10`}
                        >
                          <option value="publica">Pública</option>
                          <option value="interna">Interna</option>
                          <option value="reservada">Reservada</option>
                          <option value="confidencial">Confidencial</option>
                        </select>
                        <InstitutionalIcon name="chevronDown" className="pointer-events-none absolute right-3.5 top-[30px] h-4 w-4 -translate-y-1/2 text-slate-400" />
                      </div>
                    </label>
                  </div>
                </section>
              </div>

              <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="flex items-center gap-2 text-[10px] font-medium text-slate-400">
                  <InstitutionalIcon name="lock" className="h-3.5 w-3.5" />
                  Los datos se guardan de forma segura.
                </p>
                <div className="flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setMostrarForm(false)}
                    disabled={guardando}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-extrabold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-100 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={guardando || !nombre.trim()}
                    className="inline-flex min-w-36 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(110deg,#0d5fc1,#087bd4)] px-5 py-2.5 text-xs font-extrabold text-white shadow-lg shadow-blue-900/20 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-blue-900/25 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
                  >
                    {guardando ? (
                      <>
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                        Guardando…
                      </>
                    ) : (
                      <>
                        <InstitutionalIcon name="plus" className="h-4 w-4" />
                        Crear proyecto
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
