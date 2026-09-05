"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import {
  API_URL,
  ApiError,
  actualizarEstado,
  crearPublicacion,
  getPublicaciones,
  type EstadoPublicacion,
  type NivelConfidencialidad,
  type Publicacion,
} from "@/lib/api";
import { cerrarSesion, decodificarSesion, obtenerToken, type SesionUsuario } from "@/lib/auth";
import { PublicacionCard } from "@/components/PublicacionCard";
import { StatCard } from "@/components/StatCard";

export default function DashboardPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [sesion, setSesion] = useState<SesionUsuario | null>(null);
  const [publicaciones, setPublicaciones] = useState<Publicacion[]>([]);
  const [conectado, setConectado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [titulo, setTitulo] = useState("");
  const [contenido, setContenido] = useState("");
  const [nivel, setNivel] = useState<NivelConfidencialidad>("interna");
  const [creando, setCreando] = useState(false);
  const [mostrarForm, setMostrarForm] = useState(false);

  useEffect(() => {
    const t = obtenerToken();
    if (!t) {
      router.replace("/login");
      return;
    }
    setToken(t);
    setSesion(decodificarSesion(t));
  }, [router]);

  const cargar = useCallback(
    async (t: string) => {
      setCargando(true);
      try {
        setPublicaciones(await getPublicaciones(t));
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
    },
    [router],
  );

  useEffect(() => {
    if (token) void cargar(token);
  }, [token, cargar]);

  // Tiempo real: el backend ya filtra por secretaría y nivel de
  // confidencialidad antes de emitir -- acá solo se pinta lo que llega.
  useEffect(() => {
    if (!token) return;
    const socket: Socket = io(API_URL, { auth: { token } });
    socket.on("connect", () => setConectado(true));
    socket.on("disconnect", () => setConectado(false));
    socket.on("publicacion:cambio", ({ publicacion }: { accion: string; publicacion: Publicacion }) => {
      setPublicaciones((prev) => {
        const idx = prev.findIndex((p) => p.id === publicacion.id);
        if (idx === -1) return [publicacion, ...prev];
        const copia = [...prev];
        copia[idx] = publicacion;
        return copia;
      });
    });
    return () => {
      socket.disconnect();
    };
  }, [token]);

  const stats = useMemo(
    () => ({
      total: publicaciones.length,
      revision: publicaciones.filter((p) => p.estado === "revision").length,
      publicado: publicaciones.filter((p) => p.estado === "publicado").length,
      confidencial: publicaciones.filter((p) => p.nivel_confidencialidad === "confidencial").length,
    }),
    [publicaciones],
  );

  async function onCrear(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
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
    if (!token) return;
    setError(null);
    try {
      await actualizarEstado(token, id, estado);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transición no permitida");
    }
  }

  function onLogout() {
    cerrarSesion();
    router.replace("/login");
  }

  if (!sesion) return null;

  const iniciales = sesion.email.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
              AG
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight text-slate-900">AGENDA.GOBER</h1>
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${conectado ? "bg-emerald-500" : "bg-red-400"}`}
                />
                {conectado ? "En vivo" : "Desconectado"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-slate-700">{sesion.email}</p>
              <p className="text-xs capitalize text-slate-500">{sesion.rol}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
              {iniciales}
            </div>
            <button
              onClick={onLogout}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard etiqueta="Total visibles" valor={stats.total} acento="text-slate-900" />
          <StatCard etiqueta="En revisión" valor={stats.revision} acento="text-amber-600" />
          <StatCard etiqueta="Publicadas" valor={stats.publicado} acento="text-emerald-600" />
          <StatCard etiqueta="Confidenciales" valor={stats.confidencial} acento="text-red-600" />
        </div>

        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Publicaciones</h2>
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
        ) : publicaciones.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
            <p className="text-sm text-slate-500">No hay publicaciones visibles para tu rol todavía.</p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {publicaciones.map((p) => (
              <PublicacionCard key={p.id} publicacion={p} rol={sesion.rol} onTransicion={onTransicion} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
