"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cerrarSesion, decodificarSesion, obtenerToken, type SesionUsuario } from "@/lib/auth";
import { SessionProvider } from "@/lib/session-context";
import { RealtimeProvider, useRealtime } from "@/lib/realtime-context";
import { Sidebar } from "@/components/Sidebar";

function Topbar({ sesion, onMenu, onLogout }: { sesion: SesionUsuario; onMenu: () => void; onLogout: () => void }) {
  const { conectado } = useRealtime();
  const iniciales = sesion.email.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200/50 bg-white/75 px-4 py-3 backdrop-blur-md sm:px-6 shadow-sm">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenu}
          className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors lg:hidden"
          aria-label="Abrir menú"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex items-center gap-2 rounded-full border border-slate-200/60 bg-white px-3 py-1 shadow-sm lg:ml-0">
          <span className="relative flex h-2.5 w-2.5">
            {conectado && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${conectado ? "bg-emerald-500" : "bg-red-500"}`}></span>
          </span>
          <span className="text-xs font-medium text-slate-600">
            {conectado ? "Sistema en vivo" : "Desconectado"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-semibold text-slate-800" translate="no">
            {sesion.email}
          </p>
          <p className="text-xs font-medium uppercase tracking-wider text-indigo-500">{sesion.rol}</p>
        </div>
        
        <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-bold text-white shadow-inner shadow-indigo-200"
            translate="no"
          >
            {iniciales}
          </div>
          <button
            onClick={onLogout}
            className="flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            Salir
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
    setToken(t);
    setSesion(s);
  }, [router]);

  function logout() {
    cerrarSesion();
    router.replace("/login");
  }

  if (!token || !sesion) return null;

  return (
    <SessionProvider value={{ token, sesion, logout }}>
      <RealtimeProvider token={token}>
        <div className="flex min-h-screen bg-slate-50">
          {/* Sidebar fijo en desktop */}
          <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
            <div className="sticky top-0 h-screen">
              <Sidebar rol={sesion.rol} />
            </div>
          </aside>

          {/* Drawer en móvil */}
          {drawerAbierto && (
            <div className="fixed inset-0 z-30 lg:hidden">
              <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerAbierto(false)} />
              <aside className="absolute left-0 top-0 h-full w-64 bg-white shadow-xl">
                <Sidebar rol={sesion.rol} onNavigate={() => setDrawerAbierto(false)} />
              </aside>
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar sesion={sesion} onMenu={() => setDrawerAbierto(true)} onLogout={logout} />
            <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          </div>
        </div>
      </RealtimeProvider>
    </SessionProvider>
  );
}
