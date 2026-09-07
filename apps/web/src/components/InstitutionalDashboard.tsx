"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  actualizarEstado,
  crearPublicacion,
  getPublicaciones,
  getSecretarias,
  type EstadoPublicacion,
  type NivelConfidencialidad,
  type Publicacion,
  type Secretaria,
} from "@/lib/api";
import { logout as logoutRequest } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { useRealtime } from "@/lib/realtime-context";
import { PublicacionCard } from "@/components/PublicacionCard";
import { InstitutionalIcon, type IconName } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

const ESTADOS: (EstadoPublicacion | "todos")[] = ["todos", "borrador", "revision", "aprobado", "publicado"];
const DIAS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const ESTADO_UI: Record<EstadoPublicacion, { label: string; color: string; dot: string; bar: string }> = {
  borrador: { label: "Borrador", color: "bg-[#9DA9BB]/15 text-[#52647c]", dot: "bg-[#9DA9BB]", bar: "bg-[#9DA9BB]" },
  revision: { label: "En revisión", color: "bg-[#E99D19]/10 text-[#a76508]", dot: "bg-[#E99D19]", bar: "bg-[#E99D19]" },
  aprobado: { label: "Aprobado", color: "bg-[#2FA1F0]/10 text-[#0A70D6]", dot: "bg-[#0A70D6]", bar: "bg-[#0A70D6]" },
  publicado: { label: "Publicado", color: "bg-[#06E5FA]/10 text-[#0451A5]", dot: "bg-[#06E5FA]", bar: "bg-[#06E5FA]" },
};

const METRIC_TONES = {
  violet: "bg-[#043472]/[0.07] text-[#0451A5] ring-[#043472]/10",
  amber: "bg-[#E99D19]/10 text-[#E99D19] ring-[#E99D19]/20",
  blue: "bg-[#2FA1F0]/10 text-[#0A70D6] ring-[#2FA1F0]/20",
  emerald: "bg-[#06E5FA]/10 text-[#0451A5] ring-[#06E5FA]/20",
  rose: "bg-[#F47A2F]/10 text-[#F47A2F] ring-[#F47A2F]/20",
  cyan: "bg-[#37F0FC]/10 text-[#0A70D6] ring-[#37F0FC]/20",
};

function MetricCard({ icon, value, label, helper, tone }: { icon: IconName; value: string | number; label: string; helper: string; tone: keyof typeof METRIC_TONES }) {
  return (
    <article className="group flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[0_5px_20px_rgba(15,23,42,.04)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(15,23,42,.08)] sm:p-3.5">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${METRIC_TONES[tone]}`}>
        <InstitutionalIcon name={icon} className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <p className="text-xl font-black leading-none tracking-tight text-[#102a4c]">{value}</p>
          <span className="truncate text-[11px] font-bold text-slate-700">{label}</span>
        </div>
        <p className="mt-1 truncate text-[10px] text-slate-400">{helper}</p>
      </div>
    </article>
  );
}

function MiniCalendar({ calendar, onChange }: { calendar: { year: number; month: number } | null; onChange: (offset: number) => void }) {
  if (!calendar) return <div className="h-64 animate-pulse bg-slate-50" />;

  const now = new Date();
  const firstDay = (new Date(calendar.year, calendar.month, 1).getDay() + 6) % 7;
  const count = new Date(calendar.year, calendar.month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  while (cells.length % 7) cells.push(null);

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => onChange(-1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Mes anterior">
          <InstitutionalIcon name="chevronLeft" className="h-4 w-4" />
        </button>
        <p className="text-sm font-extrabold capitalize text-[#102a4c]">{MESES[calendar.month]} {calendar.year}</p>
        <button onClick={() => onChange(1)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Mes siguiente">
          <InstitutionalIcon name="chevronRight" className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {DIAS.map((day) => <span key={day} className="pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">{day}</span>)}
        {cells.map((day, index) => {
          const today = day === now.getDate() && calendar.month === now.getMonth() && calendar.year === now.getFullYear();
          return (
            <div key={`${day ?? "empty"}-${index}`} className="flex h-8 items-center justify-center">
              {day && (
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-semibold ${today ? "bg-[#0d5fc1] text-white shadow-md shadow-blue-200" : "text-slate-600 hover:bg-slate-50"}`}>{day}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function relativeTime(value: string, now: Date | null) {
  if (!now) return "Reciente";
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  if (minutes < 1440) return `Hace ${Math.floor(minutes / 60)} h`;
  return new Date(value).toLocaleDateString("es-BO", { day: "numeric", month: "short" });
}

export function InstitutionalDashboard() {
  const router = useRouter();
  const { sesion } = useSession();
  const { onCambio, conectado } = useRealtime();
  const [publicaciones, setPublicaciones] = useState<Publicacion[]>([]);
  const [secretarias, setSecretarias] = useState<Secretaria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<EstadoPublicacion | "todos">("todos");
  const [titulo, setTitulo] = useState("");
  const [contenido, setContenido] = useState("");
  const [nivel, setNivel] = useState<NivelConfidencialidad>("interna");
  const [creando, setCreando] = useState(false);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [ahora, setAhora] = useState<Date | null>(null);
  const [calendar, setCalendar] = useState<{ year: number; month: number } | null>(null);
  const tituloInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const current = new Date();
      setAhora(current);
      setCalendar({ year: current.getFullYear(), month: current.getMonth() });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!mostrarForm) return;

    const previousOverflow = document.body.style.overflow;
    const focusFrame = requestAnimationFrame(() => tituloInputRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMostrarForm(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mostrarForm]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [items, offices] = await Promise.all([
        getPublicaciones(),
        getSecretarias().catch(() => [] as Secretaria[]),
      ]);
      setPublicaciones(items);
      setSecretarias(offices);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logoutRequest().catch(() => undefined);
        router.replace("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "No se pudo cargar la información institucional");
    } finally {
      setCargando(false);
    }
  }, [router]);

  useEffect(() => {
    queueMicrotask(() => void cargar());
  }, [cargar]);

  useEffect(
    () => onCambio(({ publicacion, id }) => {
      setAhora(new Date());
      if (!publicacion) {
        // Borrado: hoy publicaciones no expone DELETE, pero el contrato del
        // canal lo contempla -- se limpia por las dudas.
        if (id) setPublicaciones((previous) => previous.filter((item) => item.id !== id));
        return;
      }
      setPublicaciones((previous) => {
        const index = previous.findIndex((item) => item.id === publicacion.id);
        if (index === -1) return [publicacion, ...previous];
        const copy = [...previous];
        copy[index] = publicacion;
        return copy;
      });
    }),
    [onCambio],
  );

  const stats = useMemo(() => {
    const count = (estado: EstadoPublicacion) => publicaciones.filter((item) => item.estado === estado).length;
    const aprobado = count("aprobado");
    const publicado = count("publicado");
    return {
      total: publicaciones.length,
      borrador: count("borrador"),
      revision: count("revision"),
      aprobado,
      publicado,
      secretarias: secretarias.filter((item) => item.activa).length,
      avance: publicaciones.length ? Math.round(((aprobado + publicado) / publicaciones.length) * 100) : 0,
    };
  }, [publicaciones, secretarias]);

  const recientes = useMemo(
    () => [...publicaciones].sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime()),
    [publicaciones],
  );

  const visibles = useMemo(() => {
    const query = busqueda.trim().toLowerCase();
    return publicaciones.filter((item) => {
      if (filtroEstado !== "todos" && item.estado !== filtroEstado) return false;
      return !query || item.titulo.toLowerCase().includes(query) || item.contenido.toLowerCase().includes(query);
    });
  }, [publicaciones, busqueda, filtroEstado]);

  function moveCalendar(offset: number) {
    setCalendar((current) => {
      if (!current) return current;
      const next = new Date(current.year, current.month + offset, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  async function onCrear(event: FormEvent) {
    event.preventDefault();
    setCreando(true);
    setError(null);
    try {
      const nueva = await crearPublicacion({ titulo, contenido, nivelConfidencialidad: nivel });
      setPublicaciones((previous) => previous.some((item) => item.id === nueva.id) ? previous : [nueva, ...previous]);
      setTitulo("");
      setContenido("");
      setMostrarForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la publicación");
    } finally {
      setCreando(false);
    }
  }

  async function onTransicion(id: string, estado: EstadoPublicacion) {
    setError(null);
    try {
      const updated = await actualizarEstado(id, estado);
      setPublicaciones((previous) => previous.map((item) => item.id === id ? updated : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transición no permitida");
    }
  }

  const longDate = ahora?.toLocaleDateString("es-BO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0A70D6]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#06E5FA] shadow-[0_0_8px_rgba(6,229,250,.8)]" /> Centro de gestión institucional
          </div>
          <h1 className="text-xl font-black tracking-tight text-[#02224F] sm:text-2xl">Panel de coordinación</h1>
          <p className="mt-1 text-xs capitalize text-slate-500">{longDate ?? "Cargando fecha institucional…"}</p>
        </div>
        <button
          onClick={() => {
            setError(null);
            setMostrarForm(true);
          }}
          aria-haspopup="dialog"
          aria-controls="nueva-publicacion-dialog"
          className="group inline-flex items-center justify-center gap-3 rounded-[14px] border border-[#37F0FC]/20 bg-gradient-to-r from-[#0A70D6] to-[#0451A5] py-2 pl-2 pr-4 text-left text-white shadow-[0_10px_26px_rgba(10,112,214,.24),inset_0_1px_0_rgba(255,255,255,.18)] transition-all hover:-translate-y-0.5 hover:border-[#37F0FC]/35 hover:shadow-[0_14px_32px_rgba(10,112,214,.32)] focus:outline-none focus:ring-4 focus:ring-[#06E5FA]/20"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white/12 ring-1 ring-inset ring-white/15 transition-transform group-hover:rotate-90">
            <InstitutionalIcon name="plus" className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-xs font-extrabold leading-none">Nueva publicación</span>
            <span className="mt-1 block text-[9px] font-medium leading-none text-[#E3EAEF]/70">Crear contenido institucional</span>
          </span>
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard icon="layers" value={stats.total} label="Visibles" helper="Publicaciones para tu rol" tone="violet" />
        <MetricCard icon="clock" value={stats.revision} label="Pendientes" helper="Esperan revisión" tone="amber" />
        <MetricCard icon="check" value={stats.aprobado} label="Aprobadas" helper="Listas para publicar" tone="blue" />
        <MetricCard icon="megaphone" value={stats.publicado} label="Publicadas" helper="Comunicación activa" tone="emerald" />
        <MetricCard icon="building" value={stats.secretarias || "—"} label="Secretarías" helper="Unidades activas" tone="rose" />
        <MetricCard icon="chart" value={`${stats.avance}%`} label="Avance" helper="Flujo completado" tone="cyan" />
      </div>

      {mostrarForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <button
            type="button"
            aria-label="Cerrar nueva publicación"
            className="absolute inset-0 cursor-default bg-[#02224F]/70 backdrop-blur-[5px]"
            onClick={() => setMostrarForm(false)}
          />

          <form
            id="nueva-publicacion-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nueva-publicacion-title"
            onSubmit={onCrear}
            className="relative flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.75rem] border border-[#7CC7F6]/25 bg-white shadow-[0_30px_100px_rgba(2,34,79,.45)] animate-fade-in-up sm:rounded-[1.75rem]"
          >
            <div className="relative overflow-hidden border-b border-[#37F0FC]/15 bg-gradient-to-br from-[#043472] via-[#0451A5] to-[#02224F] px-5 py-5 text-[#E3EAEF] sm:px-6">
              <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-[#06E5FA]/10 blur-3xl" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-[#06E5FA] via-[#2FA1F0] to-[#E99D19]" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#37F0FC]/20 bg-[#06E5FA]/10 text-[#37F0FC]">
                    <InstitutionalIcon name="megaphone" className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#37F0FC]">Nueva publicación</p>
                    <h2 id="nueva-publicacion-title" className="mt-1 text-lg font-black tracking-tight sm:text-xl">Crear contenido institucional</h2>
                    <p className="mt-1 max-w-md text-[11px] leading-5 text-[#9DA9BB]">Registra la información para iniciar el flujo oficial de revisión y aprobación.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMostrarForm(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#7CC7F6]/20 bg-[#02224F]/35 text-[#E3EAEF] transition hover:border-[#37F0FC]/35 hover:bg-[#0A70D6]/55 focus:outline-none focus:ring-2 focus:ring-[#06E5FA]/25"
                  aria-label="Cerrar formulario"
                >
                  <InstitutionalIcon name="plus" className="h-4 w-4 rotate-45" />
                </button>
              </div>
            </div>

            <div className="grid gap-5 overflow-y-auto p-5 sm:grid-cols-[minmax(0,1fr)_210px] sm:p-6">
              <label className="block text-xs font-bold text-[#02224F]">
                Título de la publicación
                <input ref={tituloInputRef} value={titulo} onChange={(event) => setTitulo(event.target.value)} required placeholder="Ej. Avance de obra departamental" className="mt-2 w-full rounded-xl border border-[#7CC7F6]/45 bg-[#f5f9fd] px-3.5 py-3 text-sm font-normal text-[#02224F] outline-none transition placeholder:text-[#9DA9BB] focus:border-[#0A70D6] focus:bg-white focus:ring-4 focus:ring-[#2FA1F0]/15" />
              </label>
              <label className="block text-xs font-bold text-[#02224F]">
                Confidencialidad
                <select value={nivel} onChange={(event) => setNivel(event.target.value as NivelConfidencialidad)} className="mt-2 w-full rounded-xl border border-[#7CC7F6]/45 bg-[#f5f9fd] px-3.5 py-3 text-sm font-normal text-[#02224F] outline-none transition focus:border-[#0A70D6] focus:bg-white focus:ring-4 focus:ring-[#2FA1F0]/15">
                  <option value="publica">Pública</option><option value="interna">Interna</option><option value="reservada">Reservada</option><option value="confidencial">Confidencial</option>
                </select>
              </label>
              <label className="block text-xs font-bold text-[#02224F] sm:col-span-2">
                Contenido
                <textarea value={contenido} onChange={(event) => setContenido(event.target.value)} required rows={5} placeholder="Describe el contenido institucional…" className="mt-2 w-full resize-y rounded-xl border border-[#7CC7F6]/45 bg-[#f5f9fd] px-3.5 py-3 text-sm font-normal leading-relaxed text-[#02224F] outline-none transition placeholder:text-[#9DA9BB] focus:border-[#0A70D6] focus:bg-white focus:ring-4 focus:ring-[#2FA1F0]/15" />
              </label>

              {error && <div role="alert" className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700 sm:col-span-2"><InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />{error}</div>}
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[#7CC7F6]/25 bg-[#f5f9fd] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="hidden items-center gap-2 text-[10px] text-[#52647c] sm:flex">
                <InstitutionalIcon name="shield" className="h-3.5 w-3.5 text-[#0A70D6]" /> Se guardará inicialmente como borrador.
              </p>
              <div className="flex gap-2 sm:ml-auto">
                <button type="button" onClick={() => setMostrarForm(false)} className="flex-1 rounded-xl border border-[#7CC7F6]/45 bg-white px-4 py-2.5 text-xs font-bold text-[#043472] transition hover:border-[#0A70D6]/45 hover:bg-[#eef6fd] focus:outline-none focus:ring-3 focus:ring-[#2FA1F0]/15 sm:flex-none">
                  Cancelar
                </button>
                <button type="submit" disabled={creando} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#37F0FC]/20 bg-gradient-to-r from-[#0A70D6] to-[#0451A5] px-5 py-2.5 text-xs font-extrabold text-white shadow-[0_8px_20px_rgba(10,112,214,.22)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_25px_rgba(10,112,214,.3)] focus:outline-none focus:ring-3 focus:ring-[#06E5FA]/20 disabled:cursor-wait disabled:translate-y-0 disabled:opacity-60 sm:flex-none">
                  <InstitutionalIcon name={creando ? "clock" : "check"} className="h-4 w-4" />
                  {creando ? "Guardando…" : "Crear borrador"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {error && !mostrarForm && <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700"><InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />{error}</div>}

      <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(270px,.7fr)_minmax(280px,.75fr)]">
        <Panel>
          <PanelTitle icon="calendar" title="Agenda editorial institucional" action={<span className="rounded-full bg-blue-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-blue-600">Actividad reciente</span>} />
          <div className="p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between rounded-xl bg-[#f4f8fd] px-3 py-2">
              <p className="text-xs font-bold capitalize text-[#102a4c]">{longDate ?? "Hoy"}</p>
              <div className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${conectado ? "bg-[#06E5FA]" : "bg-[#9DA9BB]"}`} /><span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Sincronizado</span></div>
            </div>
            {cargando ? (
              <div className="space-y-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-[58px] animate-pulse rounded-xl bg-slate-100" />)}</div>
            ) : recientes.length ? (
              <div className="space-y-2">
                {recientes.slice(0, 5).map((item) => (
                  <div key={item.id} className="group grid grid-cols-[50px_3px_minmax(0,1fr)] gap-3">
                    <div className="pt-3 text-right text-[10px] font-bold text-slate-500">{timeLabel(item.updated_at ?? item.created_at)}</div>
                    <div className={`my-1 rounded-full ${ESTADO_UI[item.estado].bar}`} />
                    <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-100 bg-gradient-to-r from-slate-50 to-white px-3.5 py-2.5 transition group-hover:border-blue-100 group-hover:shadow-sm">
                      <div className="min-w-0"><p className="truncate text-xs font-bold text-[#183558]">{item.titulo}</p><p className="mt-1 truncate text-[9px] capitalize text-slate-400">{item.nivel_confidencialidad} · Actualización institucional</p></div>
                      <span className={`shrink-0 rounded-md px-2 py-1 text-[9px] font-bold ${ESTADO_UI[item.estado].color}`}>{ESTADO_UI[item.estado].label}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-56 flex-col items-center justify-center text-center"><div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><InstitutionalIcon name="calendar" /></div><p className="text-xs font-bold text-slate-600">La agenda está lista</p><p className="mt-1 max-w-xs text-[10px] text-slate-400">Crea la primera publicación para iniciar la actividad institucional.</p></div>
            )}
          </div>
        </Panel>

        <Panel><MiniCalendar calendar={calendar} onChange={moveCalendar} /></Panel>

        <Panel>
          <PanelTitle icon="wifi" title="Actividad en tiempo real" action={<div className="flex items-center gap-1.5 text-[9px] font-bold text-[#F47A2F]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ED5611]" /> EN VIVO</div>} />
          <div className="divide-y divide-slate-100 px-4">
            {recientes.slice(0, 5).map((item, index) => {
              const iconColors = ["bg-[#0A70D6]", "bg-[#0451A5]", "bg-[#2FA1F0]", "bg-[#06E5FA]", "bg-[#E99D19]"];
              return (
                <div key={item.id} className="flex items-center gap-3 py-3">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white ${iconColors[index % iconColors.length]}`}><InstitutionalIcon name="megaphone" className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold text-[#183558]">{item.titulo}</p><p className="mt-0.5 truncate text-[9px] text-slate-400">Estado: {ESTADO_UI[item.estado].label}</p></div>
                  <span className="shrink-0 text-[9px] text-slate-400">{relativeTime(item.updated_at ?? item.created_at, ahora)}</span>
                </div>
              );
            })}
            {!cargando && recientes.length === 0 && <p className="py-14 text-center text-[11px] text-slate-400">Sin actividad reciente</p>}
          </div>
        </Panel>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelTitle icon="chart" title="Flujo de publicaciones" action={<span className="text-[10px] font-semibold text-slate-400">{stats.total} registros</span>} />
          <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2">
            {(Object.keys(ESTADO_UI) as EstadoPublicacion[]).map((estado) => {
              const total = stats[estado];
              const percent = stats.total ? Math.round((total / stats.total) * 100) : 0;
              return <div key={estado}><div className="mb-1.5 flex items-center justify-between text-[10px]"><span className="flex items-center gap-2 font-bold text-slate-600"><span className={`h-2 w-2 rounded-full ${ESTADO_UI[estado].dot}`} />{ESTADO_UI[estado].label}</span><span className="font-black text-[#183558]">{total} <span className="font-medium text-slate-400">· {percent}%</span></span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all duration-700 ${ESTADO_UI[estado].bar}`} style={{ width: `${percent}%` }} /></div></div>;
            })}
          </div>
        </Panel>

        <Panel>
          <PanelTitle icon="building" title="Unidades y secretarías" action={<span className="text-[10px] font-semibold text-slate-400">{secretarias.length} registradas</span>} />
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            {secretarias.slice(0, 6).map((office, index) => {
              const colors = ["text-[#0A70D6] bg-[#2FA1F0]/10", "text-[#0451A5] bg-[#7CC7F6]/15", "text-[#043472] bg-[#06E5FA]/10", "text-[#F47A2F] bg-[#F47A2F]/10", "text-[#E99D19] bg-[#E99D19]/10", "text-[#0451A5] bg-[#37F0FC]/10"];
              return <div key={office.id} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-slate-100 px-3 py-2"><div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${colors[index % colors.length]}`}><InstitutionalIcon name="building" className="h-3.5 w-3.5" /></div><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-bold text-[#183558]">{office.nombre}</p><p className="mt-0.5 text-[9px] text-slate-400">{office.publicaciones_visibles} visibles</p></div><span className={`h-1.5 w-1.5 rounded-full ${office.activa ? "bg-[#06E5FA]" : "bg-[#9DA9BB]"}`} /></div>;
            })}
            {!cargando && secretarias.length === 0 && <p className="col-span-2 py-5 text-center text-[11px] text-slate-400">El catálogo de secretarías no está disponible.</p>}
          </div>
        </Panel>
      </div>

      <section id="publicaciones" className="scroll-mt-28">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div><h2 className="text-lg font-black tracking-tight text-[#02224F]">Gestión de publicaciones</h2><p className="mt-1 text-xs text-slate-500">Contenido visible para tu rol · <span className="font-bold capitalize text-[#0A70D6]">{sesion.rol}</span></p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative block sm:w-64"><span className="sr-only">Buscar publicaciones</span><InstitutionalIcon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Buscar contenido…" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs outline-none transition focus:border-[#0A70D6] focus:ring-3 focus:ring-[#2FA1F0]/15" /></label>
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 [scrollbar-width:none]">
              {ESTADOS.map((estado) => <button key={estado} onClick={() => setFiltroEstado(estado)} className={`shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-bold capitalize transition ${filtroEstado === estado ? "bg-[#0A70D6] text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}>{estado === "revision" ? "revisión" : estado}</button>)}
            </div>
          </div>
        </div>

        {cargando ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
        ) : visibles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center"><InstitutionalIcon name="search" className="mx-auto mb-3 h-6 w-6 text-slate-300" /><p className="text-xs font-semibold text-slate-500">{publicaciones.length ? "Ninguna publicación coincide con los filtros." : "Todavía no hay publicaciones visibles para tu rol."}</p></div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibles.map((item) => <PublicacionCard key={item.id} publicacion={item} rol={sesion.rol} onTransicion={onTransicion} />)}</ul>
        )}
      </section>

      <footer className="mt-7 flex flex-col gap-2 border-t border-slate-200 py-4 text-[9px] uppercase tracking-[0.14em] text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>Gestión que transforma · Estado · Desarrollo · Gente</span><span className="font-bold text-[#043472]">Una gobernación cercana, transparente y con resultados</span></footer>
    </div>
  );
}
