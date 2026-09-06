"use client";

import { useEffect, useRef, useState } from "react";
import {
  descargarDocumento,
  eliminarDocumento,
  getDocumentos,
  subirDocumento,
  type Documento,
} from "@/lib/api";

function formatoTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentosPublicacion({ publicacionId }: { publicacionId: string }) {
  const [docs, setDocs] = useState<Documento[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargado, setCargado] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function cargar() {
    try {
      setDocs(await getDocumentos(publicacionId));
      setCargado(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  useEffect(() => {
    if (abierto && !cargado) queueMicrotask(() => void cargar());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  async function onArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubiendo(true);
    setError(null);
    try {
      const nuevo = await subirDocumento(publicacionId, file);
      setDocs((prev) => [nuevo, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir");
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onEliminar(id: string) {
    setError(null);
    try {
      await eliminarDocumento(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar");
    }
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between text-xs font-medium text-slate-500 hover:text-slate-700"
      >
        <span className="flex items-center gap-1.5">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          Documentos {cargado ? `(${docs.length})` : ""}
        </span>
        <svg
          className={`h-4 w-4 transition-transform ${abierto ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {abierto && (
        <div className="mt-3 space-y-2">
          {error && <p className="text-xs text-red-600">{error}</p>}

          {docs.length === 0 && cargado && <p className="text-xs text-slate-400">Sin documentos.</p>}

          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <button
                onClick={() => descargarDocumento(d)}
                className="flex min-w-0 items-center gap-2 text-left text-xs text-slate-700 hover:text-indigo-600"
              >
                <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span className="truncate" translate="no">{d.nombre_archivo}</span>
                <span className="shrink-0 text-slate-400">{formatoTamano(Number(d.tamano_bytes))}</span>
              </button>
              <button
                onClick={() => onEliminar(d.id)}
                className="shrink-0 text-slate-300 hover:text-red-500"
                title="Eliminar"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}

          <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 hover:border-indigo-300 hover:text-indigo-600">
            <input ref={inputRef} type="file" className="hidden" onChange={onArchivo} disabled={subiendo} />
            {subiendo ? "Subiendo…" : "+ Adjuntar archivo"}
          </label>
        </div>
      )}
    </div>
  );
}
