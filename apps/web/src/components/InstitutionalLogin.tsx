"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { guardarToken } from "@/lib/auth";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { InstitutionalMark } from "@/components/InstitutionalMark";

const BENEFITS = [
  { icon: "wifi" as const, title: "Coordinación en tiempo real", detail: "Información sincronizada entre las unidades." },
  { icon: "shield" as const, title: "Acceso seguro por roles", detail: "Cada usuario ve únicamente lo autorizado." },
  { icon: "audit" as const, title: "Trazabilidad institucional", detail: "Todos los cambios quedan registrados." },
];

export function InstitutionalLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
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
    <main className="grid min-h-screen bg-[#f4f7fb] lg:grid-cols-[minmax(0,1.08fr)_minmax(460px,.92fr)]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#071b32] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-[#8b0c34] via-amber-400 to-[#08796b]" />
        <div className="absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full border border-white/5" />
        <div className="absolute -right-24 -top-24 h-[360px] w-[360px] rounded-full border border-white/5" />
        <div className="absolute inset-x-0 bottom-0 h-[42%] opacity-30 [background:linear-gradient(145deg,transparent_48%,#1e5776_49%_58%,transparent_59%),linear-gradient(215deg,transparent_47%,#6f2445_48%_57%,transparent_58%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#071b32] to-transparent" />

        <div className="relative">
          <InstitutionalMark />
          <div className="mt-6 h-px w-full bg-gradient-to-r from-white/20 to-transparent" />
          <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200/70">Gobierno Autónomo Departamental</p>
        </div>

        <div className="relative max-w-xl py-10">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">
            <InstitutionalIcon name="sparkles" className="h-3.5 w-3.5" /> Gestión que transforma
          </div>
          <h1 className="max-w-lg text-4xl font-black leading-[1.08] tracking-[-0.035em] xl:text-5xl">Agenda y coordinación <span className="text-amber-300">institucional</span></h1>
          <p className="mt-5 max-w-lg text-sm leading-6 text-slate-300">Una plataforma central para coordinar, comunicar y dar seguimiento al trabajo de la Gobernación de Oruro.</p>

          <div className="mt-9 grid gap-3 xl:grid-cols-3">
            {BENEFITS.map((benefit) => (
              <div key={benefit.title} className="rounded-2xl border border-white/[0.08] bg-white/[0.045] p-4 backdrop-blur-sm">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-cyan-200"><InstitutionalIcon name={benefit.icon} className="h-4 w-4" /></div>
                <p className="text-[11px] font-bold text-white">{benefit.title}</p>
                <p className="mt-1.5 text-[9px] leading-4 text-slate-400">{benefit.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center justify-between text-[9px] uppercase tracking-[0.16em] text-slate-500"><span>Estado · Desarrollo · Gente</span><span>Uso institucional</span></div>
      </section>

      <section className="relative flex min-h-screen flex-col">
        <div className="relative flex min-h-[100px] items-center overflow-hidden bg-gradient-to-r from-[#79092d] to-[#52051e] px-6 lg:hidden">
          <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full border border-white/10" />
          <div className="relative"><InstitutionalMark compact /></div>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10 lg:px-12">
          <div className="w-full max-w-[430px]">
            <div className="mb-8">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#6f0b2b] text-white shadow-lg shadow-rose-900/20"><InstitutionalIcon name="lock" className="h-5 w-5" /></div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#0d5fc1]">Portal institucional</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-[#102a4c]">Bienvenido de nuevo</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Ingresa con tus credenciales autorizadas para acceder al sistema.</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-5">
              <label className="block text-xs font-bold text-slate-700">
                Correo institucional
                <div className="relative mt-2"><InstitutionalIcon name="message" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="usuario@gober.local" className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#0d5fc1] focus:ring-3 focus:ring-blue-100" /></div>
              </label>
              <label className="block text-xs font-bold text-slate-700">
                Contraseña
                <div className="relative mt-2"><InstitutionalIcon name="lock" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#0d5fc1] focus:ring-3 focus:ring-blue-100" /></div>
              </label>

              {error && <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700"><InstitutionalIcon name="shield" className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

              <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#820d33] to-[#650824] px-5 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-rose-900/20 transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-3 focus:ring-rose-200 disabled:cursor-wait disabled:translate-y-0 disabled:opacity-60">
                {loading ? "Verificando acceso…" : "Ingresar al sistema"}<InstitutionalIcon name="chevronRight" className="h-4 w-4" />
              </button>
            </form>

            <div className="mt-7 flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white/70 px-4 py-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><InstitutionalIcon name="shield" className="h-4 w-4" /></div><div><p className="text-[10px] font-bold text-slate-700">Conexión segura y cifrada</p><p className="mt-0.5 text-[9px] text-slate-400">El acceso y las acciones quedan protegidos.</p></div></div>
          </div>
        </div>

        <footer className="px-6 pb-6 text-center text-[9px] uppercase tracking-[0.14em] text-slate-400">Gobernación de Oruro · Sistema de gestión institucional</footer>
      </section>
    </main>
  );
}
