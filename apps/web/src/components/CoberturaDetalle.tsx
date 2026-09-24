"use client";

import { useCallback, useEffect, useState } from "react";
import {
  actualizarCobertura,
  darVistoCobertura,
  getEquipoComunicacion,
  type Cobertura,
} from "@/lib/api";
import {
  COBERTURA_ESTADO_ESTILO,
  COBERTURA_ESTADO_LABEL,
  COBERTURA_SIGUIENTES,
  TIPO_PIEZA,
  TIPO_PIEZA_LABEL,
} from "@/lib/comunicacion";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";

function fecha(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-BO", {
    timeZone: "America/La_Paz",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function CoberturaDetalle({
  cobertura,
  puedePlanificar,
  puedeVistoBueno,
  onClose,
  onCambio,
}: {
  cobertura: Cobertura | null;
  puedePlanificar: boolean;
  puedeVistoBueno: boolean;
  onClose: () => void;
  onCambio: (c: Cobertura) => void;
}) {
  const [equipo, setEquipo] = useState<{ id: string; nombre: string }[]>([]);
  const [enfoque, setEnfoque] = useState("");
  const [tipos, setTipos] = useState<string[]>([]);
  const [comunicador, setComunicador] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cobertura) return;
    setEnfoque(cobertura.enfoque ?? "");
    setTipos(cobertura.tipo_pieza ?? []);
    setComunicador(cobertura.comunicador_id ?? "");
    setError(null);
  }, [cobertura]);

  useEffect(() => {
    if (puedePlanificar) getEquipoComunicacion().then(setEquipo).catch(() => undefined);
  }, [puedePlanificar]);

  useEffect(() => {
    if (!cobertura) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", esc);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", esc);
    };
  }, [cobertura, onClose]);

  const mutar = useCallback(
    async (fn: () => Promise<Cobertura>) => {
      setGuardando(true);
      setError(null);
      try {
        onCambio(await fn());
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar");
      } finally {
        setGuardando(false);
      }
    },
    [onCambio],
  );

  if (!cobertura) return null;
  const c = cobertura;

  const sucio =
    enfoque !== (c.enfoque ?? "") ||
    comunicador !== (c.comunicador_id ?? "") ||
    JSON.stringify([...tipos].sort()) !== JSON.stringify([...(c.tipo_pieza ?? [])].sort());

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[#02224F]/72 backdrop-blur-[5px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="animate-fade-in-up relative flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-[#7CC7F6]/30 bg-white shadow-[0_30px_90px_rgba(2,34,79,0.48)]"
      >
        <div className="h-1 shrink-0 bg-gradient-to-r from-[#e879f9] via-[#2FA1F0] to-[#E99D19]" />
        <div className="flex shrink-0 items-start justify-between gap-4 bg-gradient-to-br from-[#043472] via-[#0451A5] to-[#02224F] px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="mb-0.5 text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#f5b5ff]">
              Cobertura de comunicación
            </p>
            <h2 className="truncate text-lg font-black tracking-tight">
              {c.evento_titulo ?? "Evento"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-[#E3EAEF] transition hover:bg-white/20"
          >
            <InstitutionalIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto bg-[linear-gradient(145deg,#ffffff_0%,#f4f8fd_100%)] px-5 py-5">
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-xs">
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Estado</dt>
              <dd className="mt-0.5">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${COBERTURA_ESTADO_ESTILO[c.estado]}`}>
                  {COBERTURA_ESTADO_LABEL[c.estado]}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Fecha del evento</dt>
              <dd className="mt-0.5 font-medium text-[#183558]">{fecha(c.evento_fecha)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Secretaría</dt>
              <dd className="mt-0.5 font-medium text-[#183558]">{c.secretaria_nombre ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Pidió</dt>
              <dd className="mt-0.5 font-medium text-[#183558]" translate="no">{c.solicitante_nombre ?? "—"}</dd>
            </div>
            {c.evento_lugar && (
              <div className="col-span-2">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Lugar</dt>
                <dd className="mt-0.5 font-medium text-[#183558]">{c.evento_lugar}</dd>
              </div>
            )}
          </dl>

          {puedePlanificar && (
            <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#0d5fc1]">Planificación (UNICOM)</h3>

              <div className="flex flex-wrap gap-1.5">
                {COBERTURA_SIGUIENTES[c.estado].map((e) => (
                  <button
                    key={e}
                    type="button"
                    disabled={guardando}
                    onClick={() => mutar(() => actualizarCobertura(c.id, { estado: e }))}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-[#0d5fc1]/40 hover:bg-[#eef5fd] disabled:opacity-50"
                  >
                    → {COBERTURA_ESTADO_LABEL[e]}
                  </button>
                ))}
              </div>

              <label className="block text-[11px] font-semibold text-slate-500">
                Comunicador asignado
                <select
                  value={comunicador}
                  onChange={(ev) => setComunicador(ev.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-[#183558]"
                >
                  <option value="">Sin asignar</option>
                  {equipo.map((u) => (
                    <option key={u.id} value={u.id}>{u.nombre}</option>
                  ))}
                </select>
              </label>

              <div className="text-[11px] font-semibold text-slate-500">
                Piezas
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {TIPO_PIEZA.map((t) => {
                    const on = tipos.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setTipos((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))
                        }
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                          on ? "bg-[#0d5fc1] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {TIPO_PIEZA_LABEL[t]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block text-[11px] font-semibold text-slate-500">
                Enfoque / línea de mensaje
                <textarea
                  value={enfoque}
                  onChange={(ev) => setEnfoque(ev.target.value)}
                  rows={3}
                  placeholder="Qué destacar, tono, vocería…"
                  className="mt-1 w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-[#183558]"
                />
              </label>

              <button
                type="button"
                disabled={!sucio || guardando}
                onClick={() =>
                  mutar(() =>
                    actualizarCobertura(c.id, {
                      enfoque,
                      tipoPieza: tipos,
                      comunicadorId: comunicador || undefined,
                    }),
                  )
                }
                className="rounded-xl bg-[#0d5fc1] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#094f9f] disabled:opacity-50"
              >
                {guardando ? "Guardando…" : "Guardar planificación"}
              </button>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200/80 bg-white p-4">
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#0d5fc1]">Visto de Gabinete</h3>
            {c.gabinete_visto_at ? (
              <p className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                <InstitutionalIcon name="check" className="h-4 w-4" />
                Aprobado — {fecha(c.gabinete_visto_at)}
              </p>
            ) : puedeVistoBueno ? (
              <button
                type="button"
                disabled={guardando || c.estado !== "lista"}
                onClick={() => mutar(() => darVistoCobertura(c.id))}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                title={c.estado !== "lista" ? "La cobertura debe estar en estado «lista»" : undefined}
              >
                Dar el visto
              </button>
            ) : (
              <p className="text-xs text-slate-500">Pendiente del visto de Gabinete.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
