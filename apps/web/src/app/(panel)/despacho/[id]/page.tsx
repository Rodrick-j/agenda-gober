"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  actualizarInstruccion,
  agregarItemInstruccion,
  getInstruccion,
  getSecretarias,
  marcarVistoInstruccion,
  quitarItemInstruccion,
  type InstruccionDetalle,
  type Secretaria,
} from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { useRealtime } from "@/lib/realtime-context";
import { InstitutionalIcon, type IconName } from "@/components/InstitutionalIcon";

const ESTADO_LABEL: Record<string, string> = {
  emitida: "Emitida",
  en_organizacion: "En organización",
  en_ejecucion: "En ejecución",
  cumplida: "Cumplida",
  observada: "Observada",
  cancelada: "Cancelada",
};

const ICONO_TIPO: Record<string, IconName> = {
  tarea: "tasks",
  evento: "calendar",
  reunion: "users",
  proyecto: "folder",
};

function detalleTexto(d: Record<string, unknown> | null): { titulo: string; sub: string } {
  if (!d) return { titulo: "—", sub: "" };
  const titulo = String(d.titulo ?? d.nombre ?? "—");
  const partes: string[] = [];
  if (d.estado) partes.push(String(d.estado));
  if (typeof d.avance_porcentaje === "number") partes.push(`${d.avance_porcentaje}%`);
  if (d.fecha_vencimiento) partes.push(`vence ${new Date(String(d.fecha_vencimiento)).toLocaleDateString("es-BO")}`);
  if (d.fecha_inicio) partes.push(new Date(String(d.fecha_inicio)).toLocaleDateString("es-BO"));
  return { titulo, sub: partes.join(" · ") };
}

export default function InstruccionDetallePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { sesion } = useSession();
  const { onInstruccionCambio } = useRealtime();

  const esGabinete = sesion.rol === "jefe_gabinete";
  const esGobernador = sesion.rol === "gobernador";

  const [instr, setInstr] = useState<InstruccionDetalle | null>(null);
  const [secretarias, setSecretarias] = useState<Secretaria[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const [nvSecretaria, setNvSecretaria] = useState("");
  const [nvTitulo, setNvTitulo] = useState("");
  const [nvPrioridad, setNvPrioridad] = useState<"baja" | "media" | "alta">("media");
  const [agregando, setAgregando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setInstr(await getInstruccion(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la instrucción");
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Registrar "visto" al abrir el detalle (no baja de acuse a visto en el back).
  useEffect(() => {
    marcarVistoInstruccion(id, "visto").catch(() => undefined);
  }, [id]);

  useEffect(() => {
    if (esGabinete) getSecretarias().then((s) => setSecretarias(s.filter((x) => x.activa))).catch(() => undefined);
  }, [esGabinete]);

  useEffect(() => {
    return onInstruccionCambio((p) => {
      if (!p.id || p.id === id) cargar();
    });
  }, [onInstruccionCambio, cargar, id]);

  const yaAcuso = instr?.vistos.some((v) => v.usuario_id === sesion.userId && v.tipo === "acuse");
  const pideAcuse = instr && ["alta", "urgente"].includes(instr.prioridad) && !yaAcuso;

  async function acusar() {
    await marcarVistoInstruccion(id, "acuse").catch(() => undefined);
    cargar();
  }

  async function cambiarEstado(estado: "observada" | "cancelada") {
    setError(null);
    try {
      await actualizarInstruccion(id, { estado });
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el estado");
    }
  }

  async function tomar() {
    setError(null);
    try {
      await actualizarInstruccion(id, { organizaId: sesion.userId });
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Otra persona ya la tomó");
    }
  }

  async function agregarTarea(e: FormEvent) {
    e.preventDefault();
    if (!nvTitulo.trim()) return;
    setAgregando(true);
    setError(null);
    try {
      await agregarItemInstruccion(id, {
        tipo: "tarea",
        secretariaId: nvSecretaria || undefined,
        titulo: nvTitulo.trim(),
        prioridad: nvPrioridad,
      });
      setNvTitulo("");
      setNvSecretaria("");
      setNvPrioridad("media");
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agregar la tarea");
    } finally {
      setAgregando(false);
    }
  }

  async function quitar(itemId: string) {
    await quitarItemInstruccion(id, itemId).catch(() => undefined);
    cargar();
  }

  if (cargando) return <p className="text-sm text-[#52647c]">Cargando…</p>;
  if (!instr)
    return (
      <div className="space-y-3">
        <p className="text-sm text-[#a63c0d]">{error ?? "No encontrada"}</p>
        <Link href="/despacho" className="text-sm font-semibold text-[#0A70D6] hover:underline">
          ← Volver al Despacho
        </Link>
      </div>
    );

  const inputCls =
    "mt-1.5 w-full rounded-xl border border-[#7CC7F6]/45 bg-[#f5f9fd] px-3 py-2 text-sm font-medium text-[#02224F] outline-none transition focus:border-[#0A70D6] focus:bg-white focus:ring-3 focus:ring-[#2FA1F0]/15";
  const cerrada = ["cumplida", "cancelada", "observada"].includes(instr.estado);

  return (
    <div className="space-y-5">
      <Link href="/despacho" className="inline-flex items-center gap-1 text-xs font-semibold text-[#0A70D6] hover:underline">
        <InstitutionalIcon name="chevronLeft" className="h-3.5 w-3.5" /> Despacho
      </Link>

      {error && (
        <p className="rounded-xl border border-[#F47A2F]/40 bg-[#F47A2F]/10 px-4 py-2.5 text-sm font-medium text-[#a63c0d]">{error}</p>
      )}

      <header className="rounded-2xl border border-[#7CC7F6]/25 bg-white p-5 shadow-[0_10px_28px_rgba(2,34,79,.08)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#E99D19]">
              Instrucción · {instr.prioridad} · {ESTADO_LABEL[instr.estado]}
            </p>
            <h1 className="mt-1 text-lg font-black text-[#02224F]">{instr.titulo}</h1>
            <p className="mt-1 max-w-prose text-sm text-[#52647c]">{instr.objetivo}</p>
          </div>
          {pideAcuse && (
            <button
              type="button"
              onClick={acusar}
              className="shrink-0 rounded-xl bg-[#0A70D6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#0451A5]"
            >
              Enterado
            </button>
          )}
        </div>

        <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-[#E3EAEF]">
          <div
            className={`h-full rounded-full ${instr.en_riesgo ? "bg-[#E99D19]" : "bg-[#0A70D6]"}`}
            style={{ width: `${instr.avance_porcentaje}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#52647c]">
          <span className="font-bold">{instr.avance_porcentaje}% avance</span>
          {instr.en_riesgo && <span className="font-bold text-[#a67200]">En riesgo</span>}
          {instr.fecha_limite && (
            <span>límite {new Date(instr.fecha_limite).toLocaleString("es-BO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {esGabinete && !instr.organiza_id && !cerrada && (
            <button type="button" onClick={tomar} className="rounded-xl border border-[#0A70D6]/40 bg-[#0A70D6]/10 px-3 py-1.5 text-xs font-bold text-[#0451A5] hover:bg-[#0A70D6]/20">
              Tomar para organizar
            </button>
          )}
          {(esGobernador || esGabinete) && !cerrada && (
            <>
              <button type="button" onClick={() => cambiarEstado("observada")} className="rounded-xl border border-[#9DA9BB]/50 px-3 py-1.5 text-xs font-semibold text-[#52647c] hover:bg-[#E3EAEF]">
                Observar
              </button>
              {esGobernador && (
                <button type="button" onClick={() => cambiarEstado("cancelada")} className="rounded-xl border border-[#F47A2F]/40 px-3 py-1.5 text-xs font-semibold text-[#a63c0d] hover:bg-[#F47A2F]/10">
                  Cancelar
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/* Recepción */}
      <section className="rounded-2xl border border-[#7CC7F6]/25 bg-white p-5 shadow-[0_10px_28px_rgba(2,34,79,.08)]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#7CC7F6]">Recepción</h2>
        {instr.vistos.length === 0 ? (
          <p className="mt-2 text-xs text-[#9DA9BB]">Todavía nadie abrió esta instrucción.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-[#52647c]">
            {instr.vistos.map((v) => (
              <li key={v.usuario_id} className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${v.tipo === "acuse" ? "bg-[#2FBF71]" : "bg-[#7CC7F6]"}`} />
                <span className="font-semibold text-[#02224F]">{v.nombre}</span>
                {v.tipo === "acuse" ? "acusó recibo" : "vio"} ·{" "}
                {new Date(v.visto_at).toLocaleString("es-BO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Desglose */}
      <section className="rounded-2xl border border-[#7CC7F6]/25 bg-white p-5 shadow-[0_10px_28px_rgba(2,34,79,.08)]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#7CC7F6]">Desglose ({instr.items.length})</h2>

        {instr.items.length === 0 ? (
          <p className="mt-2 text-xs text-[#9DA9BB]">Sin ítems todavía.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {instr.items.map((it) => {
              const d = detalleTexto(it.detalle);
              return (
                <li key={it.id} className="flex items-center gap-3 rounded-xl border border-[#7CC7F6]/20 bg-[#f5f9fd] px-3 py-2.5">
                  <InstitutionalIcon name={ICONO_TIPO[it.tipo] ?? "tasks"} className="h-4 w-4 shrink-0 text-[#0A70D6]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#02224F]">{d.titulo}</p>
                    <p className="text-[11px] text-[#52647c]">
                      {it.tipo}
                      {it.secretaria_nombre ? ` · ${it.secretaria_nombre}` : ""}
                      {d.sub ? ` · ${d.sub}` : ""}
                    </p>
                  </div>
                  {esGabinete && !cerrada && (
                    <button type="button" onClick={() => quitar(it.id)} className="shrink-0 rounded-lg p-1 text-[#9DA9BB] hover:text-[#a63c0d]" title="Quitar del desglose">
                      <InstitutionalIcon name="eyeOff" className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {esGabinete && !cerrada && (
          <form onSubmit={agregarTarea} className="mt-4 grid gap-2 rounded-xl border border-dashed border-[#7CC7F6]/40 p-3 sm:grid-cols-[1fr_170px_120px_auto]">
            <label className="block text-[10px] font-bold uppercase tracking-wide text-[#52647c]">
              Nueva tarea
              <input value={nvTitulo} onChange={(e) => setNvTitulo(e.target.value)} placeholder="Ej. Enviar cronograma" className={inputCls} />
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-[#52647c]">
              Secretaría
              <select value={nvSecretaria} onChange={(e) => setNvSecretaria(e.target.value)} className={inputCls}>
                <option value="">— elegir —</option>
                {secretarias.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-[#52647c]">
              Prioridad
              <select value={nvPrioridad} onChange={(e) => setNvPrioridad(e.target.value as "baja" | "media" | "alta")} className={inputCls}>
                <option value="baja">baja</option>
                <option value="media">media</option>
                <option value="alta">alta</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={agregando}
              className="mt-auto rounded-xl bg-[#0A70D6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#0451A5] disabled:opacity-60"
            >
              {agregando ? "…" : "Agregar"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
