"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { InstitutionalIcon, type IconName } from "@/components/InstitutionalIcon";
import { InstitutionalMark } from "@/components/InstitutionalMark";
import { rangoDeRol } from "@/lib/roles";

interface NavItem {
  href?: string;
  label: string;
  icon: IconName;
  soloTransversal?: boolean;
  soloAdmin?: boolean;
  badge?: string;
}

const NAV_PRINCIPAL: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: "home" },
  { href: "/agenda", label: "Agenda", icon: "calendar" },
  { href: "/reuniones", label: "Reuniones", icon: "users" },
  { href: "/gabinete", label: "Gabinete", icon: "briefcase", soloTransversal: true },
];

const NAV_GESTION: NavItem[] = [
  { href: "/dashboard#publicaciones", label: "Publicaciones", icon: "megaphone" },
  { href: "/secretarias", label: "Secretarías", icon: "building" },
  { href: "/auditoria", label: "Auditoría", icon: "audit", soloTransversal: true },
  { href: "/proyectos", label: "Proyectos", icon: "folder" },
  { href: "/tareas", label: "Tareas", icon: "tasks" },
  { href: "/indicadores", label: "Indicadores", icon: "chart" },
  { href: "/admin/usuarios", label: "Usuarios", icon: "lock", soloAdmin: true },
];

interface Props {
  rol: string;
  onNavigate?: () => void;
  onCollapse?: () => void;
}

function MenuGroup({ title, items, pathname, onNavigate }: { title: string; items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  const [pressedHref, setPressedHref] = useState<string | null>(null);

  return (
    <div>
      <p className="mb-2 px-4 text-[10px] font-bold uppercase tracking-[0.19em] text-[#7CC7F6]/70">{title}</p>
      <div className="space-y-1">
        {items.map((item) => {
          const activo = Boolean(item.href && pathname === item.href.split("#")[0] && !item.href.includes("#"));
          const presionado = item.href === pressedHref;
          const content = (
            <>
              <span className="sidebar-nav-icon relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-300 group-hover:bg-[#06E5FA]/10 group-hover:text-[#37F0FC]">
                <InstitutionalIcon name={item.icon} className="h-[18px] w-[18px]" />
              </span>
              <span className="relative z-10 min-w-0 flex-1 truncate">{item.label}</span>
              {item.badge && (
                <span className="relative z-10 rounded-full border border-[#7CC7F6]/15 bg-[#043472]/60 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-[#9DA9BB]">{item.badge}</span>
              )}
              {activo && <span className="relative z-10 h-1.5 w-1.5 rounded-full bg-[#06E5FA] shadow-[0_0_10px_rgba(6,229,250,.9)]" />}
            </>
          );
          const classes = `sidebar-nav-link group relative isolate flex w-full items-center gap-2 overflow-hidden rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-all duration-300 active:scale-[.97] ${
            activo
              ? "sidebar-nav-active border border-[#37F0FC]/25 bg-gradient-to-r from-[#0A70D6] to-[#0451A5] text-[#E3EAEF] shadow-[0_8px_24px_rgba(10,112,214,.28)]"
              : item.href
                ? "border border-transparent text-[#9DA9BB] hover:translate-x-1 hover:border-[#7CC7F6]/15 hover:bg-[#043472]/65 hover:text-[#E3EAEF]"
                : "cursor-not-allowed border border-transparent text-[#9DA9BB]/45"
          } ${presionado ? "sidebar-nav-pressed" : ""}`;

          return item.href ? (
            <Link
              key={item.label}
              href={item.href}
              onPointerDown={() => setPressedHref(item.href ?? null)}
              onClick={onNavigate}
              onAnimationEnd={(event) => {
                if (event.currentTarget === event.target) setPressedHref(null);
              }}
              className={classes}
            >
              {content}
            </Link>
          ) : (
            <button key={item.label} className={classes} disabled title="Módulo planificado">{content}</button>
          );
        })}
      </div>
    </div>
  );
}

export function InstitutionalSidebar({ rol, onNavigate, onCollapse }: Props) {
  const pathname = usePathname();
  const esTransversal = rangoDeRol(rol) >= 99;
  const esAdmin = rol === "admin";
  const principal = NAV_PRINCIPAL.filter((item) => !item.soloTransversal || esTransversal);
  const gestion = NAV_GESTION.filter((item) => (!item.soloTransversal || esTransversal) && (!item.soloAdmin || esAdmin));

  return (
    <nav aria-label="Navegación principal" className="institutional-sidebar relative flex h-full flex-col overflow-hidden border-r border-[#37F0FC]/15 bg-[#02224F] text-[#E3EAEF]">
      <div className="relative flex min-h-[92px] items-center overflow-hidden border-b border-[#7CC7F6]/15 bg-gradient-to-br from-[#043472] via-[#0451A5] to-[#02224F] px-5">
        <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full border border-[#37F0FC]/15 bg-[#06E5FA]/[0.03]" />
        <div className="absolute -right-2 top-8 h-16 w-16 rounded-full border border-[#E99D19]/20" />
        <div className="relative"><InstitutionalMark compact /></div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Ocultar barra lateral"
            title="Ocultar barra lateral"
            className="group absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-xl border border-[#37F0FC]/20 bg-[#02224F]/45 text-[#7CC7F6] shadow-lg backdrop-blur transition-all duration-300 hover:scale-105 hover:border-[#37F0FC]/45 hover:bg-[#0A70D6]/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06E5FA]/40"
          >
            <InstitutionalIcon name="chevronLeft" className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-0.5" />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto bg-gradient-to-b from-[#02224F] to-[#021B40] px-3 py-5 [scrollbar-color:#0A70D6_transparent] [scrollbar-width:thin]">
        <MenuGroup title="Navegación" items={principal} pathname={pathname} onNavigate={onNavigate} />
        <MenuGroup title="Gestión institucional" items={gestion} pathname={pathname} onNavigate={onNavigate} />
      </div>

      <div className="border-t border-[#7CC7F6]/10 bg-[#021B40] p-4">
        <div className="relative overflow-hidden rounded-2xl border border-[#7CC7F6]/15 bg-[#043472]/45 p-3.5 shadow-[0_10px_28px_rgba(2,34,79,.32)]">
          <div className="absolute -bottom-8 -right-5 h-20 w-20 rounded-full bg-[#E99D19]/10 blur-xl" />
          <div className="relative flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#06E5FA]/10 text-[#37F0FC] ring-1 ring-[#37F0FC]/20">
              <InstitutionalIcon name="shield" className="h-[18px] w-[18px]" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#E99D19]">Entorno protegido</p>
              <p className="mt-0.5 text-[9px] uppercase tracking-[0.15em] text-[#9DA9BB]">Uso institucional</p>
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-[9px] uppercase tracking-[0.16em] text-[#9DA9BB]/45">Oruro avanza · v1.0</p>
      </div>
    </nav>
  );
}
