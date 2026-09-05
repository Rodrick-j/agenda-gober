"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { guardarToken } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await login(email, password);
      guardarToken(accessToken);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen">
      {/* Panel de marca — visible solo en pantallas grandes */}
      <div className="hidden w-1/2 flex-col justify-between bg-gradient-to-br from-indigo-700 via-indigo-800 to-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15 text-sm font-bold backdrop-blur">
            AG
          </div>
          <span className="font-semibold">AGENDA.GOBER</span>
        </div>
        <div>
          <h2 className="text-3xl font-semibold leading-tight">Plataforma de gobernación</h2>
          <p className="mt-3 max-w-sm text-indigo-200">
            Coordinación en tiempo real entre secretarías, gabinete y despacho del gobernador — con
            control de acceso por rol y nivel de confidencialidad.
          </p>
        </div>
        <p className="text-xs text-indigo-300">Acceso restringido · Uso institucional</p>
      </div>

      {/* Formulario */}
      <div className="flex w-full items-center justify-center bg-slate-50 px-4 lg:w-1/2">
        <form onSubmit={onSubmit} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
              AG
            </div>
            <h1 className="text-xl font-semibold text-slate-900">AGENDA.GOBER</h1>
          </div>

          <h2 className="mb-1 text-2xl font-semibold text-slate-900">Iniciar sesión</h2>
          <p className="mb-8 text-sm text-slate-500">Ingresá con tus credenciales institucionales</p>

          <label className="mb-1.5 block text-sm font-medium text-slate-700">Correo</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="usuario@gober.local"
            className="mb-4 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />

          <label className="mb-1.5 block text-sm font-medium text-slate-700">Contraseña</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="mb-5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />

          {error && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
