"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { InstitutionalMark } from "@/components/InstitutionalMark";

const BENEFITS = [
  {
    icon: "wifi" as const,
    title: "Coordinación en tiempo real",
    detail: "Información sincronizada",
    accent: "from-[#0451A5]/60 to-[#043472]/75",
    iconStyle: "border-[#37F0FC]/25 bg-[#06E5FA]/10 text-[#37F0FC]",
  },
  {
    icon: "shield" as const,
    title: "Acceso seguro por roles",
    detail: "Permisos verificados",
    accent: "from-[#043472]/80 to-[#0451A5]/55",
    iconStyle: "border-[#7CC7F6]/25 bg-[#2FA1F0]/10 text-[#7CC7F6]",
  },
  {
    icon: "audit" as const,
    title: "Trazabilidad institucional",
    detail: "Actividad registrada",
    accent: "from-[#0451A5]/55 to-[#02224F]/85",
    iconStyle: "border-[#E99D19]/30 bg-[#E99D19]/10 text-[#E99D19]",
  },
];

export function InstitutionalLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <main className="login-shell grid h-[100dvh] min-h-[560px] w-full overflow-hidden bg-[#02224F] text-[#E3EAEF]">
      {/* CSS selecciona automáticamente el arte para celular, tablet o
          escritorio. En celular/tablet ocupa el fondo completo y desde
          escritorio vuelve a ser una columna independiente. */}
      <section className="login-visual relative min-h-0 w-full overflow-hidden animate-fade-in-scale">
        <div
          role="img"
          aria-label="Agenda estratégica y coordinación de gabinete de la Gobernación de Oruro"
          className="login-artwork absolute inset-0"
        />
        <div className="login-visual-vignette pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#37F0FC]/80 to-transparent" />
      </section>

      {/* Panel de acceso */}
      <section className="login-panel relative z-10 flex min-h-0 flex-col overflow-y-auto shadow-[-28px_0_80px_rgba(2,34,79,.5)]">
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <div
            className="absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(55,240,252,.42) 1px, transparent 1px), linear-gradient(90deg, rgba(55,240,252,.42) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />
          <div className="absolute -right-24 -top-32 h-[32rem] w-[32rem] rounded-full bg-[#2FA1F0]/20 blur-[120px] animate-glow-pulse" />
          <div className="absolute -bottom-44 -left-24 h-[28rem] w-[28rem] rounded-full bg-[#0A70D6]/20 blur-[120px]" />
          <div className="absolute right-[8%] top-[23%] h-52 w-52 rounded-full bg-[#06E5FA]/[0.07] blur-[70px]" />
          <div className="absolute -right-16 top-[58%] h-32 w-72 rotate-[-24deg] bg-gradient-to-r from-transparent via-[#ED5611]/[0.045] to-transparent blur-2xl" />
          <div className="absolute left-0 top-0 h-full w-[200%] animate-sweep bg-gradient-to-r from-transparent via-[#37F0FC]/[0.035] to-transparent skew-x-12" />
          
          {/* Animated Background Agenda Icon */}
          <div className="absolute -bottom-[10%] -right-[10%] opacity-[0.03] mix-blend-overlay">
            <svg
              className="h-[50rem] w-[50rem] animate-spin text-[#37F0FC]"
              style={{ animationDuration: '60s' }}
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
        </div>

        <div className="relative z-10 flex flex-1 items-center justify-center px-5 py-7 sm:px-8 sm:py-9 lg:px-10 xl:px-12">
          <div className="w-full max-w-[440px]">
            <div className="mb-6 animate-fade-in-up sm:mb-7">
              <div className="mb-4 sm:mb-5">
                <InstitutionalMark compact />
              </div>
              <div className="flex items-center gap-2.5">
                <span className="h-px w-8 bg-gradient-to-r from-[#37F0FC] to-[#0A70D6]" />
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#37F0FC]">Portal institucional</p>
              </div>
              <h1 className="mt-2.5 text-[1.8rem] font-black leading-tight tracking-[-0.035em] text-[#E3EAEF] drop-shadow-md sm:text-4xl">
                Bienvenido de nuevo
              </h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-[#9DA9BB]">
                Ingresa con tus credenciales autorizadas para acceder al sistema estratégico.
              </p>
            </div>

            <div className="relative overflow-hidden rounded-[1.35rem] border border-[#7CC7F6]/20 bg-gradient-to-br from-[#0451A5]/25 via-[#043472]/45 to-[#02224F]/70 p-5 shadow-[0_24px_80px_rgba(2,34,79,.65),0_0_45px_rgba(6,229,250,.09)] backdrop-blur-xl animate-fade-in-up delay-100 sm:p-6">
              <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-[#06E5FA] via-[#2FA1F0] to-[#E99D19]" />
              <div className="pointer-events-none absolute -right-20 -top-24 h-44 w-44 rounded-full bg-[#06E5FA]/10 blur-3xl" />

              <div className="relative mb-5 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#37F0FC]/25 bg-[#06E5FA]/10 text-[#37F0FC] shadow-[0_0_24px_rgba(6,229,250,.1)]">
                    <InstitutionalIcon name="lock" className="h-[18px] w-[18px]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-[#E3EAEF]">Acceso oficial</p>
                    <p className="mt-0.5 text-[10px] text-[#9DA9BB]">Autenticación institucional</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#37F0FC]/20 bg-[#06E5FA]/[0.08] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#37F0FC]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#06E5FA] shadow-[0_0_8px_rgba(6,229,250,.9)]" />
                  Protegido
                </div>
              </div>

              <form onSubmit={onSubmit} className="relative space-y-4.5">
                <label className="block text-xs font-bold text-[#E3EAEF] group">
                  Correo institucional
                  <div className="relative mt-2">
                    <InstitutionalIcon name="message" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9DA9BB] transition-colors group-focus-within:text-[#37F0FC]" />
                    <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="usuario@gober.local" className="w-full rounded-xl border border-[#7CC7F6]/20 bg-[#02224F]/90 py-3 pl-10 pr-4 text-sm font-semibold text-[#E3EAEF] shadow-[inset_0_1px_4px_rgba(0,0,0,.28)] outline-none transition-all placeholder:font-medium placeholder:text-[#9DA9BB]/60 hover:border-[#7CC7F6]/35 focus:border-[#37F0FC]/75 focus:bg-[#02224F] focus:ring-4 focus:ring-[#06E5FA]/10" />
                  </div>
                </label>
                <label className="block text-xs font-bold text-[#E3EAEF] group">
                  Contraseña
                  <div className="relative mt-2">
                    <InstitutionalIcon name="lock" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9DA9BB] transition-colors group-focus-within:text-[#37F0FC]" />
                    <input type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" className="w-full rounded-xl border border-[#7CC7F6]/20 bg-[#02224F]/90 py-3 pl-10 pr-10 text-sm font-semibold text-[#E3EAEF] shadow-[inset_0_1px_4px_rgba(0,0,0,.28)] outline-none transition-all placeholder:font-medium placeholder:text-[#9DA9BB]/60 hover:border-[#7CC7F6]/35 focus:border-[#37F0FC]/75 focus:bg-[#02224F] focus:ring-4 focus:ring-[#06E5FA]/10" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9DA9BB] transition-colors hover:text-[#37F0FC] focus:outline-none focus:text-[#37F0FC]" aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}>
                      <InstitutionalIcon name={showPassword ? "eyeOff" : "eye"} className="h-4 w-4" />
                    </button>
                  </div>
                </label>

                {error && <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-900/30 backdrop-blur-sm px-4 py-3 text-xs leading-5 text-red-200 animate-fade-in-up"><InstitutionalIcon name="shield" className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

                <button type="submit" disabled={loading} aria-busy={loading} className="group relative mt-5 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-[#37F0FC]/20 bg-gradient-to-r from-[#0A70D6] via-[#2FA1F0] to-[#06E5FA] bg-[length:200%_auto] px-5 py-3.5 text-sm font-extrabold text-[#E3EAEF] shadow-[0_12px_34px_rgba(10,112,214,.32),inset_0_1px_0_rgba(227,234,239,.25)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[position:100%_center] hover:shadow-[0_16px_42px_rgba(6,229,250,.26)] focus:outline-none focus:ring-4 focus:ring-[#06E5FA]/20 disabled:cursor-wait disabled:translate-y-0 disabled:opacity-60">
                  <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                  <span className="relative z-10 flex items-center gap-2">{loading ? "Verificando acceso…" : "Ingresar al sistema"}<InstitutionalIcon name="chevronRight" className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
                </button>
              </form>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 animate-fade-in-up delay-200 sm:mt-5 sm:gap-2.5">
              {BENEFITS.map((benefit) => (
                <div key={benefit.title} className={`rounded-xl border border-[#7CC7F6]/15 bg-gradient-to-br ${benefit.accent} p-2.5 text-center shadow-[0_8px_24px_rgba(2,34,79,.25)] transition hover:-translate-y-0.5 hover:border-[#37F0FC]/30 sm:p-3`}>
                  <div className={`mx-auto mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg border ${benefit.iconStyle}`}>
                    <InstitutionalIcon name={benefit.icon} className="h-3.5 w-3.5" />
                  </div>
                  <p className="text-[9px] font-extrabold leading-tight text-[#E3EAEF]">{benefit.title}</p>
                  <p className="mt-1 hidden text-[8px] leading-tight text-[#9DA9BB] 2xl:block">{benefit.detail}</p>
                </div>
              ))}
            </div>

            <div className="mt-3.5 flex items-center gap-3 rounded-xl border border-[#7CC7F6]/15 bg-[#02224F]/75 px-4 py-3 shadow-[0_10px_30px_rgba(2,34,79,.25)] backdrop-blur animate-fade-in-up delay-300 sm:mt-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#37F0FC]/20 bg-[#06E5FA]/10 text-[#37F0FC]">
                <InstitutionalIcon name="shield" className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#E3EAEF]">Conexión segura y cifrada</p>
                <p className="mt-0.5 text-[9px] text-[#9DA9BB]">El acceso y las acciones quedan protegidos.</p>
              </div>
            </div>
          </div>
        </div>

        <footer className="relative z-10 shrink-0 px-6 pb-4 text-center text-[9px] uppercase tracking-[0.14em] text-[#9DA9BB]/70 animate-fade-in-up delay-400 sm:pb-6">
          Gobernación de Oruro · Sistema de gestión institucional
        </footer>
      </section>
    </main>
  );
}
