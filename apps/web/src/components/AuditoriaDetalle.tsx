"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAuditoriaDetalle,
  type CampoCambio,
  type RegistroAuditoriaDetalle,
} from "@/lib/api";
import { ACCION_ESTILO, ACCION_LABEL, fechaHoraBolivia, moduloLabel } from "@/lib/auditoria";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";

const CAMPO_ETIQUETA: Record<string, string> = {
  titulo: "Título",
  nombre: "Nombre",
  estado: "Estado",
  prioridad: "Prioridad",
  fecha_inicio: "Fecha de inicio",
  fecha_fin: "Fecha de fin",
  fecha_vencimiento: "Vencimiento",
  fecha_limite: "Fecha límite",
  fecha_fin_estimada: "Fecha estimada de fin",
  avance_porcentaje: "Avance",
  nivel_confidencialidad: "Confidencialidad",
  secretaria_id: "Secretaría",
  activo: "Estado de la cuenta",
  descripcion: "Descripción",
  objetivo: "Objetivo",
  presupuesto: "Presupuesto",
  lugar: "Lugar",
  organiza_id: "Unidad organizadora",
  estado_validacion: "Validación",
  created_at: "Creado",
  updated_at: "Actualizado",
};

const campoLabel = (c: string) =>
  CAMPO_ETIQUETA[c] ?? c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, " ");

// Distingue los tres "vacíos" que el prompt pide no confundir:
//  - la clave no venía en el snapshot  -> "sin dato"
//  - null                              -> etiqueta "nulo"
//  - cadena vacía                      -> etiqueta "vacío"
function Valor({ presente, valor }: { presente: boolean; valor: unknown }) {
  if (!presente) return <span className="text-slate-300">— sin dato</span>;
  if (valor === null) return <span className="italic text-slate-400">nulo</span>;
  if (valor === "") return <span className="italic text-slate-400">vacío</span>;
  if (typeof valor === "boolean")
    return <span className="font-medium">{valor ? "Sí" : "No"}</span>;
  if (typeof valor === "object")
    return (
      <span className="break-all font-mono text-[11px]">{JSON.stringify(valor)}</span>
    );
  return <span className="break-words">{String(valor)}</span>;
}

function FilasDiff({
  cambios,
  accion,
}: {
  cambios: CampoCambio[];
  accion: string;
}) {
  const soloInsert = accion === "INSERT";
  const soloDelete = accion === "DELETE";

  return (
    <table className="w-full border-separate border-spacing-0 text-xs">
      <thead>
        <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <th className="pb-1.5 pr-3">Campo</th>
          {!soloInsert && <th className="pb-1.5 pr-3">Antes</th>}
          {!soloDelete && <th className="pb-1.5">Después</th>}
        </tr>
      </thead>
      <tbody>
        {cambios.map((c) => (
          <tr
            key={c.campo}
            className={c.cambiado ? "bg-amber-50/60" : undefined}
          >
            <td className="border-t border-slate-100 py-1.5 pr-3 align-top font-semibold text-[#183558]">
              {campoLabel(c.campo)}
              {c.cambiado && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
              )}
            </td>
            {!soloInsert && (
              <td className="border-t border-slate-100 py-1.5 pr-3 align-top text-slate-600">
                <Valor presente={c.antesPresente} valor={c.antes} />
              </td>
            )}
            {!soloDelete && (
              <td className="border-t border-slate-100 py-1.5 align-top text-slate-800">
                <Valor presente={c.despuesPresente} valor={c.despues} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-xs font-medium text-[#183558]">{children}</dd>
    </div>
  );
}

export function AuditoriaDetalle({
  id,
  onClose,
}: {
  id: number | null;
  onClose: () => void;
}) {
  const [dato, setDato] = useState<RegistroAuditoriaDetalle | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (n: number) => {
    setDato(null);
    setError(null);
    setCargando(true);
    try {
      setDato(await getAuditoriaDetalle(n));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el detalle");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (id != null) void cargar(id);
  }, [id, cargar]);

  useEffect(() => {
    if (id == null) return;
    const previo = document.body.style.overflow;
    const cerrarConEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", cerrarConEscape);
    return () => {
      document.body.style.overflow = previo;
      document.removeEventListener("keydown", cerrarConEscape);
    };
  }, [id, onClose]);

  if (id == null) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Cerrar detalle"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[#02224F]/72 backdrop-blur-[5px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="aud-det-title"
        className="animate-fade-in-up relative flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-[#7CC7F6]/30 bg-white shadow-[0_30px_90px_rgba(2,34,79,0.48)]"
      >
        <div className="h-1 shrink-0 bg-gradient-to-r from-[#06E5FA] via-[#2FA1F0] to-[#E99D19]" />

        <div className="flex shrink-0 items-start justify-between gap-4 bg-gradient-to-br from-[#043472] via-[#0451A5] to-[#02224F] px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="mb-0.5 text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#37F0FC]">
              Evento de auditoría {dato ? `#${dato.id}` : ""}
            </p>
            <h2 id="aud-det-title" className="truncate text-lg font-black tracking-tight">
              {dato ? dato.resumen : "Cargando…"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-[#E3EAEF] transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37F0FC]/50"
          >
            <InstitutionalIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-[linear-gradient(145deg,#ffffff_0%,#f4f8fd_100%)] px-5 py-5">
          {cargando && (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs font-semibold text-red-700"
            >
              <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {dato && !cargando && (
            <div className="space-y-5">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-slate-200/80 bg-white p-4">
                <Dato label="Fecha y hora">
                  {fechaHoraBolivia(dato.created_at)}
                  <span className="ml-1 text-[10px] font-normal text-slate-400">(hora de Bolivia)</span>
                </Dato>
                <Dato label="Acción">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${
                      ACCION_ESTILO[dato.accion] ?? "bg-slate-100 text-slate-600 ring-slate-200"
                    }`}
                  >
                    {ACCION_LABEL[dato.accion] ?? dato.accion}
                  </span>
                </Dato>

                <Dato label="Responsable">
                  {dato.usuario_email ? (
                    <span translate="no">
                      {dato.usuario_nombre ? `${dato.usuario_nombre} · ` : ""}
                      {dato.usuario_email}
                    </span>
                  ) : (
                    <span className="text-slate-400">
                      Sistema — no atribuible a una persona
                    </span>
                  )}
                </Dato>
                <Dato label="Rol / área actual del responsable">
                  {dato.usuario_email ? (
                    <span className="capitalize">
                      {dato.usuario_rol_actual ?? "—"}
                      {dato.usuario_area_actual ? ` · ${dato.usuario_area_actual}` : ""}
                    </span>
                  ) : (
                    "—"
                  )}
                </Dato>

                <Dato label="Módulo">{moduloLabel(dato.tabla)}</Dato>
                <Dato label="Secretaría del registro">
                  {dato.secretaria_nombre ?? <span className="text-slate-400">no aplica</span>}
                </Dato>

                <div className="col-span-2">
                  <Dato label="Registro afectado">
                    <span className="font-mono text-[11px]" translate="no">
                      {dato.tabla} · {dato.registro_id}
                    </span>
                  </Dato>
                </div>
              </dl>

              <section className="rounded-2xl border border-slate-200/80 bg-white p-4">
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#0d5fc1]">
                  {dato.accion === "INSERT"
                    ? "Valores iniciales"
                    : dato.accion === "DELETE"
                      ? "Valores antes de eliminar"
                      : "Comparación por campo"}
                </h3>
                {dato.cambios.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Sin campos visibles. Los datos sensibles (contraseñas, hashes,
                    tokens) se omiten a propósito.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <FilasDiff cambios={dato.cambios} accion={dato.accion} />
                  </div>
                )}
              </section>

              <details className="group rounded-2xl border border-slate-200/80 bg-white p-4">
                <summary className="cursor-pointer list-none text-[11px] font-bold uppercase tracking-wider text-slate-500 marker:content-none">
                  <span className="inline-flex items-center gap-1.5">
                    <InstitutionalIcon
                      name="chevronRight"
                      className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
                    />
                    Información técnica
                  </span>
                </summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      datos_anteriores
                    </p>
                    <pre className="max-h-56 overflow-auto rounded-lg bg-slate-900/95 p-3 text-[10px] leading-relaxed text-slate-100">
                      {JSON.stringify(dato.datos_anteriores, null, 2) ?? "null"}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      datos_nuevos
                    </p>
                    <pre className="max-h-56 overflow-auto rounded-lg bg-slate-900/95 p-3 text-[10px] leading-relaxed text-slate-100">
                      {JSON.stringify(dato.datos_nuevos, null, 2) ?? "null"}
                    </pre>
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
