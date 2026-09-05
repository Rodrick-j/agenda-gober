"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
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

  async function onCrear(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreando(true);
    setError(null);
    try {
      await crearPublicacion(token, { titulo, contenido, nivelConfidencialidad: nivel });
      setTitulo("");
      setContenido("");
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

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">AGENDA.GOBER</h1>
          <p className="flex items-center gap-2 text-sm text-slate-500">
            {sesion.email} · <span className="font-medium">{sesion.rol}</span>
            <span
              className={`inline-block h-2 w-2 rounded-full ${conectado ? "bg-green-500" : "bg-red-400"}`}
              title={conectado ? "Tiempo real conectado" : "Desconectado"}
            />
          </p>
        </div>
        <button onClick={onLogout} className="text-sm text-slate-500 hover:text-slate-900">
          Salir
        </button>
      </header>

      <form onSubmit={onCrear} className="mb-8 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Nueva publicación</h2>
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          required
          placeholder="Título"
          className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <textarea
          value={contenido}
          onChange={(e) => setContenido(e.target.value)}
          required
          placeholder="Contenido"
          rows={3}
          className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="mb-3 flex items-center gap-2">
          <label className="text-sm text-slate-600">Confidencialidad</label>
          <select
            value={nivel}
            onChange={(e) => setNivel(e.target.value as NivelConfidencialidad)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="publica">Pública</option>
            <option value="interna">Interna</option>
            <option value="reservada">Reservada</option>
            <option value="confidencial">Confidencial</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={creando}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {creando ? "Creando..." : "Crear"}
        </button>
      </form>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : publicaciones.length === 0 ? (
        <p className="text-sm text-slate-500">No hay publicaciones visibles para tu rol todavía.</p>
      ) : (
        <ul className="space-y-3">
          {publicaciones.map((p) => (
            <PublicacionCard key={p.id} publicacion={p} rol={sesion.rol} onTransicion={onTransicion} />
          ))}
        </ul>
      )}
    </main>
  );
}
