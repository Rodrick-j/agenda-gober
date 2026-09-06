"use client";

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
  badge?: string;
}

const NAV_PRINCIPAL: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: "home" },
  { href: "/agenda", label: "Agenda", icon: "calendar" },
  { label: "Reuniones", icon: "users", badge: "Pronto" },
  { label: "Gabinete", icon: "briefcase", badge: "Pronto" },
];

const NAV_GESTION: NavItem[] = [
  { href: "/dashboard#publicaciones", label: "Publicaciones", icon: "megaphone" },
  { href: "/secretarias", label: "Secretarías", icon: "building" },
  { href: "/auditoria", label: "Auditoría", icon: "audit", soloTransversal: true },
  { label: "Proyectos", icon: "folder", badge: "Pronto" },
  { href: "/tareas", label: "Tareas", icon: "tasks" },
  { label: "Indicadores", icon: "chart", badge: "Pronto" },
];

interface Props {
  rol: string;
  onNavigate?: () => void;
}

function MenuGroup({ title, items, pathname, onNavigate }: { title: string; items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <div>
      <p className="mb-2 px-4 text-[10px] font-bold uppercase tracking-[0.19em] text-slate-500">{title}</p>
      <div className="space-y-1">
        {items.map((item) => {
          const activo = Boolean(item.href && pathname === item.href.split("#")[0] && !item.href.includes("#"));
          const content = (
            <>
              <InstitutionalIcon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.badge && (
                <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-slate-500">{item.badge}</span>
              )}
              {activo && <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,.9)]" />}
            </>
          );
          const classes = `flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-[13px] font-medium transition-all ${
            activo
              ? "bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-950/25"
              : item.href
                ? "text-slate-300 hover:bg-white/[0.07] hover:text-white"
                : "cursor-not-allowed text-slate-500"
          }`;

          return item.href ? (
            <Link key={item.label} href={item.href} onClick={onNavigate} className={classes}>{content}</Link>
          ) : (
            <button key={item.label} className={classes} disabled title="Módulo planificado">{content}</button>
          );
        })}
      </div>
    </div>
  );
}

export function InstitutionalSidebar({ rol, onNavigate }: Props) {
  const pathname = usePathname();
  const esTransversal = rangoDeRol(rol) >= 99;
  const gestion = NAV_GESTION.filter((item) => !item.soloTransversal || esTransversal);

  return (
    <nav className="flex h-full flex-col overflow-hidden bg-[#081c33] text-white">
      <div className="relative flex min-h-[92px] items-center overflow-hidden border-b border-white/10 bg-gradient-to-br from-[#7d092a] via-[#67051f] to-[#430419] px-5">
        <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full border border-white/10" />
        <div className="absolute -right-2 top-8 h-16 w-16 rounded-full border border-amber-300/10" />
        <div className="relative"><InstitutionalMark compact /></div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-5 [scrollbar-color:#29405a_transparent] [scrollbar-width:thin]">
        <MenuGroup title="Navegación" items={NAV_PRINCIPAL} pathname={pathname} onNavigate={onNavigate} />
        <MenuGroup title="Gestión institucional" items={gestion} pathname={pathname} onNavigate={onNavigate} />
      </div>

      <div className="border-t border-white/[0.08] p-4">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05] p-3.5">
          <div className="absolute -bottom-8 -right-5 h-20 w-20 rounded-full bg-cyan-400/10 blur-xl" />
          <div className="relative flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-300/15">
              <InstitutionalIcon name="shield" className="h-[18px] w-[18px]" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-200">Entorno protegido</p>
              <p className="mt-0.5 text-[9px] uppercase tracking-[0.15em] text-slate-500">Uso institucional</p>
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-[9px] uppercase tracking-[0.16em] text-slate-600">Oruro avanza · v1.0</p>
      </div>
    </nav>
  );
}
