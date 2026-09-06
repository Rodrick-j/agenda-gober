"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  actualizarSecretaria,
  crearSecretaria,
  getSecretarias,
  type Secretaria,
} from "@/lib/api";
import { useSession } from "@/lib/session-context";

export default function SecretariasPage() {
  const { sesion } = useSession();
  const esAdmin = sesion.rol === "admin";

  const [secretarias, setSecretarias] = useState<Secretaria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<Secretaria | null>(null);
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setSecretarias(await getSecretarias());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function abrirNueva() {
    setError(null);
    setEditando(null);
    setNombre("");
    setSlug("");
    setDescripcion("");
    setMostrarForm(true);
  }

  function abrirEditar(s: Secretaria) {
    setError(null);
    setEditando(s);
    setNombre(s.nombre);
    setSlug(s.slug);
    setDescripcion(s.descripcion ?? "");
    setMostrarForm(true);
  }

  async function onGuardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      if (editando) {
        await actualizarSecretaria(editando.id, { nombre, descripcion: descripcion || undefined });
      } else {
        await crearSecretaria({ nombre, slug, descripcion: descripcion || undefined });
      }
      setMostrarForm(false);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function onToggleActiva(s: Secretaria) {
    setError(null);
    try {
      await actualizarSecretaria(s.id, { activa: !s.activa });
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar");
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Secretarías</h1>
          <p className="mt-2 text-sm text-slate-500">Catálogo de unidades de la Gobernación de Oruro</p>
        </div>
        {esAdmin && (
          <button
            onClick={abrirNueva}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700"
          >
            + Nueva secretaría
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <svg className="h-5 w-5 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm font-medium text-red-800">{error}</p>
        </div>
      )}

      {cargando ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl border border-slate-200/60 bg-white shadow-sm" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {secretarias.map((s) => (
            <li
              key={s.id}
              className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-100"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500 opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>

              <div className="mb-4 flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100/50 text-indigo-600 ring-1 ring-inset ring-indigo-500/10 transition-transform duration-300 group-hover:scale-110 group-hover:from-indigo-100 group-hover:to-indigo-200/50">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
                  </svg>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ring-1 ring-inset ${
                    s.activa
                      ? "bg-emerald-50 text-emerald-600 ring-emerald-500/20"
                      : "bg-slate-50 text-slate-500 ring-slate-500/20"
                  }`}
                >
                  {s.activa ? "Activa" : "Inactiva"}
                </span>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 line-clamp-1">{s.nombre}</h3>
                {s.descripcion && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{s.descripcion}</p>}
                <div className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-500">
                  <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <span>
                    {s.publicaciones_visibles} publicación{s.publicaciones_visibles === 1 ? "" : "es"}
                  </span>
                </div>
              </div>

              {esAdmin && (
                <div className="mt-4 flex gap-1.5 border-t border-slate-100 pt-3">
                  <button
                    onClick={() => abrirEditar(s)}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => onToggleActiva(s)}
                    className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold ${
                      s.activa ? "border-red-200 text-red-600 hover:bg-red-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                    }`}
                  >
                    {s.activa ? "Desactivar" : "Activar"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {mostrarForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => setMostrarForm(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={onGuardar} className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-sm font-extrabold text-slate-800">{editando ? "Editar secretaría" : "Nueva secretaría"}</h2>
              <button type="button" onClick={() => setMostrarForm(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="space-y-3 p-5">
              <label className="block text-xs font-bold text-slate-700">
                Nombre (sigla o corto)
                <input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                  placeholder="Ej. SDOP"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-3 focus:ring-indigo-100"
                />
              </label>
              {!editando && (
                <label className="block text-xs font-bold text-slate-700">
                  Slug (identificador técnico, sin espacios)
                  <input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    required
                    pattern="[a-z0-9-]+"
                    placeholder="Ej. sdop"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-3 focus:ring-indigo-100"
                  />
                </label>
              )}
              <label className="block text-xs font-bold text-slate-700">
                Nombre completo
                <textarea
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  rows={2}
                  placeholder="Ej. Secretaría Departamental de Obras Públicas"
                  className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm leading-relaxed outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-3 focus:ring-indigo-100"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
              <button type="button" onClick={() => setMostrarForm(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardando}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
              >
                {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear secretaría"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
