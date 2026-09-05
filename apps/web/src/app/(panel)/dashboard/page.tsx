"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  actualizarEstado,
  crearPublicacion,
  getPublicaciones,
  type EstadoPublicacion,
  type NivelConfidencialidad,
  type Publicacion,
} from "@/lib/api";
import { cerrarSesion } from "@/lib/auth";
import { useSession } from "@/lib/session-context";
import { useRealtime } from "@/lib/realtime-context";
import { PublicacionCard } from "@/components/PublicacionCard";
import { StatCard } from "@/components/StatCard";

const ESTADOS: (EstadoPublicacion | "todos")[] = ["todos", "borrador", "revision", "aprobado", "publicado"];

export default function DashboardPage() {
  const router = useRouter();
  const { token, sesion } = useSession();
  const { onCambio } = useRealtime();

  const [publicaciones, setPublicaciones] = useState<Publicacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<EstadoPublicacion | "todos">("todos");

  const [titulo, setTitulo] = useState("");
  const [contenido, setContenido] = useState("");
  const [nivel, setNivel] = useState<NivelConfidencialidad>("interna");
  const [creando, setCreando] = useState(false);
  const [mostrarForm, setMostrarForm] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setPublicaciones(await getPublicaciones(token));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        cerrarSesion();
        router.replace("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Error cargando publicaciones");
    } finally {
      setCargando(false);
    }
  }, [token, router]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(
    () =>
      onCambio(({ publicacion }) => {
        setPublicaciones((prev) => {
          const idx = prev.findIndex((p) => p.id === publicacion.id);
          if (idx === -1) return [publicacion, ...prev];
          const copia = [...prev];
          copia[idx] = publicacion;
          return copia;
        });
      }),
    [onCambio],
  );

  const stats = useMemo(
    () => ({
      total: publicaciones.length,
      revision: publicaciones.filter((p) => p.estado === "revision").length,
      publicado: publicaciones.filter((p) => p.estado === "publicado").length,
      confidencial: publicaciones.filter((p) => p.nivel_confidencialidad === "confidencial").length,
    }),
    [publicaciones],
  );

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return publicaciones.filter((p) => {
      if (filtroEstado !== "todos" && p.estado !== filtroEstado) return false;
      if (q && !p.titulo.toLowerCase().includes(q) && !p.contenido.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [publicaciones, busqueda, filtroEstado]);

  async function onCrear(e: FormEvent) {
    e.preventDefault();
    setCreando(true);
    setError(null);
    try {
      await crearPublicacion(token, { titulo, contenido, nivelConfidencialidad: nivel });
      setTitulo("");
      setContenido("");
      setMostrarForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la publicación");
    } finally {
      setCreando(false);
    }
  }

  async function onTransicion(id: string, estado: EstadoPublicacion) {
    setError(null);
    try {
      await actualizarEstado(token, id, estado);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transición no permitida");
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Publicaciones</h1>
        <p className="text-sm text-slate-500">
          Contenido visible para tu rol · <span className="capitalize">{sesion.rol}</span>
        </p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard etiqueta="Total visibles" valor={stats.total} acento="text-slate-900" />
        <StatCard etiqueta="En revisión" valor={stats.revision} acento="text-amber-600" />
        <StatCard etiqueta="Publicadas" valor={stats.publicado} acento="text-emerald-600" />
        <StatCard etiqueta="Confidenciales" valor={stats.confidencial} acento="text-red-600" />
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por título o contenido…"
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:max-w-xs"
          />
          <div className="flex flex-wrap gap-1.5">
            {ESTADOS.map((e) => (
              <button
                key={e}
                onClick={() => setFiltroEstado(e)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                  filtroEstado === e
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => setMostrarForm((v) => !v)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          {mostrarForm ? "Cerrar" : "+ Nueva"}
        </button>
      </div>

      {mostrarForm && (
        <form onSubmit={onCrear} className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Título</label>
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                required
                placeholder="Ej. Avance de obra ruta X"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Contenido</label>
              <textarea
                value={contenido}
                onChange={(e) => setContenido(e.target.value)}
                required
                rows={4}
                placeholder="Detalle de la publicación…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Confidencialidad</label>
              <select
                value={nivel}
                onChange={(e) => setNivel(e.target.value as NivelConfidencialidad)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="publica">Pública</option>
                <option value="interna">Interna</option>
                <option value="reservada">Reservada</option>
                <option value="confidencial">Confidencial</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={creando}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {creando ? "Creando…" : "Crear publicación"}
              </button>
            </div>
          </div>
        </form>
      )}

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
      )}

      {cargando ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : visibles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <p className="text-sm text-slate-500">
            {publicaciones.length === 0
              ? "No hay publicaciones visibles para tu rol todavía."
              : "Ninguna publicación coincide con el filtro."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((p) => (
            <PublicacionCard key={p.id} publicacion={p} rol={sesion.rol} onTransicion={onTransicion} />
          ))}
        </ul>
      )}
    </div>
  );
}
