"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
  const { sesion } = useSession();
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
  const tituloInputRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const desde = new Date(calendar.year, calendar.month, 1);
      const hasta = new Date(calendar.year, calendar.month + 1, 0, 23, 59, 59);
      setEventos(await getEventos(desde.toISOString(), hasta.toISOString()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando la agenda");
    } finally {
      setCargando(false);
    }
  }, [calendar]);

  useEffect(() => {
    queueMicrotask(() => void cargar());
  }, [cargar]);

  useEffect(() => {
    if (!mostrarForm) return;

    const previousOverflow = document.body.style.overflow;
    const focusFrame = requestAnimationFrame(() => tituloInputRef.current?.focus());
    const cerrarConEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMostrarForm(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", cerrarConEscape);

    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", cerrarConEscape);
    };
  }, [mostrarForm]);

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
    setError(null);
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
    setError(null);
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

      if (editando) await actualizarEvento(editando.id, payload);
      else await crearEvento(payload);
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
      await eliminarEvento(id);
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
  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-[#7CC7F6]/45 bg-[#f5f9fd] px-3.5 py-2.5 text-sm font-medium text-[#02224F] outline-none transition placeholder:text-[#9DA9BB] hover:border-[#2FA1F0]/55 focus:border-[#0A70D6] focus:bg-white focus:ring-3 focus:ring-[#2FA1F0]/15";

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0A70D6]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#06E5FA] shadow-[0_0_10px_rgba(6,229,250,0.85)]" /> Agenda institucional
          </div>
          <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">Calendario de actividades</h1>
          <p className="mt-1 text-xs text-slate-500">
            Reuniones y actividades · <span className="font-bold capitalize text-[#0A70D6]">{sesion.rol}</span>
          </p>
        </div>
        <button
          onClick={abrirNuevo}
          aria-haspopup="dialog"
          aria-controls="evento-dialog"
          className="group inline-flex items-center justify-center gap-3 rounded-2xl border border-[#37F0FC]/25 bg-gradient-to-r from-[#0A70D6] to-[#0451A5] px-3.5 py-2.5 text-left text-white shadow-[0_12px_28px_rgba(10,112,214,0.24)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(10,112,214,0.3)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#2FA1F0]/30"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 transition group-hover:bg-white/15">
            <InstitutionalIcon name="plus" className="h-4 w-4" />
          </span>
          <span className="pr-1">
            <span className="block text-xs font-extrabold leading-tight">Nuevo evento</span>
            <span className="mt-0.5 block text-[9px] font-medium leading-tight text-[#E3EAEF]/80">Programar actividad</span>
          </span>
        </button>
      </div>

      {error && !mostrarForm && (
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
                        ? "border-[#0A70D6] bg-[#2FA1F0]/10 shadow-sm"
                        : esHoy
                          ? "border-blue-200 bg-[#f4f8fd]"
                          : "border-transparent hover:bg-slate-50"
                    }`}
                  >
                    <span className={`text-xs font-bold ${esSeleccionado ? "text-[#0A70D6]" : "text-slate-600"}`}>{dia}</span>
                    <div className="flex flex-wrap items-center gap-1">
                      {items.slice(0, 3).map((it) => (
                        <span key={it.id} className="h-1.5 w-1.5 rounded-full bg-[#06E5FA] shadow-[0_0_6px_rgba(6,229,250,0.7)]" />
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
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <button
            type="button"
            aria-label="Cerrar ventana de evento"
            onClick={() => setMostrarForm(false)}
            className="absolute inset-0 cursor-default bg-[#02224F]/72 backdrop-blur-[5px]"
          />

          <form
            id="evento-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evento-dialog-title"
            onSubmit={onGuardar}
            className="animate-fade-in-up relative flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.75rem] border border-[#7CC7F6]/30 bg-white shadow-[0_30px_90px_rgba(2,34,79,0.48)] sm:rounded-[1.75rem]"
          >
            <div className="h-1 shrink-0 bg-gradient-to-r from-[#06E5FA] via-[#2FA1F0] to-[#E99D19]" />

            <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#043472] via-[#0451A5] to-[#02224F] px-5 py-5 text-white sm:px-7">
              <div className="pointer-events-none absolute -right-14 -top-20 h-44 w-44 rounded-full border border-[#37F0FC]/15" />
              <div className="pointer-events-none absolute -right-3 -top-10 h-28 w-28 rounded-full border border-[#37F0FC]/10" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3.5">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#37F0FC]/30 bg-[#06E5FA]/10 text-[#37F0FC] shadow-[0_0_24px_rgba(6,229,250,0.12)]">
                    <InstitutionalIcon name="calendar" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#37F0FC]">
                      {editando ? "Actualizar agenda" : "Agenda institucional"}
                    </p>
                    <h2 id="evento-dialog-title" className="text-lg font-black tracking-tight sm:text-xl">
                      {editando ? "Editar evento" : "Programar nuevo evento"}
                    </h2>
                    <p className="mt-1 text-[11px] font-medium text-[#E3EAEF]/75">
                      Organiza la fecha, el horario y el nivel de acceso de la actividad.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMostrarForm(false)}
                  aria-label="Cerrar"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/8 text-[#E3EAEF] transition hover:border-[#37F0FC]/35 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37F0FC]/50"
                >
                  <InstitutionalIcon name="plus" className="h-4 w-4 rotate-45" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto bg-[linear-gradient(145deg,#ffffff_0%,#f4f8fd_100%)] px-5 py-5 sm:px-7 sm:py-6">
              <div className="mb-4 flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#0A70D6]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#06E5FA] shadow-[0_0_8px_rgba(6,229,250,0.8)]" />
                Detalles de la actividad
              </div>

              {error && (
                <div role="alert" className="mb-4 flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs font-semibold text-red-700">
                  <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                <label className="block text-xs font-extrabold text-[#02224F] sm:col-span-2">
                  Título <span className="text-[#0A70D6]">*</span>
                  <input
                    ref={tituloInputRef}
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                    required
                    placeholder="Ej. Reunión de coordinación interinstitucional"
                    className={fieldClass}
                  />
                </label>

                <label className="block text-xs font-extrabold text-[#02224F]">
                  Fecha <span className="text-[#0A70D6]">*</span>
                  <input
                    type="date"
                    value={seleccionado.toISOString().slice(0, 10)}
                    onChange={(e) => setSeleccionado(new Date(`${e.target.value}T00:00:00`))}
                    required
                    className={fieldClass}
                  />
                </label>

                <label className="block text-xs font-extrabold text-[#02224F]">
                  Confidencialidad
                  <select
                    value={nivel}
                    onChange={(e) => setNivel(e.target.value as NivelConfidencialidad)}
                    className={fieldClass}
                  >
                    <option value="publica">Pública</option>
                    <option value="interna">Interna</option>
                    <option value="reservada">Reservada</option>
                    <option value="confidencial">Confidencial</option>
                  </select>
                </label>

                <label className="block text-xs font-extrabold text-[#02224F]">
                  Hora de inicio <span className="text-[#0A70D6]">*</span>
                  <input
                    type="time"
                    value={horaInicio}
                    onChange={(e) => setHoraInicio(e.target.value)}
                    required
                    className={fieldClass}
                  />
                </label>

                <label className="block text-xs font-extrabold text-[#02224F]">
                  Hora de finalización <span className="text-[#0A70D6]">*</span>
                  <input
                    type="time"
                    value={horaFin}
                    onChange={(e) => setHoraFin(e.target.value)}
                    required
                    className={fieldClass}
                  />
                </label>

                <label className="block text-xs font-extrabold text-[#02224F] sm:col-span-2">
                  Lugar
                  <input
                    value={lugar}
                    onChange={(e) => setLugar(e.target.value)}
                    placeholder="Ej. Sala de gabinete, edificio central"
                    className={fieldClass}
                  />
                </label>

                <label className="block text-xs font-extrabold text-[#02224F] sm:col-span-2">
                  Descripción
                  <textarea
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    rows={3}
                    placeholder="Añade el objetivo o los puntos principales del evento..."
                    className={`${fieldClass} min-h-24 resize-y leading-relaxed`}
                  />
                </label>
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-3 border-t border-[#7CC7F6]/25 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div className="hidden items-center gap-2 text-[10px] font-medium text-[#71829a] sm:flex">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2FA1F0]/10 text-[#0A70D6]">
                  <InstitutionalIcon name="clock" className="h-3.5 w-3.5" />
                </span>
                Se añadirá al calendario institucional.
              </div>
              <div className="flex gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={() => setMostrarForm(false)}
                  className="flex-1 rounded-xl border border-[#9DA9BB]/45 bg-white px-4 py-2.5 text-xs font-extrabold text-[#52647c] transition hover:border-[#7CC7F6] hover:bg-[#f5f9fd] sm:flex-none"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#37F0FC]/25 bg-gradient-to-r from-[#0A70D6] to-[#0451A5] px-5 py-2.5 text-xs font-extrabold text-white shadow-[0_8px_20px_rgba(10,112,214,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_11px_24px_rgba(10,112,214,0.28)] disabled:cursor-wait disabled:translate-y-0 disabled:opacity-60 sm:flex-none"
                >
                  <InstitutionalIcon name={guardando ? "clock" : "check"} className="h-4 w-4" />
                  {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear evento"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
