"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cerrarSesion, decodificarSesion, obtenerToken, type SesionUsuario } from "@/lib/auth";
import { SessionProvider } from "@/lib/session-context";
import { RealtimeProvider, useRealtime } from "@/lib/realtime-context";
import { InstitutionalSidebar as Sidebar } from "@/components/InstitutionalSidebar";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";

function Topbar({ sesion, onMenu, onLogout }: { sesion: SesionUsuario; onMenu: () => void; onLogout: () => void }) {
  const { conectado } = useRealtime();
  const iniciales = sesion.email.slice(0, 2).toUpperCase();

  return (
    <header className="institutional-header sticky top-0 z-20 flex min-h-[92px] items-center justify-between overflow-hidden border-b border-white/10 bg-[#6f0b2b] px-4 text-white shadow-lg shadow-slate-950/10 sm:px-6">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenu}
          className="rounded-xl border border-white/10 bg-white/10 p-2 text-white transition-colors hover:bg-white/20 lg:hidden"
          aria-label="Abrir menú"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="relative min-w-0">
          <p className="truncate text-sm font-bold tracking-tight text-white sm:text-lg lg:text-xl">
            Sistema de Gestión de Agenda <span className="hidden xl:inline">y Coordinación Institucional</span>
          </p>
          <p className="mt-0.5 hidden text-xs text-rose-100/80 sm:block">Unidos por un Oruro con más oportunidades</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 backdrop-blur sm:flex">
          <span className="relative flex h-2 w-2">
            {conectado && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${conectado ? "bg-emerald-300" : "bg-red-300"}`} />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/85">{conectado ? "En línea" : "Sin conexión"}</span>
        </div>
        <div className="hidden text-right sm:block">
          <p className="max-w-48 truncate text-xs font-semibold text-white" translate="no">
            {sesion.email}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">{sesion.rol}</p>
        </div>
        
        <div className="flex items-center gap-2 border-l border-white/15 pl-3 sm:gap-3 sm:pl-4">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-xs font-black text-[#6f0b2b] shadow-md ring-2 ring-white/20"
            translate="no"
          >
            {iniciales}
          </div>
          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 p-2 text-xs font-semibold text-white transition-all hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 sm:px-3"
          >
            <InstitutionalIcon name="logout" className="h-4 w-4" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [sesion, setSesion] = useState<SesionUsuario | null>(null);
  const [drawerAbierto, setDrawerAbierto] = useState(false);

  useEffect(() => {
    const t = obtenerToken();
    const s = t ? decodificarSesion(t) : null;
    if (!t || !s) {
      router.replace("/login");
      return;
    }
    queueMicrotask(() => {
      setToken(t);
      setSesion(s);
    });
  }, [router]);

  function logout() {
    cerrarSesion();
    router.replace("/login");
  }

  if (!token || !sesion) return null;

  return (
    <SessionProvider value={{ token, sesion, logout }}>
      <RealtimeProvider token={token}>
        <div className="flex min-h-screen bg-[#f4f7fb]">
          {/* Sidebar fijo en desktop */}
          <aside className="hidden w-[248px] shrink-0 lg:block">
            <div className="sticky top-0 h-screen">
              <Sidebar rol={sesion.rol} />
            </div>
          </aside>

          {/* Drawer en móvil */}
          {drawerAbierto && (
            <div className="fixed inset-0 z-30 lg:hidden">
              <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerAbierto(false)} />
              <aside className="absolute left-0 top-0 h-full w-[272px] shadow-2xl">
                <Sidebar rol={sesion.rol} onNavigate={() => setDrawerAbierto(false)} />
              </aside>
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar sesion={sesion} onMenu={() => setDrawerAbierto(true)} onLogout={logout} />
            <main className="flex-1 px-3 py-4 sm:px-5 sm:py-5 xl:px-6">{children}</main>
          </div>
        </div>
      </RealtimeProvider>
    </SessionProvider>
  );
}
