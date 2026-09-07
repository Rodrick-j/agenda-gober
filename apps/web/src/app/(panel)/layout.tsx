"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getMe, logout as logoutRequest, type SesionUsuario } from "@/lib/api";
import { SessionProvider } from "@/lib/session-context";
import { RealtimeProvider, useRealtime } from "@/lib/realtime-context";
import { InstitutionalSidebar as Sidebar } from "@/components/InstitutionalSidebar";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { NotificacionesBell } from "@/components/NotificacionesBell";

function Topbar({
  sesion,
  sidebarOculto,
  onMenu,
  onLogout,
}: {
  sesion: SesionUsuario;
  sidebarOculto: boolean;
  onMenu: () => void;
  onLogout: () => void;
}) {
  const { conectado } = useRealtime();
  const iniciales = sesion.email.slice(0, 2).toUpperCase();

  return (
    <header className="institutional-header sticky top-0 z-20 isolate flex min-h-[92px] items-center justify-between overflow-visible border-b border-[#37F0FC]/20 bg-[#02224F] px-4 text-[#E3EAEF] shadow-[0_10px_32px_rgba(2,34,79,.2)] sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <button
          onClick={onMenu}
          className="group relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#7CC7F6]/20 bg-[#0451A5]/55 text-[#E3EAEF] shadow-[0_7px_18px_rgba(2,34,79,.22)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#37F0FC]/45 hover:bg-[#0A70D6]/70 hover:shadow-[0_9px_22px_rgba(6,229,250,.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06E5FA]/35"
          aria-label={sidebarOculto ? "Mostrar barra lateral" : "Alternar barra lateral"}
          aria-controls="institutional-sidebar"
        >
          <span className="absolute inset-0 translate-y-full bg-gradient-to-t from-[#06E5FA]/18 to-transparent transition-transform duration-300 group-hover:translate-y-0" />
          <InstitutionalIcon name="menu" className="relative h-5 w-5 transition-transform duration-300 group-hover:scale-110 lg:hidden" />
          <InstitutionalIcon
            name={sidebarOculto ? "chevronRight" : "chevronLeft"}
            className="relative hidden h-5 w-5 transition-transform duration-300 group-hover:scale-110 lg:block"
          />
        </button>

        <div className="relative min-w-0">
          <p className="truncate text-sm font-bold tracking-tight text-[#E3EAEF] sm:text-lg lg:text-xl">
            Sistema de Gestión de Agenda <span className="hidden xl:inline">y Coordinación Institucional</span>
          </p>
          <p className="mt-0.5 hidden text-xs text-[#7CC7F6]/85 sm:block">Unidos por un Oruro con más oportunidades</p>
        </div>
      </div>

      <div className="ml-3 flex shrink-0 items-center gap-2 sm:gap-3 lg:gap-4">
        <div className="hidden items-center gap-2 rounded-full border border-[#7CC7F6]/20 bg-[#043472]/70 px-3 py-1.5 backdrop-blur xl:flex">
          <span className="relative flex h-2 w-2">
            {conectado && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#06E5FA] opacity-75" />}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${conectado ? "bg-[#06E5FA]" : "bg-[#F47A2F]"}`} />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#E3EAEF]/90">{conectado ? "En línea" : "Sin conexión"}</span>
        </div>
        <div className="hidden text-right lg:block">
          <p className="max-w-48 truncate text-xs font-semibold text-[#E3EAEF]" translate="no">
            {sesion.email}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#E99D19]">{sesion.rol}</p>
        </div>
        
        <div className="flex items-center gap-2 border-l border-[#7CC7F6]/20 pl-3 sm:gap-3 sm:pl-4">
          <NotificacionesBell />
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E3EAEF] text-xs font-black text-[#043472] shadow-md ring-2 ring-[#37F0FC]/25"
            translate="no"
          >
            {iniciales}
          </div>
          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-2 rounded-xl border border-[#7CC7F6]/20 bg-[#043472]/65 p-2 text-xs font-semibold text-[#E3EAEF] transition-all hover:border-[#37F0FC]/35 hover:bg-[#0A70D6]/70 focus:outline-none focus:ring-2 focus:ring-[#06E5FA]/25 sm:px-3"
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
  const pathname = usePathname();
  const [sesion, setSesion] = useState<SesionUsuario | null>(null);
  const [verificando, setVerificando] = useState(true);
  const [drawerAbierto, setDrawerAbierto] = useState(false);
  const [sidebarOculto, setSidebarOculto] = useState(false);

  // No hay token que decodificar en el cliente (vive en una cookie httpOnly)
  // -- se le pregunta al backend quién sos según esa cookie. Si no hay
  // sesión válida, /auth/me responde 401 y se manda a login.
  useEffect(() => {
    let cancelado = false;
    getMe()
      .then(({ user }) => {
        if (!cancelado) setSesion(user);
      })
      .catch(() => {
        if (!cancelado) router.replace("/login");
      })
      .finally(() => {
        if (!cancelado) setVerificando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [router]);

  useEffect(() => {
    if (!drawerAbierto) return;

    const previousOverflow = document.body.style.overflow;
    const cerrarConEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerAbierto(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", cerrarConEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", cerrarConEscape);
    };
  }, [drawerAbierto]);

  function alternarNavegacion() {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setSidebarOculto((oculto) => !oculto);
      return;
    }
    setDrawerAbierto(true);
  }

  async function logout() {
    await logoutRequest().catch(() => undefined);
    router.replace("/login");
  }

  if (verificando || !sesion) return null;

  return (
    <SessionProvider value={{ sesion, logout }}>
      <RealtimeProvider>
        <div className="flex min-h-screen bg-[#f2f7fc]">
          {/* Sidebar fijo en desktop */}
          <aside
            id="institutional-sidebar"
            className={`hidden shrink-0 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] lg:block ${sidebarOculto ? "w-0" : "w-[248px]"}`}
          >
            <div
              className={`fixed inset-y-0 left-0 z-30 h-dvh w-[248px] transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${sidebarOculto ? "pointer-events-none -translate-x-[30%] opacity-0" : "translate-x-0 opacity-100"}`}
            >
              <Sidebar rol={sesion.rol} onCollapse={() => setSidebarOculto(true)} />
            </div>
          </aside>

          {/* Drawer en móvil */}
          <div
            aria-hidden={!drawerAbierto}
            className={`fixed inset-0 z-40 transition-[visibility] duration-700 lg:hidden ${drawerAbierto ? "visible" : "invisible delay-700"}`}
          >
            <button
              type="button"
              tabIndex={drawerAbierto ? 0 : -1}
              aria-label="Cerrar menú"
              onClick={() => setDrawerAbierto(false)}
              className={`absolute inset-0 bg-[#02224F]/75 backdrop-blur-sm transition-opacity duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${drawerAbierto ? "opacity-100" : "pointer-events-none opacity-0"}`}
            />
            <aside
              className={`absolute left-0 top-0 h-full w-[min(86vw,290px)] shadow-[30px_0_80px_rgba(2,34,79,.6)] transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${drawerAbierto ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"}`}
            >
              <Sidebar
                rol={sesion.rol}
                onNavigate={() => setDrawerAbierto(false)}
                onCollapse={() => setDrawerAbierto(false)}
              />
            </aside>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar sesion={sesion} sidebarOculto={sidebarOculto} onMenu={alternarNavegacion} onLogout={logout} />
            <main className="flex-1 px-3 py-4 sm:px-5 sm:py-5 xl:px-6">
              <div key={pathname} className="panel-page-enter">
                {children}
              </div>
            </main>
          </div>
        </div>
      </RealtimeProvider>
    </SessionProvider>
  );
}
