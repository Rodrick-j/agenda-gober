"use client";

import { useEffect, useState } from "react";
import { getSecretarias, type Secretaria } from "@/lib/api";
import { useSession } from "@/lib/session-context";

export default function SecretariasPage() {
  const { token } = useSession();
  const [secretarias, setSecretarias] = useState<Secretaria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSecretarias(token)
      .then(setSecretarias)
      .catch((err) => setError(err instanceof Error ? err.message : "Error"))
      .finally(() => setCargando(false));
  }, [token]);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Secretarías</h1>
        <p className="text-sm text-slate-500">Catálogo de secretarías de la gobernación</p>
      </div>

      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}

      {cargando ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {secretarias.map((s) => (
            <li key={s.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
                  </svg>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                    s.activa
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      : "bg-slate-100 text-slate-500 ring-slate-200"
                  }`}
                >
                  {s.activa ? "Activa" : "Inactiva"}
                </span>
              </div>
              <h3 className="font-semibold text-slate-900">{s.nombre}</h3>
              <p className="mt-1 text-sm text-slate-500">
                {s.publicaciones_visibles} publicación{s.publicaciones_visibles === 1 ? "" : "es"} visible
                {s.publicaciones_visibles === 1 ? "" : "s"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
