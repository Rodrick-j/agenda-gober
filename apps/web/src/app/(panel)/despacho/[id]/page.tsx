"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  actualizarInstruccion,
  agregarItemInstruccion,
  descargarEvidencia,
  devolverItem,
  getEvidencias,
  getInstruccion,
  getSecretarias,
  marcarVistoInstruccion,
  quitarItemInstruccion,
  reabrirInstruccion,
  solicitarValidacionItem,
  subirEvidencia,
  validarItem,
  type Evidencia,
  type InstruccionDetalle,
  type ItemEstadoValidacion,
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

const VALIDACION: Record<ItemEstadoValidacion, { label: string; cls: string }> = {
  en_curso: { label: "En curso", cls: "bg-[#E3EAEF] text-[#52647c]" },
  pendiente_validacion: { label: "Pendiente de validación", cls: "bg-[#E99D19]/15 text-[#a67200]" },
  validado: { label: "Validado", cls: "bg-[#2FBF71]/15 text-[#1c7a46]" },
  devuelto: { label: "Devuelto", cls: "bg-[#F47A2F]/15 text-[#a63c0d]" },
};

function fecha(v: string | null) {
  return v
    ? new Date(v).toLocaleString("es-BO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
}

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
  const esTransversal = esGabinete || esGobernador || sesion.rol === "admin";

  const [instr, setInstr] = useState<InstruccionDetalle | null>(null);
  const [secretarias, setSecretarias] = useState<Secretaria[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const [nvSecretaria, setNvSecretaria] = useState("");
  const [nvTitulo, setNvTitulo] = useState("");
  const [nvPrioridad, setNvPrioridad] = useState<"baja" | "media" | "alta">("media");
  const [agregando, setAgregando] = useState(false);

  const [evidencias, setEvidencias] = useState<Record<string, Evidencia[]>>({});
  const [expandido, setExpandido] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);

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

  const yaAcuso = instr?.vistos.some((v) => v.usuario_id === sesion.userId && v.acuse_at);
  const pideAcuse = instr && ["alta", "urgente"].includes(instr.prioridad) && !yaAcuso;

  async function accion<T>(fn: () => Promise<T>, msg: string) {
    setError(null);
    try {
      await fn();
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : msg);
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

  async function verEvidencias(itemId: string) {
    if (expandido === itemId) {
      setExpandido(null);
      return;
    }
    setExpandido(itemId);
    if (!evidencias[itemId]) {
      const lista = await getEvidencias(id, itemId).catch(() => [] as Evidencia[]);
      setEvidencias((prev) => ({ ...prev, [itemId]: lista }));
    }
  }

  async function subir(itemId: string, file: File) {
    setSubiendo(itemId);
    setError(null);
    try {
      await subirEvidencia(id, itemId, file);
      const lista = await getEvidencias(id, itemId).catch(() => [] as Evidencia[]);
      setEvidencias((prev) => ({ ...prev, [itemId]: lista }));
      setExpandido(itemId);
      cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la evidencia");
    } finally {
      setSubiendo(null);
    }
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
  const btnMini = "rounded-lg border px-2.5 py-1 text-[11px] font-bold transition";

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
              onClick={() => accion(() => marcarVistoInstruccion(id, "acuse"), "No se pudo acusar recibo")}
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
          {instr.fecha_limite && <span>límite {fecha(instr.fecha_limite)}</span>}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {esGabinete && !instr.organiza_id && !cerrada && (
            <button
              type="button"
              onClick={() => accion(() => actualizarInstruccion(id, { organizaId: sesion.userId }), "Otra persona ya la tomó")}
              className={`${btnMini} border-[#0A70D6]/40 bg-[#0A70D6]/10 text-[#0451A5] hover:bg-[#0A70D6]/20`}
            >
              Tomar para organizar
            </button>
          )}
          {(esGobernador || esGabinete) && !cerrada && (
            <>
              <button
                type="button"
                onClick={() => accion(() => actualizarInstruccion(id, { estado: "observada" }), "No se pudo observar")}
                className={`${btnMini} border-[#9DA9BB]/50 text-[#52647c] hover:bg-[#E3EAEF]`}
              >
                Observar
              </button>
              {esGobernador && (
                <button
                  type="button"
                  onClick={() => accion(() => actualizarInstruccion(id, { estado: "cancelada" }), "No se pudo cancelar")}
                  className={`${btnMini} border-[#F47A2F]/40 text-[#a63c0d] hover:bg-[#F47A2F]/10`}
                >
                  Cancelar
                </button>
              )}
            </>
          )}
          {esGobernador && cerrada && (
            <button
              type="button"
              onClick={() => {
                const motivo = window.prompt("Motivo de la reapertura:");
                if (motivo && motivo.trim().length >= 4) accion(() => reabrirInstruccion(id, motivo.trim()), "No se pudo reabrir");
              }}
              className={`${btnMini} border-[#0A70D6]/40 bg-[#0A70D6]/10 text-[#0451A5] hover:bg-[#0A70D6]/20`}
            >
              Reabrir
            </button>
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
                <span className={`h-1.5 w-1.5 rounded-full ${v.acuse_at ? "bg-[#2FBF71]" : "bg-[#7CC7F6]"}`} />
                <span className="font-semibold text-[#02224F]">{v.nombre}</span>
                {v.acuse_at ? `acusó recibo · ${fecha(v.acuse_at)}` : `vio · ${fecha(v.abierto_at)}`}
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
              const val = VALIDACION[it.estado_validacion];
              const evs = evidencias[it.id] ?? [];
              return (
                <li key={it.id} className="rounded-xl border border-[#7CC7F6]/20 bg-[#f5f9fd] px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <InstitutionalIcon name={ICONO_TIPO[it.tipo] ?? "tasks"} className="h-4 w-4 shrink-0 text-[#0A70D6]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#02224F]">{d.titulo}</p>
                      <p className="text-[11px] text-[#52647c]">
                        {it.tipo}
                        {it.secretaria_nombre ? ` · ${it.secretaria_nombre}` : ""}
                        {d.sub ? ` · ${d.sub}` : ""}
                        {it.peso > 1 ? ` · peso ${it.peso}` : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${val.cls}`}>
                      {val.label}
                    </span>
                    {esGabinete && !cerrada && (
                      <button type="button" onClick={() => accion(() => quitarItemInstruccion(id, it.id), "No se pudo quitar")} className="shrink-0 rounded-lg p-1 text-[#9DA9BB] hover:text-[#a63c0d]" title="Quitar del desglose">
                        <InstitutionalIcon name="eyeOff" className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {it.estado_validacion === "devuelto" && it.motivo_devolucion && (
                    <p className="mt-1.5 rounded-lg bg-[#F47A2F]/10 px-2.5 py-1.5 text-[11px] text-[#a63c0d]">
                      Devuelto: {it.motivo_devolucion}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => verEvidencias(it.id)} className="text-[11px] font-semibold text-[#0A70D6] hover:underline">
                      {expandido === it.id ? "Ocultar" : "Ver"} evidencias ({it.evidencias_count})
                    </button>

                    {esGabinete && it.estado_validacion === "pendiente_validacion" && (
                      <>
                        <button
                          type="button"
                          onClick={() => accion(() => validarItem(id, it.id), "No se pudo validar")}
                          className={`${btnMini} border-[#2FBF71]/50 bg-[#2FBF71]/10 text-[#1c7a46] hover:bg-[#2FBF71]/20`}
                        >
                          Validar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const motivo = window.prompt("Motivo de la devolución:");
                            if (motivo && motivo.trim().length >= 4) accion(() => devolverItem(id, it.id, motivo.trim()), "No se pudo devolver");
                          }}
                          className={`${btnMini} border-[#F47A2F]/50 bg-[#F47A2F]/10 text-[#a63c0d] hover:bg-[#F47A2F]/20`}
                        >
                          Devolver
                        </button>
                      </>
                    )}

                    {/* Fallback para el responsable si abre este detalle (normalmente lo hace desde /tareas) */}
                    {!esTransversal && it.tipo === "tarea" && ["en_curso", "devuelto"].includes(it.estado_validacion) && (
                      <>
                        <label className={`${btnMini} cursor-pointer border-[#7CC7F6]/50 text-[#0451A5] hover:bg-[#7CC7F6]/15`}>
                          {subiendo === it.id ? "Subiendo…" : "Adjuntar evidencia"}
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) subir(it.id, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={it.evidencias_count === 0}
                          onClick={() => accion(() => solicitarValidacionItem(id, it.id), "No se pudo pedir la validación")}
                          className={`${btnMini} border-[#E99D19]/50 bg-[#E99D19]/10 text-[#a67200] hover:bg-[#E99D19]/20 disabled:opacity-50`}
                        >
                          Pedir validación
                        </button>
                      </>
                    )}
                  </div>

                  {expandido === it.id && (
                    <ul className="mt-2 space-y-1 border-t border-[#7CC7F6]/20 pt-2">
                      {evs.length === 0 ? (
                        <li className="text-[11px] text-[#9DA9BB]">Sin evidencias.</li>
                      ) : (
                        evs.map((ev) => (
                          <li key={ev.id} className="flex items-center gap-2 text-[11px]">
                            <InstitutionalIcon name="document" className="h-3.5 w-3.5 shrink-0 text-[#7CC7F6]" />
                            <button type="button" onClick={() => descargarEvidencia(ev)} className="font-semibold text-[#0A70D6] hover:underline">
                              {ev.nombre_archivo}
                            </button>
                            <span className="text-[#9DA9BB]">
                              {ev.tipo}
                              {ev.subido_por_nombre ? ` · ${ev.subido_por_nombre}` : ""} · {fecha(ev.created_at)}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
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

      {/* Bitácora */}
      {instr.bitacora.length > 0 && (
        <section className="rounded-2xl border border-[#7CC7F6]/25 bg-white p-5 shadow-[0_10px_28px_rgba(2,34,79,.08)]">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#7CC7F6]">Bitácora</h2>
          <ul className="mt-2 space-y-1.5 text-xs text-[#52647c]">
            {instr.bitacora.map((b, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[10px] text-[#9DA9BB]">{fecha(b.created_at)}</span>
                <span className="font-semibold text-[#02224F]">{b.accion.replace(/_/g, " ")}</span>
                {b.actor_nombre && <span>· {b.actor_nombre}</span>}
                {b.motivo && <span className="italic">— {b.motivo}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
