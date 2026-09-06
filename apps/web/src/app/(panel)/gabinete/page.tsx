"use client";

import { useCallback, useEffect, useState } from "react";
import { getGabineteResumen, type GabineteResumen, type TareaPrioridad } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { rangoDeRol } from "@/lib/roles";
import { InstitutionalIcon, type IconName } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

const PRIORIDAD_ESTILO: Record<TareaPrioridad, string> = {
  baja: "bg-slate-100 text-slate-600 ring-slate-200",
  media: "bg-blue-50 text-blue-700 ring-blue-200",
  alta: "bg-red-50 text-red-700 ring-red-200",
};

const METRIC_TONES = {
  amber: "bg-amber-50 text-amber-600 ring-amber-100",
  red: "bg-red-50 text-red-600 ring-red-100",
  blue: "bg-blue-50 text-blue-600 ring-blue-100",
  emerald: "bg-emerald-50 text-emerald-600 ring-emerald-100",
};

function MetricCard({ icon, value, label, tone }: { icon: IconName; value: number; label: string; tone: keyof typeof METRIC_TONES }) {
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

function diasVencimiento(fecha: string) {
  const dias = Math.ceil((new Date(fecha).getTime() - Date.now()) / 86_400_000);
  if (dias < 0) return { texto: `Venció hace ${Math.abs(dias)} d`, vencida: true };
  if (dias === 0) return { texto: "Vence hoy", vencida: true };
  return { texto: `Vence en ${dias} d`, vencida: false };
}

export default function GabinetePage() {
  const { sesion } = useSession();
  const esTransversal = rangoDeRol(sesion.rol) >= 99;

  const [resumen, setResumen] = useState<GabineteResumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setResumen(await getGabineteResumen());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando el panel de gabinete");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (esTransversal) void cargar();
    else setCargando(false);
  }, [cargar, esTransversal]);

  if (!esTransversal) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <InstitutionalIcon name="shield" className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            El panel de Gabinete es una vista agregada de todas las secretarías, solo para gobernador,
            jefe de gabinete o administrador. Tu rol (<span className="font-bold capitalize">{sesion.rol}</span>)
            no tiene acceso — el backend igual limita cada consulta a lo que tu rol ya puede ver.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0d5fc1]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0d5fc1]" /> Vista transversal
          </div>
          <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">Panel de Gabinete</h1>
          <p className="mt-1 text-xs text-slate-500">Estado consolidado de las secretarías activas</p>
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
            <MetricCard icon="clock" value={resumen.totales.publicaciones_revision} label="Publicaciones en revisión" tone="amber" />
            <MetricCard icon="tasks" value={resumen.totales.tareas_pendientes} label="Tareas pendientes" tone="blue" />
            <MetricCard icon="shield" value={resumen.totales.tareas_vencidas} label="Tareas vencidas" tone="red" />
            <MetricCard icon="calendar" value={resumen.totales.eventos_semana} label="Eventos esta semana" tone="emerald" />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Panel>
              <PanelTitle icon="building" title="Secretarías" action={<span className="text-[10px] font-semibold text-slate-400">{resumen.secretarias.length} activas</span>} />
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-[#f4f8fd] text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Secretaría</th>
                      <th className="px-4 py-2.5">En revisión</th>
                      <th className="px-4 py-2.5">Pendientes</th>
                      <th className="px-4 py-2.5">Vencidas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {resumen.secretarias.map((s) => (
                      <tr key={s.id} className="transition hover:bg-[#f4f8fd]">
                        <td className="px-4 py-3 text-xs font-bold text-[#183558]">{s.nombre}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{s.publicaciones_revision}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{s.tareas_pendientes}</td>
                        <td className={`px-4 py-3 text-xs font-bold ${s.tareas_vencidas > 0 ? "text-red-600" : "text-slate-400"}`}>
                          {s.tareas_vencidas}
                        </td>
                      </tr>
                    ))}
                    {resumen.secretarias.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-400">Sin secretarías activas visibles.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel>
              <PanelTitle icon="tasks" title="Tareas urgentes" action={<span className="text-[10px] font-semibold text-slate-400">{resumen.tareasUrgentes.length}</span>} />
              <div className="max-h-[380px] space-y-2 overflow-y-auto p-3">
                {resumen.tareasUrgentes.length === 0 ? (
                  <p className="py-10 text-center text-[11px] text-slate-400">Nada vencido ni por vencer en los próximos 3 días.</p>
                ) : (
                  resumen.tareasUrgentes.map((t) => {
                    const v = diasVencimiento(t.fecha_vencimiento);
                    return (
                      <div key={t.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <p className="text-xs font-bold text-[#183558]">{t.titulo}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold capitalize ring-1 ring-inset ${PRIORIDAD_ESTILO[t.prioridad]}`}>
                            {t.prioridad}
                          </span>
                        </div>
                        <p className={`text-[10px] font-bold ${v.vencida ? "text-red-600" : "text-slate-400"}`}>
                          {v.texto} · {t.secretaria_nombre ?? "Transversal"}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </Panel>
          </div>

          <Panel>
            <PanelTitle icon="calendar" title="Próximos 7 días" action={<span className="text-[10px] font-semibold text-slate-400">{resumen.proximosEventos.length} eventos</span>} />
            <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {resumen.proximosEventos.length === 0 ? (
                <p className="col-span-full py-8 text-center text-[11px] text-slate-400">Sin eventos programados esta semana.</p>
              ) : (
                resumen.proximosEventos.map((e) => (
                  <div key={e.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <p className="text-xs font-bold text-[#183558]">{e.titulo}</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {new Date(e.fecha_inicio).toLocaleString("es-BO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {e.lugar ? ` · ${e.lugar}` : ""}
                    </p>
                    <p className="mt-1 text-[10px] font-bold text-[#0d5fc1]">{e.secretaria_nombre ?? "Transversal"}</p>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
