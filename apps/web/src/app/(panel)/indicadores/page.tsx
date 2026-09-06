"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getIndicadoresResumen, type IndicadoresResumen } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { InstitutionalIcon, type IconName } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

const METRIC_TONES = {
  violet: "bg-violet-50 text-violet-600 ring-violet-100",
  emerald: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  red: "bg-red-50 text-red-600 ring-red-100",
  blue: "bg-blue-50 text-blue-600 ring-blue-100",
};

const ESTILO_ESTADO: Record<string, { label: string; dot: string; bar: string }> = {
  borrador: { label: "Borrador", dot: "bg-slate-400", bar: "bg-slate-400" },
  revision: { label: "En revisión", dot: "bg-amber-400", bar: "bg-amber-400" },
  aprobado: { label: "Aprobado", dot: "bg-blue-500", bar: "bg-blue-500" },
  publicado: { label: "Publicado", dot: "bg-emerald-500", bar: "bg-emerald-500" },
  pendiente: { label: "Pendiente", dot: "bg-slate-400", bar: "bg-slate-400" },
  en_progreso: { label: "En progreso", dot: "bg-amber-400", bar: "bg-amber-400" },
  completada: { label: "Completada", dot: "bg-emerald-500", bar: "bg-emerald-500" },
  cancelada: { label: "Cancelada", dot: "bg-red-400", bar: "bg-red-400" },
  planificacion: { label: "Planificación", dot: "bg-slate-400", bar: "bg-slate-400" },
  en_ejecucion: { label: "En ejecución", dot: "bg-blue-500", bar: "bg-blue-500" },
  pausado: { label: "Pausado", dot: "bg-amber-400", bar: "bg-amber-400" },
  finalizado: { label: "Finalizado", dot: "bg-emerald-500", bar: "bg-emerald-500" },
  cancelado: { label: "Cancelado", dot: "bg-red-400", bar: "bg-red-400" },
};

function MetricCard({ icon, value, label, tone }: { icon: IconName; value: string | number; label: string; tone: keyof typeof METRIC_TONES }) {
  return (
    <article className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-[0_5px_20px_rgba(15,23,42,.04)]">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${METRIC_TONES[tone]}`}>
        <InstitutionalIcon name={icon} className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xl font-black leading-none tracking-tight text-[#102a4c]">{value}</p>
        <p className="mt-1 text-[11px] font-bold text-slate-600">{label}</p>
      </div>
    </article>
  );
}

function DistribucionPanel({ icon, titulo, datos }: { icon: IconName; titulo: string; datos: { estado: string; total: number }[] }) {
  const total = datos.reduce((acc, d) => acc + d.total, 0);
  return (
    <Panel>
      <PanelTitle icon={icon} title={titulo} action={<span className="text-[10px] font-semibold text-slate-400">{total} registros</span>} />
      <div className="space-y-3 p-4">
        {datos.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-slate-400">Sin registros todavía.</p>
        ) : (
          datos.map((d) => {
            const estilo = ESTILO_ESTADO[d.estado] ?? { label: d.estado, dot: "bg-slate-400", bar: "bg-slate-400" };
            const pct = total ? Math.round((d.total / total) * 100) : 0;
            return (
              <div key={d.estado}>
                <div className="mb-1.5 flex items-center justify-between text-[10px]">
                  <span className="flex items-center gap-2 font-bold text-slate-600">
                    <span className={`h-2 w-2 rounded-full ${estilo.dot}`} /> {estilo.label}
                  </span>
                  <span className="font-black text-[#183558]">{d.total} <span className="font-medium text-slate-400">· {pct}%</span></span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full transition-all duration-700 ${estilo.bar}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

export default function IndicadoresPage() {
  const { sesion } = useSession();
  const [resumen, setResumen] = useState<IndicadoresResumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setResumen(await getIndicadoresResumen());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando los indicadores");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const tasaCumplimiento = useMemo(() => {
    if (!resumen) return 0;
    const porEstado = Object.fromEntries(resumen.tareasPorEstado.map((t) => [t.estado, t.total]));
    const completadas = porEstado.completada ?? 0;
    const relevantes = resumen.totales.tareas_total - (porEstado.cancelada ?? 0);
    return relevantes > 0 ? Math.round((completadas / relevantes) * 100) : 0;
  }, [resumen]);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0d5fc1]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0d5fc1]" /> Métricas institucionales
          </div>
          <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">Indicadores</h1>
          <p className="mt-1 text-xs text-slate-500">
            Estado del flujo de trabajo · <span className="font-bold capitalize text-[#0d5fc1]">{sesion.rol}</span>
          </p>
        </div>
        <button
          onClick={() => void cargar()}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
        >
          <InstitutionalIcon name="wifi" className="h-4 w-4" /> Actualizar
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {cargando ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      ) : resumen ? (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon="megaphone" value={resumen.totales.publicaciones_total} label="Publicaciones totales" tone="violet" />
            <MetricCard icon="check" value={`${tasaCumplimiento}%`} label="Tareas completadas" tone="emerald" />
            <MetricCard icon="shield" value={resumen.totales.tareas_vencidas} label="Tareas vencidas" tone="red" />
            <MetricCard icon="chart" value={`${resumen.totales.avance_promedio}%`} label="Avance promedio de proyectos" tone="blue" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <DistribucionPanel icon="megaphone" titulo="Publicaciones por estado" datos={resumen.publicacionesPorEstado} />
            <DistribucionPanel icon="tasks" titulo="Tareas por estado" datos={resumen.tareasPorEstado} />
            <DistribucionPanel icon="folder" titulo="Proyectos por estado" datos={resumen.proyectosPorEstado} />
          </div>
        </>
      ) : null}
    </div>
  );
}
