"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  emitirInstruccion,
  getInstrucciones,
  type Instruccion,
  type InstruccionPrioridad,
} from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { useRealtime } from "@/lib/realtime-context";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";

const PRIORIDADES: InstruccionPrioridad[] = ["baja", "media", "alta", "urgente"];

const ESTADO_LABEL: Record<string, string> = {
  emitida: "Emitida",
  en_organizacion: "En organización",
  en_ejecucion: "En ejecución",
  cumplida: "Cumplida",
  observada: "Observada",
  cancelada: "Cancelada",
};

const PRIORIDAD_ESTILO: Record<InstruccionPrioridad, string> = {
  baja: "bg-[#E3EAEF] text-[#52647c] ring-[#9DA9BB]/35",
  media: "bg-[#2FA1F0]/10 text-[#0451A5] ring-[#2FA1F0]/30",
  alta: "bg-[#F47A2F]/10 text-[#c34f12] ring-[#F47A2F]/35",
  urgente: "bg-[#F47A2F]/20 text-[#a63c0d] ring-[#F47A2F]/55",
};

function semaforo(i: Instruccion): { dot: string; texto: string } {
  if (i.estado === "cumplida") return { dot: "bg-[#06E5FA]", texto: "Cumplida" };
  if (i.estado === "cancelada" || i.estado === "observada") return { dot: "bg-[#9DA9BB]", texto: ESTADO_LABEL[i.estado] };
  if (i.fecha_limite && new Date(i.fecha_limite).getTime() < Date.now()) return { dot: "bg-[#F47A2F]", texto: "Vencida" };
  if (i.en_riesgo) return { dot: "bg-[#E99D19]", texto: "En riesgo" };
  return { dot: "bg-[#2FBF71]", texto: "Al día" };
}

function InstruccionCard({ i }: { i: Instruccion }) {
  const s = semaforo(i);
  return (
    <Link
      href={`/despacho/${i.id}`}
      className="group flex flex-col gap-3 rounded-2xl border border-[#7CC7F6]/25 bg-white p-4 shadow-[0_10px_28px_rgba(2,34,79,.08)] transition hover:-translate-y-0.5 hover:border-[#2FA1F0]/45"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[#02224F]">{i.titulo}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-[#52647c]">{i.objetivo}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${PRIORIDAD_ESTILO[i.prioridad]}`}>
          {i.prioridad}
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-[#E3EAEF]">
        <div
          className={`h-full rounded-full ${i.en_riesgo ? "bg-[#E99D19]" : "bg-[#0A70D6]"}`}
          style={{ width: `${i.avance_porcentaje}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#52647c]">
        <span className="flex items-center gap-1.5 font-semibold">
          <span className={`h-2 w-2 rounded-full ${s.dot}`} />
          {s.texto}
        </span>
        <span>{i.avance_porcentaje}% avance</span>
        <span>{ESTADO_LABEL[i.estado]}</span>
        {typeof i.items_total === "number" && <span>{i.items_total} ítems</span>}
        {typeof i.secretarias === "number" && i.secretarias > 0 && <span>{i.secretarias} secretarías</span>}
        {i.fecha_limite && (
          <span>límite {new Date(i.fecha_limite).toLocaleDateString("es-BO", { day: "2-digit", month: "short" })}</span>
        )}
      </div>
    </Link>
  );
}

export default function DespachoPage() {
  const { sesion } = useSession();
  const { onInstruccionCambio } = useRealtime();
  const esGobernador = sesion.rol === "gobernador";

  const [items, setItems] = useState<Instruccion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [prioridad, setPrioridad] = useState<InstruccionPrioridad>("media");
  const [fechaLimite, setFechaLimite] = useState("");
  const [guardando, setGuardando] = useState(false);
  const tituloRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setItems(await getInstrucciones());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las instrucciones");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    return onInstruccionCambio(() => cargar());
  }, [onInstruccionCambio, cargar]);

  useEffect(() => {
    if (mostrarForm) tituloRef.current?.focus();
  }, [mostrarForm]);

  const paraOrganizar = useMemo(() => items.filter((i) => i.estado === "emitida"), [items]);
  const resto = useMemo(() => items.filter((i) => i.estado !== "emitida"), [items]);

  async function emitir(e: FormEvent) {
    e.preventDefault();
    if (!titulo.trim() || !objetivo.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await emitirInstruccion({
        titulo: titulo.trim(),
        objetivo: objetivo.trim(),
        prioridad,
        fechaLimite: fechaLimite ? new Date(fechaLimite).toISOString() : undefined,
      });
      setTitulo("");
      setObjetivo("");
      setPrioridad("media");
      setFechaLimite("");
      setMostrarForm(false);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo emitir la instrucción");
    } finally {
      setGuardando(false);
    }
  }

  const inputCls =
    "mt-1.5 w-full rounded-xl border border-[#7CC7F6]/45 bg-[#f5f9fd] px-3.5 py-2.5 text-sm font-medium text-[#02224F] outline-none transition placeholder:text-[#9DA9BB] focus:border-[#0A70D6] focus:bg-white focus:ring-3 focus:ring-[#2FA1F0]/15";

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black text-[#02224F]">
            <InstitutionalIcon name="layers" className="h-5 w-5 text-[#0A70D6]" />
            Despacho
          </h1>
          <p className="mt-1 text-xs text-[#52647c]">
            {esGobernador
              ? "Instrucciones que emitiste y su avance en vivo."
              : "Instrucciones del Gobernador para organizar y seguir."}
          </p>
        </div>
        {esGobernador && (
          <button
            type="button"
            onClick={() => setMostrarForm((v) => !v)}
            className="flex items-center gap-2 rounded-xl bg-[#0A70D6] px-4 py-2.5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(10,112,214,.28)] transition hover:bg-[#0451A5]"
          >
            <InstitutionalIcon name="plus" className="h-4 w-4" />
            Nueva instrucción
          </button>
        )}
      </header>

      {error && (
        <p className="rounded-xl border border-[#F47A2F]/40 bg-[#F47A2F]/10 px-4 py-2.5 text-sm font-medium text-[#a63c0d]">
          {error}
        </p>
      )}

      {esGobernador && mostrarForm && (
        <form
          onSubmit={emitir}
          className="space-y-3 rounded-2xl border border-[#7CC7F6]/30 bg-white p-4 shadow-[0_10px_28px_rgba(2,34,79,.08)]"
        >
          <label className="block text-xs font-bold uppercase tracking-wide text-[#52647c]">
            Título
            <input
              ref={tituloRef}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              required
              maxLength={200}
              placeholder="Ej. Operativo de limpieza del Río Tagarete"
              className={inputCls}
            />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[#52647c]">
            Objetivo
            <textarea
              value={objetivo}
              onChange={(e) => setObjetivo(e.target.value)}
              required
              rows={3}
              placeholder="Qué se quiere lograr y con qué alcance…"
              className={`${inputCls} resize-y`}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wide text-[#52647c]">
              Prioridad
              <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as InstruccionPrioridad)} className={inputCls}>
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-[#52647c]">
              Fecha límite (opcional)
              <input type="datetime-local" value={fechaLimite} onChange={(e) => setFechaLimite(e.target.value)} className={inputCls} />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setMostrarForm(false)} className="rounded-xl px-4 py-2 text-sm font-semibold text-[#52647c] hover:bg-[#E3EAEF]">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="rounded-xl bg-[#0A70D6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#0451A5] disabled:opacity-60"
            >
              {guardando ? "Emitiendo…" : "Emitir"}
            </button>
          </div>
        </form>
      )}

      {cargando ? (
        <p className="text-sm text-[#52647c]">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#7CC7F6]/40 bg-white p-8 text-center text-sm text-[#52647c]">
          Todavía no hay instrucciones.
        </p>
      ) : (
        <div className="space-y-5">
          {paraOrganizar.length > 0 && (
            <section>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#E99D19]">Para organizar</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {paraOrganizar.map((i) => (
                  <InstruccionCard key={i.id} i={i} />
                ))}
              </div>
            </section>
          )}
          {resto.length > 0 && (
            <section>
              {paraOrganizar.length > 0 && (
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#7CC7F6]">En curso y cerradas</h2>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                {resto.map((i) => (
                  <InstruccionCard key={i.id} i={i} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
