"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
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
      // El login setea la cookie httpOnly de sesión; el layout del panel la
      // valida solo (GET /auth/me) al montar, no hace falta guardar nada acá.
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid h-screen overflow-hidden bg-[#f4f7fb] lg:grid-cols-[minmax(0,1.08fr)_minmax(460px,.92fr)]">
      <section className="relative hidden h-full overflow-hidden bg-[#67181a] p-8 text-white lg:flex lg:flex-col lg:justify-between xl:p-12">
        <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-[#9c0720] via-[#ffb843] to-[#4a4848]" />
        
        {/* Textura de la Complementariedad (sutil) */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M54.627 0l1.253 1.252-4.178 4.178 1.252 1.253 4.178-4.178L58.384 3.75 60 2.133 57.866 0h-3.239zM30 60L15 45H0v15h30zM15 0L0 15v15l15-15h15V0H15zM45 60l15-15v-15l-15 15H30v15h15z\' fill=\'%23ffffff\' fill-rule=\'evenodd\'/%3E%3C/svg%3E")', backgroundSize: '60px 60px' }} />
        
        <div className="absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full border border-white/5 bg-gradient-to-br from-white/5 to-transparent" />
        <div className="absolute -right-24 -top-24 h-[360px] w-[360px] rounded-full border border-white/5" />
        <div className="absolute inset-x-0 bottom-0 h-[42%] opacity-40 [background:linear-gradient(145deg,transparent_48%,#9c0720_49%_58%,transparent_59%),linear-gradient(215deg,transparent_47%,#4a4848_48%_57%,transparent_58%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#67181a] to-transparent" />

        <div className="relative">
          <InstitutionalMark vertical />
          <div className="mt-4 h-px w-full bg-gradient-to-r from-white/20 to-transparent" />
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200/70">Gobierno Autónomo Departamental</p>
        </div>

        <div className="relative max-w-xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#ffb843]/30 bg-[#ffb843]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#ffb843]">
            <InstitutionalIcon name="sparkles" className="h-3.5 w-3.5" /> Gestión que transforma
          </div>
          <h1 className="max-w-lg text-4xl font-black leading-[1.08] tracking-[-0.035em] xl:text-5xl">Agenda y coordinación <span className="text-[#ffb843]">institucional</span></h1>
          <p className="mt-4 max-w-lg text-sm leading-6 text-slate-100">Una plataforma central para coordinar, comunicar y dar seguimiento al trabajo de la Gobernación de Oruro.</p>

          <div className="mt-6 grid gap-3 xl:grid-cols-3">
            {BENEFITS.map((benefit) => (
              <div key={benefit.title} className="rounded-2xl border border-white/10 bg-black/10 p-3 backdrop-blur-sm transition hover:bg-black/20 hover:border-white/20">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-[#ffb843]"><InstitutionalIcon name={benefit.icon} className="h-4 w-4" /></div>
                <p className="text-[11px] font-bold text-white">{benefit.title}</p>
                <p className="mt-1 text-[9px] leading-4 text-slate-400">{benefit.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center justify-between text-[9px] uppercase tracking-[0.16em] text-slate-500"><span>Estado · Desarrollo · Gente</span><span>Uso institucional</span></div>
      </section>

      <section className="relative flex h-full flex-col overflow-y-auto">
        <div className="relative flex min-h-[100px] shrink-0 items-center overflow-hidden bg-gradient-to-r from-[#67181a] to-[#9c0720] px-6 lg:hidden animate-fade-in-scale">
          <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full border border-white/10 bg-white/5" />
          <div className="relative"><InstitutionalMark compact /></div>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-8 sm:px-10 lg:px-12">
          <div className="w-full max-w-[430px]">
            <div className="mb-6 animate-fade-in-up">
              <div className="mb-4">
                <InstitutionalMark compact />
              </div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#9c0720]">Portal institucional</p>
              <h2 className="mt-1 text-3xl font-black tracking-tight text-[#4a4848]">Bienvenido de nuevo</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">Ingresa con tus credenciales autorizadas para acceder al sistema.</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4 animate-fade-in-up delay-100 relative">
              {/* Resplandor épico de fondo en el form */}
              <div className="absolute -inset-4 z-[-1] rounded-3xl bg-gradient-to-b from-[#ffb843]/5 to-transparent blur-xl" />

              <label className="block text-xs font-bold text-[#4a4848] group">
                Correo institucional
                <div className="relative mt-2"><InstitutionalIcon name="message" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 group-focus-within:text-[#9c0720] transition-colors" /><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="usuario@gober.local" className="w-full rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm py-3 pl-10 pr-4 text-sm text-[#4a4848] shadow-[0_2px_10px_rgba(0,0,0,.02)] outline-none transition-all placeholder:text-slate-400 focus:border-[#9c0720] focus:ring-4 focus:ring-rose-500/10 focus:bg-white hover:border-[#9c0720]/40" /></div>
              </label>
              <label className="block text-xs font-bold text-[#4a4848] group">
                Contraseña
                <div className="relative mt-2"><InstitutionalIcon name="lock" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 group-focus-within:text-[#9c0720] transition-colors" /><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" className="w-full rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm py-3 pl-10 pr-4 text-sm text-[#4a4848] shadow-[0_2px_10px_rgba(0,0,0,.02)] outline-none transition-all placeholder:text-slate-400 focus:border-[#9c0720] focus:ring-4 focus:ring-rose-500/10 focus:bg-white hover:border-[#9c0720]/40" /></div>
              </label>

              {error && <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700 animate-fade-in-up"><InstitutionalIcon name="shield" className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

              <button type="submit" disabled={loading} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#67181a] via-[#851121] to-[#9c0720] bg-[length:200%_auto] px-5 py-3.5 text-sm font-extrabold text-white shadow-[0_8px_20px_rgba(103,24,26,.25)] transition-all duration-300 hover:bg-[position:100%_center] hover:-translate-y-1 hover:shadow-[0_15px_30px_rgba(103,24,26,.4)] focus:outline-none focus:ring-4 focus:ring-rose-500/20 disabled:cursor-wait disabled:translate-y-0 disabled:opacity-60 relative overflow-hidden group">
                <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                <span className="relative z-10 flex items-center gap-2">{loading ? "Verificando acceso…" : "Ingresar al sistema"}<InstitutionalIcon name="chevronRight" className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
              </button>
            </form>

            <div className="mt-6 flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white/70 backdrop-blur px-4 py-3 animate-fade-in-up delay-200 shadow-sm"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><InstitutionalIcon name="shield" className="h-4 w-4" /></div><div><p className="text-[10px] font-bold text-slate-700">Conexión segura y cifrada</p><p className="mt-0.5 text-[9px] text-slate-400">El acceso y las acciones quedan protegidos.</p></div></div>
          </div>
        </div>

        <footer className="shrink-0 px-6 pb-6 text-center text-[9px] uppercase tracking-[0.14em] text-slate-400 animate-fade-in-up delay-300">Gobernación de Oruro · Sistema de gestión institucional</footer>
      </section>
    </main>
  );
}
