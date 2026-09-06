"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  actualizarTarea,
  crearTarea,
  eliminarTarea,
  getTareas,
  type CrearTareaInput,
  type NivelConfidencialidad,
  type Tarea,
  type TareaEstado,
  type TareaPrioridad,
} from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { useRealtime } from "@/lib/realtime-context";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

const COLUMNAS: { estado: TareaEstado; titulo: string; dot: string }[] = [
  { estado: "pendiente", titulo: "Pendientes", dot: "bg-slate-400" },
  { estado: "en_progreso", titulo: "En progreso", dot: "bg-amber-400" },
  { estado: "completada", titulo: "Completadas", dot: "bg-emerald-500" },
  { estado: "cancelada", titulo: "Canceladas", dot: "bg-red-400" },
];

const PRIORIDAD_ESTILO: Record<TareaPrioridad, string> = {
  baja: "bg-slate-100 text-slate-600 ring-slate-200",
  media: "bg-blue-50 text-blue-700 ring-blue-200",
  alta: "bg-red-50 text-red-700 ring-red-200",
};

const SIGUIENTE_ESTADO: Partial<Record<TareaEstado, TareaEstado>> = {
  pendiente: "en_progreso",
  en_progreso: "completada",
};

function venceEn(fecha: string | null): { texto: string; vencida: boolean } | null {
  if (!fecha) return null;
  const d = new Date(fecha);
  const dias = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (dias < 0) return { texto: `Venció hace ${Math.abs(dias)} d`, vencida: true };
  if (dias === 0) return { texto: "Vence hoy", vencida: false };
  return { texto: `Vence en ${dias} d`, vencida: false };
}

export default function TareasPage() {
  const { token } = useSession();
  const { onTareaCambio } = useRealtime();

  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [prioridad, setPrioridad] = useState<TareaPrioridad>("media");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [nivel, setNivel] = useState<NivelConfidencialidad>("interna");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setTareas(await getTareas(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando las tareas");
    } finally {
      setCargando(false);
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Mismo canal RLS-filtrado que Agenda/Publicaciones: si el backend no te
  // manda la fila (RLS la bloqueó) simplemente no llega nada acá.
  useEffect(
    () =>
      onTareaCambio(({ tarea, id }) => {
        setTareas((prev) => {
          if (!tarea) return id ? prev.filter((t) => t.id !== id) : prev;
          const idx = prev.findIndex((t) => t.id === tarea.id);
          if (idx === -1) return [tarea, ...prev];
          const copy = [...prev];
          copy[idx] = tarea;
          return copy;
        });
      }),
    [onTareaCambio],
  );

  const porColumna = useMemo(() => {
    const map = new Map<TareaEstado, Tarea[]>();
    for (const col of COLUMNAS) map.set(col.estado, []);
    for (const t of tareas) map.get(t.estado)?.push(t);
    return map;
  }, [tareas]);

  function abrirNueva() {
    setTitulo("");
    setDescripcion("");
    setPrioridad("media");
    setFechaVencimiento("");
    setNivel("interna");
    setMostrarForm(true);
  }

  async function onGuardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const payload: CrearTareaInput = {
        titulo,
        descripcion: descripcion || undefined,
        prioridad,
        fechaVencimiento: fechaVencimiento ? new Date(`${fechaVencimiento}T00:00:00`).toISOString() : undefined,
        nivelConfidencialidad: nivel,
      };
      await crearTarea(token, payload);
      setMostrarForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la tarea");
    } finally {
      setGuardando(false);
    }
  }

  // RLS + el trigger fn_validar_edicion_tarea deciden de verdad qué se puede
  // tocar (asignado sin rango director solo puede mover el estado); esto es
  // solo para que el botón exista en la tarjeta.
  async function onAvanzar(t: Tarea) {
    const siguiente = SIGUIENTE_ESTADO[t.estado];
    if (!siguiente) return;
    setError(null);
    try {
      await actualizarTarea(token, t.id, { estado: siguiente });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la tarea");
    }
  }

  async function onCancelar(t: Tarea) {
    setError(null);
    try {
      await actualizarTarea(token, t.id, { estado: "cancelada" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cancelar la tarea");
    }
  }

  async function onEliminar(id: string) {
    setError(null);
    try {
      await eliminarTarea(token, id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la tarea");
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0d5fc1]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0d5fc1]" /> Seguimiento institucional
          </div>
          <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">Tareas</h1>
          <p className="mt-1 text-xs text-slate-500">Pendientes de tu secretaría y lo que te asignaron de otras áreas.</p>
        </div>
        <button
          onClick={abrirNueva}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#890b32] to-[#6d0828] px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-rose-900/15 transition hover:-translate-y-0.5 hover:shadow-xl"
        >
          <InstitutionalIcon name="plus" className="h-4 w-4" /> Nueva tarea
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {COLUMNAS.map((col) => {
          const items = porColumna.get(col.estado) ?? [];
          return (
            <Panel key={col.estado} className="flex flex-col">
              <PanelTitle
                icon="tasks"
                title={col.titulo}
                action={<span className={`h-2 w-2 rounded-full ${col.dot}`} />}
              />
              <div className="flex-1 space-y-2 p-3">
                {cargando ? (
                  [0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />)
                ) : items.length === 0 ? (
                  <p className="py-8 text-center text-[10px] font-semibold text-slate-400">Sin tareas acá</p>
                ) : (
                  items.map((t) => {
                    const vence = venceEn(t.fecha_vencimiento);
                    const siguiente = SIGUIENTE_ESTADO[t.estado];
                    return (
                      <div key={t.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <p className="text-xs font-bold text-[#183558]">{t.titulo}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold capitalize ring-1 ring-inset ${PRIORIDAD_ESTILO[t.prioridad]}`}>
                            {t.prioridad}
                          </span>
                        </div>
                        {t.descripcion && <p className="mb-1.5 text-[10px] text-slate-500">{t.descripcion}</p>}
                        {vence && (
                          <p className={`mb-1.5 text-[10px] font-bold ${vence.vencida ? "text-red-600" : "text-slate-400"}`}>
                            {vence.texto}
                          </p>
                        )}
                        {(t.estado === "pendiente" || t.estado === "en_progreso") && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {siguiente && (
                              <button
                                onClick={() => onAvanzar(t)}
                                className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                              >
                                {siguiente === "en_progreso" ? "Iniciar" : "Marcar completada"}
                              </button>
                            )}
                            <button
                              onClick={() => onCancelar(t)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-white"
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                        {(t.estado === "completada" || t.estado === "cancelada") && (
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => onEliminar(t.id)}
                              className="rounded-lg border border-red-200 px-2.5 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50"
                            >
                              Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      {mostrarForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => setMostrarForm(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={onGuardar} className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-rose-50 to-white px-5 py-3.5">
              <h2 className="text-sm font-extrabold text-[#6f0b2b]">Nueva tarea</h2>
              <button type="button" onClick={() => setMostrarForm(false)} className="text-slate-400 hover:text-slate-700">
                <InstitutionalIcon name="chevronDown" className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <label className="block text-xs font-bold text-slate-700">
                Título
                <input
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-bold text-slate-700">
                  Prioridad
                  <select
                    value={prioridad}
                    onChange={(e) => setPrioridad(e.target.value as TareaPrioridad)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                  >
                    <option value="baja">Baja</option>
                    <option value="media">Media</option>
                    <option value="alta">Alta</option>
                  </select>
                </label>
                <label className="block text-xs font-bold text-slate-700">
                  Vencimiento
                  <input
                    type="date"
                    value={fechaVencimiento}
                    onChange={(e) => setFechaVencimiento(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                  />
                </label>
              </div>
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
                {guardando ? "Guardando…" : "Crear tarea"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
