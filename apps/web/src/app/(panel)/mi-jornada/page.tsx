"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  crearIndicacion,
  getEventos,
  type Evento,
  type IndicacionTipo,
} from "@/lib/api";
import { useRealtime } from "@/lib/realtime-context";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

const NIVEL_ESTILO: Record<string, string> = {
  publica: "bg-slate-100 text-slate-600 ring-slate-200",
  interna: "bg-blue-50 text-blue-700 ring-blue-200",
  reservada: "bg-amber-50 text-amber-800 ring-amber-200",
  confidencial: "bg-red-50 text-red-700 ring-red-200",
};

const INDICACION_TIPO_LABEL: Record<IndicacionTipo, string> = {
  reprogramar: "Reprogramar",
  cancelar: "Cancelar",
  aclaracion: "Aclaración",
  otro: "Otro",
};

function claveDia(fecha: Date) {
  return `${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}`;
}

// Solo lectura para el horario, a propósito: el Gobernador mantiene el
// modelo acordado -- indica cambios y la jefa los ejecuta. La única acción
// acá es "Pedir cambio" (evento_indicaciones, 032_evento_indicaciones.sql),
// que NO edita el evento -- registra un pedido que la jefa atiende aparte.
export default function MiJornadaPage() {
  const { onEventoCambio } = useRealtime();
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pidiendoParaId, setPidiendoParaId] = useState<string | null>(null);
  const [tipoIndicacion, setTipoIndicacion] = useState<IndicacionTipo>("reprogramar");
  const [textoIndicacion, setTextoIndicacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviadoParaId, setEnviadoParaId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const desde = new Date();
      desde.setHours(0, 0, 0, 0);
      const hasta = new Date(desde);
      hasta.setDate(hasta.getDate() + 60);
      const evs = await getEventos(desde.toISOString(), hasta.toISOString(), {
        miParticipacion: true,
      });
      // "horario confirmado actual" -- tentativo/solicitud/cancelado/
      // realizado/no_realizado quedan fuera de esta vista.
      setEventos(evs.filter((e) => e.estado === "confirmado"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando tu jornada");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void cargar());
  }, [cargar]);

  // La condición real de "me toca a mí" (evento_responsables) no viaja en
  // el payload de tiempo real -- ante cualquier cambio, se vuelve a pedir
  // la lista filtrada al backend en vez de intentar reconstruirla a mano.
  useEffect(
    () =>
      onEventoCambio(() => {
        void cargar();
      }),
    [onEventoCambio, cargar],
  );

  const porDia = useMemo(() => {
    const map = new Map<string, Evento[]>();
    for (const ev of eventos) {
      const key = claveDia(new Date(ev.fecha_inicio));
      const lista = map.get(key) ?? [];
      lista.push(ev);
      map.set(key, lista);
    }
    for (const lista of map.values())
      lista.sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
    return [...map.entries()].sort(([a], [b]) => {
      const [ay, am, ad] = a.split("-").map(Number);
      const [by, bm, bd] = b.split("-").map(Number);
      return (
        new Date(ay, am, ad).getTime() - new Date(by, bm, bd).getTime()
      );
    });
  }, [eventos]);

  function abrirPedido(eventoId: string) {
    setPidiendoParaId(eventoId);
    setTipoIndicacion("reprogramar");
    setTextoIndicacion("");
    setError(null);
  }

  async function enviarPedido(eventoId: string) {
    if (!textoIndicacion.trim()) {
      setError("Escribe brevemente qué pedís.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await crearIndicacion(eventoId, { tipo: tipoIndicacion, texto: textoIndicacion.trim() });
      setPidiendoParaId(null);
      setTextoIndicacion("");
      setEnviadoParaId(eventoId);
      setTimeout(() => setEnviadoParaId((prev) => (prev === eventoId ? null : prev)), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el pedido");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0A70D6]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#06E5FA] shadow-[0_0_10px_rgba(6,229,250,0.85)]" />{" "}
          Mi jornada
        </div>
        <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">
          Agenda confirmada
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Solo lectura — próximos 60 días. Para cambios, pídelos abajo y la Jefatura de Gabinete los aplica.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700"
        >
          <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Panel className="border-slate-300 bg-white shadow-[0_14px_40px_rgba(15,42,76,.09)]">
        <PanelTitle
          icon="calendar"
          title="Próximas actividades confirmadas"
          action={
            <span className="text-[10px] font-semibold text-slate-400">
              {eventos.length} {eventos.length === 1 ? "actividad" : "actividades"}
            </span>
          }
        />
        <div className="max-h-[640px] space-y-5 overflow-y-auto p-4">
          {cargando ? (
            [0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
            ))
          ) : porDia.length === 0 ? (
            <div className="flex flex-col items-center py-14 text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <InstitutionalIcon name="calendar" />
              </div>
              <p className="text-xs font-bold text-slate-600">
                Sin actividades confirmadas en los próximos 60 días
              </p>
            </div>
          ) : (
            porDia.map(([key, items]) => (
              <div key={key}>
                <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#0d5fc1]">
                  {new Date(items[0].fecha_inicio).toLocaleDateString("es-BO", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </p>
                <div className="space-y-2">
                  {items.map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-[#183558]">{ev.titulo}</p>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold capitalize ring-1 ring-inset ${NIVEL_ESTILO[ev.nivel_confidencialidad]}`}
                        >
                          {ev.nivel_confidencialidad}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        {new Date(ev.fecha_inicio).toLocaleTimeString("es-BO", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        –{" "}
                        {new Date(ev.fecha_fin).toLocaleTimeString("es-BO", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {ev.lugar ? ` · ${ev.lugar}` : ""}
                      </p>
                      {ev.descripcion && (
                        <p className="mt-1.5 text-[10px] text-slate-500">{ev.descripcion}</p>
                      )}

                      {enviadoParaId === ev.id && (
                        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          <InstitutionalIcon name="check" className="h-3 w-3" />
                          Pedido enviado a la Jefatura de Gabinete
                        </p>
                      )}

                      {pidiendoParaId === ev.id ? (
                        <div className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                            <select
                              value={tipoIndicacion}
                              onChange={(e) => setTipoIndicacion(e.target.value as IndicacionTipo)}
                              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-[#183558]"
                            >
                              {(Object.keys(INDICACION_TIPO_LABEL) as IndicacionTipo[]).map((t) => (
                                <option key={t} value={t}>
                                  {INDICACION_TIPO_LABEL[t]}
                                </option>
                              ))}
                            </select>
                            <input
                              value={textoIndicacion}
                              onChange={(e) => setTextoIndicacion(e.target.value)}
                              placeholder="Ej. Muévanlo al jueves, se me cruzó otra cosa"
                              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[10px] font-medium text-[#183558] outline-none focus:border-amber-500"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={enviando}
                              onClick={() => void enviarPedido(ev.id)}
                              className="rounded-lg bg-amber-600 px-3 py-1.5 text-[10px] font-extrabold text-white hover:bg-amber-700 disabled:opacity-50"
                            >
                              {enviando ? "Enviando…" : "Enviar pedido"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPidiendoParaId(null)}
                              className="rounded-lg px-3 py-1.5 text-[10px] font-bold text-slate-500 hover:text-slate-700"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => abrirPedido(ev.id)}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-200 px-2.5 py-1 text-[10px] font-bold text-amber-800 transition hover:bg-amber-50"
                        >
                          <InstitutionalIcon name="message" className="h-3 w-3" />
                          Pedir cambio
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
