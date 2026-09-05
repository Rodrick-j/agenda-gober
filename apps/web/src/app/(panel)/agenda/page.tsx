"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  actualizarEvento,
  crearEvento,
  eliminarEvento,
  getEventos,
  type CrearEventoInput,
  type Evento,
  type NivelConfidencialidad,
} from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { useRealtime } from "@/lib/realtime-context";
import { rangoDeRol } from "@/lib/roles";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

const DIAS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const NIVEL_ESTILO: Record<string, string> = {
  publica: "bg-slate-100 text-slate-600 ring-slate-200",
  interna: "bg-blue-50 text-blue-700 ring-blue-200",
  reservada: "bg-amber-50 text-amber-800 ring-amber-200",
  confidencial: "bg-red-50 text-red-700 ring-red-200",
};

function claveDia(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function AgendaPage() {
  const { token, sesion } = useSession();
  const { onEventoCambio } = useRealtime();

  const [calendar, setCalendar] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seleccionado, setSeleccionado] = useState<Date>(() => new Date());

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<Evento | null>(null);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [lugar, setLugar] = useState("");
  const [horaInicio, setHoraInicio] = useState("09:00");
  const [horaFin, setHoraFin] = useState("10:00");
  const [nivel, setNivel] = useState<NivelConfidencialidad>("interna");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const desde = new Date(calendar.year, calendar.month, 1);
      const hasta = new Date(calendar.year, calendar.month + 1, 0, 23, 59, 59);
      setEventos(await getEventos(token, desde.toISOString(), hasta.toISOString()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando la agenda");
    } finally {
      setCargando(false);
    }
  }, [token, calendar]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Tiempo real: mismo canal RLS-filtrado que el resto del panel. En un
  // borrado no llega la fila (ya no existe) -- solo el id, para sacarla.
  useEffect(
    () =>
      onEventoCambio(({ evento, id }) => {
        setEventos((prev) => {
          if (!evento) return id ? prev.filter((e) => e.id !== id) : prev;
          const idx = prev.findIndex((e) => e.id === evento.id);
          if (idx === -1) return [...prev, evento];
          const copy = [...prev];
          copy[idx] = evento;
          return copy;
        });
      }),
    [onEventoCambio],
  );

  const eventosPorDia = useMemo(() => {
    const map = new Map<string, Evento[]>();
    for (const ev of eventos) {
      const key = claveDia(new Date(ev.fecha_inicio));
      const lista = map.get(key) ?? [];
      lista.push(ev);
      map.set(key, lista);
    }
    for (const lista of map.values()) lista.sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
    return map;
  }, [eventos]);

  const eventosDelDia = eventosPorDia.get(claveDia(seleccionado)) ?? [];

  function moverMes(offset: number) {
    setCalendar((c) => {
      const d = new Date(c.year, c.month + offset, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function abrirNuevo() {
    setEditando(null);
    setTitulo("");
    setDescripcion("");
    setLugar("");
    setHoraInicio("09:00");
    setHoraFin("10:00");
    setNivel("interna");
    setMostrarForm(true);
  }

  function abrirEditar(ev: Evento) {
    setEditando(ev);
    setTitulo(ev.titulo);
    setDescripcion(ev.descripcion ?? "");
    setLugar(ev.lugar ?? "");
    setHoraInicio(new Date(ev.fecha_inicio).toTimeString().slice(0, 5));
    setHoraFin(new Date(ev.fecha_fin).toTimeString().slice(0, 5));
    setNivel(ev.nivel_confidencialidad);
    setSeleccionado(new Date(ev.fecha_inicio));
    setMostrarForm(true);
  }

  async function onGuardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const [hIni, mIni] = horaInicio.split(":").map(Number);
      const [hFin, mFin] = horaFin.split(":").map(Number);
      const fechaInicio = new Date(seleccionado);
      fechaInicio.setHours(hIni, mIni, 0, 0);
      const fechaFin = new Date(seleccionado);
      fechaFin.setHours(hFin, mFin, 0, 0);

      const payload: CrearEventoInput = {
        titulo,
        descripcion: descripcion || undefined,
        lugar: lugar || undefined,
        fechaInicio: fechaInicio.toISOString(),
        fechaFin: fechaFin.toISOString(),
        nivelConfidencialidad: nivel,
      };

      if (editando) await actualizarEvento(token, editando.id, payload);
      else await crearEvento(token, payload);
      setMostrarForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el evento");
    } finally {
      setGuardando(false);
    }
  }

  async function onEliminar(id: string) {
    setError(null);
    try {
      await eliminarEvento(token, id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el evento");
    }
  }

  const miRango = rangoDeRol(sesion.rol);
  const rangoDirector = rangoDeRol("director");
  // Espejo de eventos_update/delete: transversal, o tu secretaria + rango
  // director+. Solo evita mostrar un boton que el backend igual rechazaria.
  function puedeGestionar(ev: Evento) {
    return miRango >= 99 || (miRango >= rangoDirector && ev.secretaria_id === sesion.secretariaId);
  }

  const primerDiaSemana = (new Date(calendar.year, calendar.month, 1).getDay() + 6) % 7;
  const diasEnMes = new Date(calendar.year, calendar.month + 1, 0).getDate();
  const celdas: (number | null)[] = [
    ...Array(primerDiaSemana).fill(null),
    ...Array.from({ length: diasEnMes }, (_, i) => i + 1),
  ];
  while (celdas.length % 7) celdas.push(null);

  const hoy = new Date();

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0d5fc1]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0d5fc1]" /> Agenda institucional
          </div>
          <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">Calendario de actividades</h1>
          <p className="mt-1 text-xs text-slate-500">
            Reuniones y actividades · <span className="font-bold capitalize text-[#0d5fc1]">{sesion.rol}</span>
          </p>
        </div>
        <button
          onClick={abrirNuevo}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#890b32] to-[#6d0828] px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-rose-900/15 transition hover:-translate-y-0.5 hover:shadow-xl"
        >
          <InstitutionalIcon name="plus" className="h-4 w-4" /> Nuevo evento
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <Panel>
          <PanelTitle
            icon="calendar"
            title="Calendario"
            action={
              <div className="flex items-center gap-1">
                <button onClick={() => moverMes(-1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Mes anterior">
                  <InstitutionalIcon name="chevronLeft" className="h-4 w-4" />
                </button>
                <span className="min-w-28 text-center text-xs font-extrabold capitalize text-[#102a4c]">
                  {MESES[calendar.month]} {calendar.year}
                </span>
                <button onClick={() => moverMes(1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Mes siguiente">
                  <InstitutionalIcon name="chevronRight" className="h-4 w-4" />
                </button>
              </div>
            }
          />
          <div className="p-4">
            <div className="mb-2 grid grid-cols-7 text-center">
              {DIAS.map((d) => (
                <span key={d} className="pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {d}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {celdas.map((dia, idx) => {
                if (!dia) return <div key={`vacio-${idx}`} />;
                const fecha = new Date(calendar.year, calendar.month, dia);
                const items = eventosPorDia.get(claveDia(fecha)) ?? [];
                const esHoy = fecha.toDateString() === hoy.toDateString();
                const esSeleccionado = fecha.toDateString() === seleccionado.toDateString();
                return (
                  <button
                    key={claveDia(fecha)}
                    onClick={() => setSeleccionado(fecha)}
                    className={`flex h-20 flex-col items-start gap-1.5 rounded-xl border p-2 text-left transition ${
                      esSeleccionado
                        ? "border-[#0d5fc1] bg-blue-50 shadow-sm"
                        : esHoy
                          ? "border-blue-200 bg-[#f4f8fd]"
                          : "border-transparent hover:bg-slate-50"
                    }`}
                  >
                    <span className={`text-xs font-bold ${esSeleccionado ? "text-[#0d5fc1]" : "text-slate-600"}`}>{dia}</span>
                    <div className="flex flex-wrap items-center gap-1">
                      {items.slice(0, 3).map((it) => (
                        <span key={it.id} className="h-1.5 w-1.5 rounded-full bg-[#890b32]" />
                      ))}
                      {items.length > 3 && <span className="text-[9px] font-bold text-slate-400">+{items.length - 3}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelTitle
            icon="clock"
            title={seleccionado.toLocaleDateString("es-BO", { weekday: "long", day: "numeric", month: "long" })}
            action={<span className="text-[10px] font-semibold text-slate-400">{eventosDelDia.length} eventos</span>}
          />
          <div className="max-h-[520px] space-y-2 overflow-y-auto p-4">
            {cargando ? (
              [0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)
            ) : eventosDelDia.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <InstitutionalIcon name="calendar" />
                </div>
                <p className="text-xs font-bold text-slate-600">Sin eventos este día</p>
              </div>
            ) : (
              eventosDelDia.map((ev) => (
                <div key={ev.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-[#183558]">{ev.titulo}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold capitalize ring-1 ring-inset ${NIVEL_ESTILO[ev.nivel_confidencialidad]}`}>
                      {ev.nivel_confidencialidad}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {new Date(ev.fecha_inicio).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })} –{" "}
                    {new Date(ev.fecha_fin).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}
                    {ev.lugar ? ` · ${ev.lugar}` : ""}
                  </p>
                  {ev.descripcion && <p className="mt-1.5 text-[10px] text-slate-500">{ev.descripcion}</p>}
                  {puedeGestionar(ev) && (
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => abrirEditar(ev)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-white">
                        Editar
                      </button>
                      <button onClick={() => onEliminar(ev.id)} className="rounded-lg border border-red-200 px-2.5 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50">
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      {mostrarForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => setMostrarForm(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={onGuardar} className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-rose-50 to-white px-5 py-3.5">
              <h2 className="text-sm font-extrabold text-[#6f0b2b]">{editando ? "Editar evento" : "Nuevo evento"}</h2>
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
              <label className="block text-xs font-bold text-slate-700">
                Fecha
                <input
                  type="date"
                  value={seleccionado.toISOString().slice(0, 10)}
                  onChange={(e) => setSeleccionado(new Date(`${e.target.value}T00:00:00`))}
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-bold text-slate-700">
                  Hora inicio
                  <input
                    type="time"
                    value={horaInicio}
                    onChange={(e) => setHoraInicio(e.target.value)}
                    required
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                  />
                </label>
                <label className="block text-xs font-bold text-slate-700">
                  Hora fin
                  <input
                    type="time"
                    value={horaFin}
                    onChange={(e) => setHoraFin(e.target.value)}
                    required
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                  />
                </label>
              </div>
              <label className="block text-xs font-bold text-slate-700">
                Lugar
                <input
                  value={lugar}
                  onChange={(e) => setLugar(e.target.value)}
                  placeholder="Ej. Sala de gabinete"
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
                {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear evento"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
