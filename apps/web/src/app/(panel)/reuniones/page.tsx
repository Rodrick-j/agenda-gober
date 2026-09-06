"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  actualizarCompromiso,
  crearCompromiso,
  eliminarCompromiso,
  getActa,
  getCompromisos,
  getEvento,
  getEventos,
  guardarActa,
  type Compromiso,
  type Evento,
  type EventoDetalle,
} from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { useRealtime } from "@/lib/realtime-context";
import { rangoDeRol } from "@/lib/roles";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

function fechaCorta(fecha: string) {
  return new Date(fecha).toLocaleDateString("es-BO", { day: "numeric", month: "short", year: "numeric" });
}

export default function ReunionesPage() {
  const { sesion } = useSession();
  const { onEventoCambio, onCompromisoCambio } = useRealtime();

  const [eventos, setEventos] = useState<Evento[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);

  const [detalle, setDetalle] = useState<EventoDetalle | null>(null);
  const [acta, setActa] = useState("");
  const [actaOriginal, setActaOriginal] = useState("");
  const [guardandoActa, setGuardandoActa] = useState(false);
  const [compromisos, setCompromisos] = useState<Compromiso[]>([]);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  const [nuevaDescripcion, setNuevaDescripcion] = useState("");
  const [nuevoResponsable, setNuevoResponsable] = useState("");
  const [nuevaFechaLimite, setNuevaFechaLimite] = useState("");

  // Rango de fechas amplio (90 dias atras, 30 adelante) para cubrir tanto
  // reuniones pasadas (a las que hay que registrarles el acta) como futuras.
  const cargarLista = useCallback(async () => {
    setCargandoLista(true);
    setError(null);
    try {
      const desde = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const hasta = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const items = await getEventos(desde, hasta);
      items.sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio));
      setEventos(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando las reuniones");
    } finally {
      setCargandoLista(false);
    }
  }, []);

  useEffect(() => {
    void cargarLista();
  }, [cargarLista]);

  useEffect(
    () =>
      onEventoCambio(({ evento, id }) => {
        setEventos((prev) => {
          if (!evento) return id ? prev.filter((e) => e.id !== id) : prev;
          const idx = prev.findIndex((e) => e.id === evento.id);
          if (idx === -1) return [evento, ...prev];
          const copy = [...prev];
          copy[idx] = evento;
          return copy;
        });
      }),
    [onEventoCambio],
  );

  const cargarDetalle = useCallback(
    async (eventoId: string) => {
      setCargandoDetalle(true);
      setError(null);
      try {
        const [ev, actaData, comps] = await Promise.all([
          getEvento(eventoId),
          getActa(eventoId),
          getCompromisos(eventoId),
        ]);
        setDetalle(ev);
        setActa(actaData?.contenido ?? "");
        setActaOriginal(actaData?.contenido ?? "");
        setCompromisos(comps);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo cargar la reunión");
      } finally {
        setCargandoDetalle(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (seleccionadoId) void cargarDetalle(seleccionadoId);
  }, [seleccionadoId, cargarDetalle]);

  useEffect(
    () =>
      onCompromisoCambio(({ compromiso, id }) => {
        if (!seleccionadoId) return;
        setCompromisos((prev) => {
          if (!compromiso) return id ? prev.filter((c) => c.id !== id) : prev;
          if (compromiso.evento_id !== seleccionadoId) return prev;
          const idx = prev.findIndex((c) => c.id === compromiso.id);
          if (idx === -1) return [...prev, compromiso];
          const copy = [...prev];
          copy[idx] = compromiso;
          return copy;
        });
      }),
    [onCompromisoCambio, seleccionadoId],
  );

  const miRango = rangoDeRol(sesion.rol);
  const rangoDirector = rangoDeRol("director");
  const puedeEditarReunion = useMemo(() => {
    if (!detalle) return false;
    return miRango >= 99 || (miRango >= rangoDirector && detalle.secretaria_id === sesion.secretariaId);
  }, [detalle, miRango, rangoDirector, sesion.secretariaId]);

  const participantes = useMemo(() => {
    if (!detalle) return [];
    const lista = [...detalle.responsables];
    if (detalle.creador && !lista.some((p) => p.id === detalle.creador!.id)) lista.unshift(detalle.creador);
    return lista;
  }, [detalle]);

  async function onGuardarActa() {
    if (!seleccionadoId) return;
    setGuardandoActa(true);
    setError(null);
    try {
      await guardarActa(seleccionadoId, acta);
      setActaOriginal(acta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el acta");
    } finally {
      setGuardandoActa(false);
    }
  }

  async function onCrearCompromiso(e: FormEvent) {
    e.preventDefault();
    if (!seleccionadoId) return;
    setError(null);
    try {
      await crearCompromiso(seleccionadoId, {
        descripcion: nuevaDescripcion,
        responsableId: nuevoResponsable || undefined,
        fechaLimite: nuevaFechaLimite ? new Date(`${nuevaFechaLimite}T00:00:00`).toISOString() : undefined,
      });
      setNuevaDescripcion("");
      setNuevoResponsable("");
      setNuevaFechaLimite("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el compromiso");
    }
  }

  async function onToggleCompromiso(c: Compromiso) {
    setError(null);
    try {
      await actualizarCompromiso(c.id, { estado: c.estado === "cumplido" ? "pendiente" : "cumplido" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el compromiso");
    }
  }

  async function onEliminarCompromiso(id: string) {
    setError(null);
    try {
      await eliminarCompromiso(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el compromiso");
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4">
        <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0d5fc1]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#0d5fc1]" /> Actas y compromisos
        </div>
        <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">Reuniones</h1>
        <p className="mt-1 text-xs text-slate-500">Elegí una reunión de tu agenda para registrar su acta y sus compromisos.</p>
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <Panel className="max-h-[720px]">
          <PanelTitle icon="users" title="Tus reuniones" action={<span className="text-[10px] font-semibold text-slate-400">{eventos.length}</span>} />
          <div className="max-h-[660px] space-y-1.5 overflow-y-auto p-3">
            {cargandoLista ? (
              [0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />)
            ) : eventos.length === 0 ? (
              <p className="py-10 text-center text-[11px] text-slate-400">Sin reuniones en el rango reciente.</p>
            ) : (
              eventos.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => setSeleccionadoId(ev.id)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                    seleccionadoId === ev.id ? "border-[#0d5fc1] bg-blue-50" : "border-transparent hover:bg-slate-50"
                  }`}
                >
                  <p className="truncate text-xs font-bold text-[#183558]">{ev.titulo}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{fechaCorta(ev.fecha_inicio)}{ev.lugar ? ` · ${ev.lugar}` : ""}</p>
                </button>
              ))
            )}
          </div>
        </Panel>

        {!seleccionadoId ? (
          <Panel>
            <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <InstitutionalIcon name="users" />
              </div>
              <p className="text-xs font-bold text-slate-600">Elegí una reunión de la lista</p>
            </div>
          </Panel>
        ) : cargandoDetalle || !detalle ? (
          <div className="space-y-4">
            <div className="h-32 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        ) : (
          <div className="space-y-4">
            <Panel>
              <PanelTitle icon="document" title="Acta de la reunión" />
              <div className="p-4">
                <p className="mb-2 text-xs font-bold text-[#183558]">{detalle.titulo}</p>
                <p className="mb-3 text-[10px] text-slate-400">
                  {fechaCorta(detalle.fecha_inicio)}{detalle.lugar ? ` · ${detalle.lugar}` : ""}
                </p>
                <textarea
                  value={acta}
                  onChange={(e) => setActa(e.target.value)}
                  disabled={!puedeEditarReunion}
                  rows={5}
                  placeholder={puedeEditarReunion ? "Registrá lo tratado en la reunión…" : "Sin acta registrada todavía."}
                  className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal leading-relaxed outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                />
                {puedeEditarReunion && (
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={onGuardarActa}
                      disabled={guardandoActa || acta === actaOriginal}
                      className="rounded-xl bg-[#0d5fc1] px-4 py-2 text-xs font-bold text-white shadow-md shadow-blue-200 transition hover:bg-[#094f9f] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {guardandoActa ? "Guardando…" : "Guardar acta"}
                    </button>
                  </div>
                )}
              </div>
            </Panel>

            <Panel>
              <PanelTitle icon="tasks" title="Compromisos" action={<span className="text-[10px] font-semibold text-slate-400">{compromisos.length}</span>} />
              <div className="space-y-2 p-4">
                {compromisos.length === 0 ? (
                  <p className="py-6 text-center text-[11px] text-slate-400">Sin compromisos registrados.</p>
                ) : (
                  compromisos.map((c) => {
                    const puedeMarcar = puedeEditarReunion || c.responsable_id === sesion.userId;
                    return (
                      <div key={c.id} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                        <button
                          onClick={() => puedeMarcar && onToggleCompromiso(c)}
                          disabled={!puedeMarcar}
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                            c.estado === "cumplido" ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white"
                          } ${!puedeMarcar ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                        >
                          {c.estado === "cumplido" && <InstitutionalIcon name="check" className="h-3 w-3" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-bold ${c.estado === "cumplido" ? "text-slate-400 line-through" : "text-[#183558]"}`}>
                            {c.descripcion}
                          </p>
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            {c.responsable_nombre ?? "Sin responsable"}
                            {c.fecha_limite ? ` · vence ${fechaCorta(c.fecha_limite)}` : ""}
                          </p>
                        </div>
                        {puedeEditarReunion && (
                          <button onClick={() => onEliminarCompromiso(c.id)} className="shrink-0 text-slate-300 hover:text-red-500">
                            <InstitutionalIcon name="chevronDown" className="h-4 w-4 rotate-45" />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}

                {puedeEditarReunion && (
                  <form onSubmit={onCrearCompromiso} className="mt-3 space-y-2 rounded-xl border border-dashed border-slate-200 p-3">
                    <input
                      value={nuevaDescripcion}
                      onChange={(e) => setNuevaDescripcion(e.target.value)}
                      required
                      placeholder="Nuevo compromiso…"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={nuevoResponsable}
                        onChange={(e) => setNuevoResponsable(e.target.value)}
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-600"
                      >
                        <option value="">Sin responsable</option>
                        {participantes.map((p) => (
                          <option key={p.id} value={p.id}>{p.nombre}</option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={nuevaFechaLimite}
                        onChange={(e) => setNuevaFechaLimite(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-600"
                      />
                      <button type="submit" className="rounded-lg bg-[#0d5fc1] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#094f9f]">
                        Agregar
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
