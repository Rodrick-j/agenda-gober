"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getCoberturas, type Cobertura } from "@/lib/api";
import {
  COBERTURA_ESTADO_ESTILO,
  COBERTURA_ESTADO_LABEL,
} from "@/lib/comunicacion";
import { useSession } from "@/lib/session-context";
import { rangoDeRol } from "@/lib/roles";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { Panel } from "@/components/InstitutionalPanel";
import { CoberturaDetalle } from "@/components/CoberturaDetalle";

const DIAS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function claveDia(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function horaEvento(fecha: string | null) {
  if (!fecha) return "—";
  return new Intl.DateTimeFormat("es-BO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(fecha));
}

export default function ComunicacionPage() {
  const { sesion } = useSession();
  const esUnicom = sesion.rol === "unicom";
  const esTransversal = rangoDeRol(sesion.rol) >= 99;
  const habilitado = esUnicom || esTransversal;

  const [cal, setCal] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [coberturas, setCoberturas] = useState<Cobertura[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);

  const mes = `${cal.year}-${String(cal.month + 1).padStart(2, "0")}`;

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setCoberturas(await getCoberturas({ mes }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setCargando(false);
    }
  }, [mes]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (habilitado) void cargar();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [habilitado, cargar]);

  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && habilitado && void cargar();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [habilitado, cargar]);

  const porDia = useMemo(() => {
    const m = new Map<string, Cobertura[]>();
    for (const c of coberturas) {
      if (!c.evento_fecha) continue;
      const k = claveDia(new Date(c.evento_fecha));
      const arr = m.get(k) ?? [];
      arr.push(c);
      m.set(k, arr);
    }
    return m;
  }, [coberturas]);

  const resumen = useMemo(() => {
    const r = { solicitada: 0, en_curso: 0, lista: 0, visto: 0 };
    for (const c of coberturas) {
      if (c.gabinete_visto_at) r.visto += 1;
      if (c.estado === "solicitada") r.solicitada += 1;
      else if (c.estado === "planificada" || c.estado === "en_produccion") r.en_curso += 1;
      else if (c.estado === "lista") r.lista += 1;
    }
    return r;
  }, [coberturas]);

  const detalle = coberturas.find((c) => c.id === detalleId) ?? null;

  function onCambio(c: Cobertura) {
    setCoberturas((prev) => prev.map((x) => (x.id === c.id ? c : x)));
  }

  if (!habilitado) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <InstitutionalIcon name="shield" className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            El calendario de comunicación es para UNICOM y Gabinete. Tu rol
            (<span className="font-bold capitalize">{sesion.rol}</span>) puede pedir cobertura
            de sus eventos desde la Agenda.
          </p>
        </div>
      </div>
    );
  }

  const primerDia = (new Date(cal.year, cal.month, 1).getDay() + 6) % 7;
  const diasMes = new Date(cal.year, cal.month + 1, 0).getDate();
  const totalCeldas = Math.ceil((primerDia + diasMes) / 7) * 7;
  const celdas = Array.from({ length: totalCeldas }, (_, indice) => {
    const fecha = new Date(cal.year, cal.month, indice - primerDia + 1);
    return {
      fecha,
      dia: fecha.getDate(),
      esMesActual: fecha.getMonth() === cal.month,
    };
  });
  const hoy = new Date();

  function moverMes(desplazamiento: number) {
    setCal((actual) => {
      const fecha = new Date(actual.year, actual.month + desplazamiento, 1);
      return { year: fecha.getFullYear(), month: fecha.getMonth() };
    });
  }

  function volverAHoy() {
    const fecha = new Date();
    setCal({ year: fecha.getFullYear(), month: fecha.getMonth() });
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-3">
        <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#a21caf]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#a21caf]" /> Comunicación institucional
        </div>
        <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">Calendario de cobertura</h1>
        <p className="mt-1 text-xs text-slate-500">
          Eventos de todas las secretarías que pidieron apoyo de comunicación.
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { label: "Solicitadas", v: resumen.solicitada, tono: "text-amber-700", borde: "border-t-amber-500", fondo: "bg-amber-50/70" },
          { label: "En producción", v: resumen.en_curso, tono: "text-indigo-700", borde: "border-t-indigo-500", fondo: "bg-indigo-50/70" },
          { label: "Listas", v: resumen.lista, tono: "text-emerald-700", borde: "border-t-emerald-500", fondo: "bg-emerald-50/70" },
          { label: "Con visto", v: resumen.visto, tono: "text-[#0d5fc1]", borde: "border-t-[#0d5fc1]", fondo: "bg-blue-50/70" },
        ].map((k) => (
          <div key={k.label} className={`rounded-2xl border border-t-[3px] border-slate-200 ${k.borde} ${k.fondo} px-4 py-2.5 shadow-[0_5px_18px_rgba(15,23,42,.05)]`}>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">{k.label}</p>
            <p className={`mt-1 text-2xl font-black leading-none tabular-nums ${k.tono}`}>{k.v}</p>
          </div>
        ))}
      </div>

      <Panel className="border-slate-300 bg-white shadow-[0_16px_45px_rgba(15,42,76,.10)]">
        <div className="relative overflow-hidden border-b border-blue-100 bg-gradient-to-r from-[#eef6ff] via-white to-[#f3f8fd] px-4 py-3 sm:px-5">
          <div className="pointer-events-none absolute -right-12 -top-20 h-44 w-44 rounded-full border border-blue-200/50 bg-blue-100/40" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0d5fc1] to-[#0a70d6] text-white shadow-[0_8px_20px_rgba(13,95,193,.24)]">
                <InstitutionalIcon name="calendar" className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[0.17em] text-[#0d5fc1]">Vista mensual</p>
                <h2 className="text-lg font-black capitalize tracking-tight text-[#102a4c] sm:text-xl">
                  {MESES[cal.month]} <span className="text-[#0d5fc1]">{cal.year}</span>
                </h2>
                <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                  {coberturas.length} {coberturas.length === 1 ? "cobertura programada" : "coberturas programadas"} este mes
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={volverAHoy}
                className="rounded-xl border border-blue-200 bg-white px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-wider text-[#0d5fc1] shadow-sm transition hover:border-[#2fa1f0] hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-100"
              >
                Hoy
              </button>
              <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => moverMes(-1)}
                  className="flex h-9 w-10 items-center justify-center border-r border-slate-200 text-slate-600 transition hover:bg-[#0d5fc1] hover:text-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  aria-label="Mes anterior"
                >
                  <InstitutionalIcon name="chevronLeft" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moverMes(1)}
                  className="flex h-9 w-10 items-center justify-center text-slate-600 transition hover:bg-[#0d5fc1] hover:text-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                  aria-label="Mes siguiente"
                >
                  <InstitutionalIcon name="chevronRight" className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[#edf3f9] p-2.5 sm:p-3">
          {cargando ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-200">
              <div className="grid grid-cols-7 gap-px">
                {Array.from({ length: 35 }).map((_, i) => (
                  <div key={i} className="h-[76px] animate-pulse bg-white/80" />
                ))}
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_6px_22px_rgba(15,42,76,.08)]">
              <div className="min-w-0">
                <div className="grid grid-cols-7 border-b border-[#174f86] bg-gradient-to-r from-[#0a3c73] via-[#0d4f91] to-[#0a3c73] text-center">
                {DIAS.map((d) => (
                    <span key={d} className="border-r border-white/10 py-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-blue-50 last:border-r-0">{d}</span>
                ))}
                </div>
                <div className="grid grid-cols-7 gap-px bg-[#d8e2ed]">
                  {celdas.map(({ fecha, dia, esMesActual }, idx) => {
                    const items = porDia.get(claveDia(fecha)) ?? [];
                    const esHoy = esMesActual && fecha.toDateString() === hoy.toDateString();
                    const esFinDeSemana = idx % 7 >= 5;
                    return (
                      <div
                        key={claveDia(fecha)}
                        className={`relative flex h-[76px] min-w-0 flex-col gap-1 overflow-hidden p-1.5 transition-colors ${
                          !esMesActual
                            ? "bg-slate-100/95 text-slate-400"
                            : esHoy
                              ? "bg-[#eaf4ff] shadow-[inset_0_0_0_2px_#60a5fa]"
                              : esFinDeSemana
                                ? "bg-[#f5f9fd]"
                                : "bg-white"
                        }`}
                      >
                        <div className="flex min-h-7 items-center justify-between gap-1">
                          <span className={`flex h-7 min-w-7 items-center justify-center rounded-lg text-lg font-black leading-none tabular-nums ${
                            esHoy
                              ? "bg-[#0d5fc1] text-white shadow-[0_5px_12px_rgba(13,95,193,.28)]"
                              : esMesActual
                                ? "text-[#183558]"
                                : "text-slate-400"
                          }`}>
                            {dia}
                          </span>
                          {esHoy && (
                            <span className="hidden rounded-full bg-blue-100 px-1.5 py-0.5 text-[7px] font-extrabold uppercase tracking-wider text-[#0d5fc1] sm:inline-flex">Hoy</span>
                          )}
                          {!esHoy && items.length > 0 && (
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0d5fc1] px-1.5 text-[9px] font-black text-white">{items.length}</span>
                          )}
                        </div>

                        {esMesActual && items.slice(0, 1).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setDetalleId(c.id)}
                            className={`group w-full overflow-hidden rounded-md px-1.5 py-1 text-left shadow-sm ring-1 ring-inset transition hover:brightness-95 ${COBERTURA_ESTADO_ESTILO[c.estado]}`}
                            title={`${c.evento_titulo ?? "Evento"} · ${COBERTURA_ESTADO_LABEL[c.estado]}`}
                          >
                            <span className="hidden items-center gap-1 text-[7px] font-extrabold uppercase tracking-wide opacity-80 lg:flex">
                              <span className="h-1.5 w-1.5 rounded-full bg-current" />
                              {horaEvento(c.evento_fecha)}
                              {c.gabinete_visto_at && <span className="ml-auto">✓ Visto</span>}
                            </span>
                            <span className="block truncate text-[9px] font-extrabold leading-tight">
                              {c.evento_titulo ?? "Evento institucional"}
                            </span>
                          </button>
                        ))}
                        {esMesActual && items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setDetalleId(items[1].id)}
                            className="truncate text-left text-[8px] font-extrabold text-[#0d5fc1] hover:underline"
                            title={`${items.length - 1} coberturas adicionales`}
                          >
                            +{items.length - 1} más
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {!cargando && coberturas.length === 0 && (
            <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-[11px] font-semibold text-slate-500 shadow-sm">
              <InstitutionalIcon name="calendar" className="h-4 w-4 text-[#0d5fc1]" />
              Ninguna secretaría pidió cobertura este mes.
            </div>
          )}
        </div>
      </Panel>

      <CoberturaDetalle
        cobertura={detalle}
        puedePlanificar={esUnicom || esTransversal}
        puedeVistoBueno={esTransversal}
        onClose={() => setDetalleId(null)}
        onCambio={onCambio}
      />
    </div>
  );
}
