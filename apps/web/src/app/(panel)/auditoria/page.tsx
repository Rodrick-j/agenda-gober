"use client";

import { useEffect, useState } from "react";
import { getAuditoria, type RegistroAuditoria } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { rangoDeRol } from "@/lib/roles";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

const ACCION_ESTILO: Record<string, string> = {
  INSERT: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  UPDATE: "bg-amber-50 text-amber-700 ring-amber-200",
  DELETE: "bg-red-50 text-red-700 ring-red-200",
};

function resumenCambio(r: RegistroAuditoria): string {
  if (r.accion === "UPDATE" && r.datos_anteriores && r.datos_nuevos) {
    const antes = r.datos_anteriores as Record<string, unknown>;
    const desp = r.datos_nuevos as Record<string, unknown>;
    const cambios = Object.keys(desp)
      .filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(desp[k]))
      .map((k) => `${k}: ${JSON.stringify(antes[k])} → ${JSON.stringify(desp[k])}`);
    return cambios.length ? cambios.join(", ") : "—";
  }
  if (r.accion === "INSERT" && r.datos_nuevos) {
    const d = r.datos_nuevos as { titulo?: string; nombre_archivo?: string };
    if (d.titulo) return `Creó "${d.titulo}"`;
    if (d.nombre_archivo) return `Adjuntó "${d.nombre_archivo}"`;
    return "Registro creado";
  }
  if (r.accion === "DELETE") return "Registro eliminado";
  return "—";
}

export default function AuditoriaPage() {
  const { sesion } = useSession();
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const esTransversal = rangoDeRol(sesion.rol) >= 99;

  useEffect(() => {
    if (!esTransversal) {
      setCargando(false);
      return;
    }
    getAuditoria()
      .then(setRegistros)
      .catch((err) => setError(err instanceof Error ? err.message : "Error"))
      .finally(() => setCargando(false));
  }, [esTransversal]);

  if (!esTransversal) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <InstitutionalIcon name="shield" className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            La auditoría solo es visible para gobernador, jefe de gabinete o administrador. Tu rol
            (<span className="font-bold capitalize">{sesion.rol}</span>) no tiene acceso — y el
            backend lo confirma: aunque llegaras a esta URL, la política RLS devuelve cero filas.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4">
        <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0d5fc1]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#0d5fc1]" /> Trazabilidad institucional
        </div>
        <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">Auditoría</h1>
        <p className="mt-1 text-xs text-slate-500">Registro inmutable de cambios · últimos 200 eventos</p>
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Panel>
        <PanelTitle
          icon="audit"
          title="Historial de cambios"
          action={<span className="text-[10px] font-semibold text-slate-400">{registros.length} registros</span>}
        />

        {cargando ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : registros.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <InstitutionalIcon name="audit" />
            </div>
            <p className="text-xs font-bold text-slate-600">Sin eventos registrados todavía.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-[#f4f8fd] text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Fecha</th>
                  <th className="px-4 py-2.5">Usuario</th>
                  <th className="px-4 py-2.5">Acción</th>
                  <th className="px-4 py-2.5">Tabla</th>
                  <th className="px-4 py-2.5">Cambio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {registros.map((r) => (
                  <tr key={r.id} className="transition hover:bg-[#f4f8fd]">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                      {new Date(r.created_at).toLocaleString("es-BO")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-[#183558]" translate="no">
                      {r.usuario_email ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${
                          ACCION_ESTILO[r.accion] ?? "bg-slate-100 text-slate-600 ring-slate-200"
                        }`}
                      >
                        {r.accion}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{r.tabla}</td>
                    <td className="max-w-md truncate px-4 py-3 text-xs text-slate-600" title={resumenCambio(r)}>
                      {resumenCambio(r)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
