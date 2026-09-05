"use client";

import { useEffect, useState } from "react";
import { getAuditoria, type RegistroAuditoria } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { rangoDeRol } from "@/lib/roles";

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
    const d = r.datos_nuevos as { titulo?: string };
    return d.titulo ? `Creó "${d.titulo}"` : "Registro creado";
  }
  return "—";
}

export default function AuditoriaPage() {
  const { token, sesion } = useSession();
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const esTransversal = rangoDeRol(sesion.rol) >= 99;

  useEffect(() => {
    if (!esTransversal) {
      setCargando(false);
      return;
    }
    getAuditoria(token)
      .then(setRegistros)
      .catch((err) => setError(err instanceof Error ? err.message : "Error"))
      .finally(() => setCargando(false));
  }, [token, esTransversal]);

  if (!esTransversal) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          La auditoría solo es visible para gobernador, jefe de gabinete o administrador. Tu rol
          (<span className="capitalize">{sesion.rol}</span>) no tiene acceso — y el backend lo
          confirma: aunque llegaras a esta URL, la política RLS devuelve cero filas.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Auditoría</h1>
        <p className="text-sm text-slate-500">Registro inmutable de cambios · últimos 200 eventos</p>
      </div>

      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}

      {cargando ? (
        <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-white" />
      ) : registros.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <p className="text-sm text-slate-500">Sin eventos registrados todavía.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Usuario</th>
                <th className="px-4 py-3">Acción</th>
                <th className="px-4 py-3">Tabla</th>
                <th className="px-4 py-3">Cambio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {registros.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {new Date(r.created_at).toLocaleString("es-BO")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700" translate="no">
                    {r.usuario_email ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                        ACCION_ESTILO[r.accion] ?? "bg-slate-100 text-slate-600 ring-slate-200"
                      }`}
                    >
                      {r.accion}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.tabla}</td>
                  <td className="max-w-md truncate px-4 py-3 text-slate-600" title={resumenCambio(r)}>
                    {resumenCambio(r)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
