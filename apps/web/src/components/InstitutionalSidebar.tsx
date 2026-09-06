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
  description?: string;
  soloTransversal?: boolean;
  soloAdmin?: boolean;
  // Lista blanca de roles exactos. Más fino que soloTransversal (que incluye
  // a admin): ej. Despacho es solo gobernador + jefe_gabinete.
  roles?: string[];
  badge?: string;
}

interface NavSeccion {
  title: string;
  items: NavItem[];
}

// Secciones por AUDIENCIA, no por tipo de dato:
//  - Trabajo diario: lo usa todo el mundo (cada quien ve lo suyo por RLS).
//  - Gestión de mi área: contenido/obras/números de la propia secretaría
//    (o de UNICOM). Los transversales acá ven el agregado.
//  - Dirección institucional: solo autoridades (gobernador/jefe_gabinete) y
//    admin -- paneles que cruzan todas las secretarías.
//  - Sistema: solo admin.
// Esto solo ordena qué se muestra; la barrera real es la RLS del backend.
const SECCIONES: NavSeccion[] = [
  {
    title: "Trabajo diario",
    items: [
      { href: "/dashboard", label: "Inicio", icon: "home", description: "Resumen principal y estado del sistema" },
      { href: "/agenda", label: "Agenda", icon: "calendar", description: "Calendario de actividades y compromisos" },
      { href: "/reuniones", label: "Reuniones", icon: "users", description: "Actas y compromisos de reuniones" },
      { href: "/tareas", label: "Tareas", icon: "tasks", description: "Pendientes propios y encargos recibidos" },
    ],
  },
  {
    title: "Gestión de mi área",
    items: [
      { href: "/dashboard#publicaciones", label: "Publicaciones", icon: "megaphone", description: "Comunicados y documentos del área" },
      { href: "/proyectos", label: "Proyectos", icon: "folder", description: "Obras y programas del área, con avance" },
      { href: "/indicadores", label: "Indicadores", icon: "chart", description: "Métricas de gestión: tu área o el consolidado" },
    ],
  },
  {
    title: "Dirección institucional",
    items: [
      { href: "/despacho", label: "Despacho", icon: "layers", description: "Instrucciones del Gobernador y su seguimiento", roles: ["gobernador", "jefe_gabinete"] },
      { href: "/gabinete", label: "Gabinete", icon: "briefcase", description: "Estado agregado de todas las secretarías", soloTransversal: true },
      { href: "/auditoria", label: "Auditoría", icon: "audit", description: "Registro de acciones y trazabilidad", soloTransversal: true },
      { href: "/secretarias", label: "Secretarías", icon: "building", description: "Catálogo de dependencias", soloTransversal: true },
    ],
  },
  {
    title: "Sistema",
    items: [
      { href: "/admin/usuarios", label: "Usuarios", icon: "lock", description: "Control de accesos y permisos", soloAdmin: true },
    ],
  },
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
                ? "border border-[#7CC7F6]/15 bg-[#02183A]/40 text-[#9DA9BB] hover:translate-x-1 hover:border-[#7CC7F6]/30 hover:bg-[#043472]/70 hover:text-[#E3EAEF]"
                : "cursor-not-allowed border border-[#7CC7F6]/5 bg-[#02183A]/20 text-[#9DA9BB]/45"
          } ${presionado ? "sidebar-nav-pressed" : ""}`;

          return item.href ? (
            <Link
              key={item.label}
              href={item.href}
              title={item.description}
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
  // Filtra los items por rol y descarta las secciones que quedan vacías
  // (ej. un operador no ve "Dirección institucional" ni "Sistema").
  const secciones = SECCIONES.map((seccion) => ({
    ...seccion,
    items: seccion.items.filter(
      (item) =>
        (!item.soloTransversal || esTransversal) &&
        (!item.soloAdmin || esAdmin) &&
        (!item.roles || item.roles.includes(rol)),
    ),
  })).filter((seccion) => seccion.items.length > 0);

  return (
    <nav aria-label="Navegación principal" className="institutional-sidebar relative flex h-full flex-col overflow-hidden border-r border-[#37F0FC]/15 bg-gradient-to-b from-[#02224F] via-[#043472]/60 to-[#01142F] text-[#E3EAEF]">
      <div className="sidebar-brand relative flex min-h-[92px] items-center overflow-hidden border-b border-[#7CC7F6]/15 bg-gradient-to-br from-[#043472]/80 via-[#0451A5]/80 to-[#02224F]/80 px-5 backdrop-blur-sm">
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

      <div className="sidebar-menu min-h-0 flex-1 space-y-6 overflow-y-auto bg-transparent px-3 py-5 [scrollbar-color:#0A70D6_transparent] [scrollbar-width:thin] lg:overflow-hidden">
        {secciones.map((seccion) => (
          <MenuGroup
            key={seccion.title}
            title={seccion.title}
            items={seccion.items}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      <div className="sidebar-footer border-t border-[#7CC7F6]/10 bg-gradient-to-t from-[#01142F] to-transparent p-4 pb-6">
        <div className="relative mt-6 flex justify-center">
          {/* Luz de fondo para resaltar la imagen oscura */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="h-28 w-44 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute h-16 w-28 rounded-full bg-[#37F0FC]/15 blur-xl" />
          </div>
          <style>{`
            @keyframes float-img {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-6px); }
            }
            .animate-float-img {
              animation: float-img 4s ease-in-out infinite;
            }
          `}</style>
          <img 
            src="/images/marca_gobierno.png" 
            alt="Marca Gobierno Oruro" 
            className="animate-float-img relative z-10 h-auto w-52 object-contain opacity-100 drop-shadow-[0_4px_12px_rgba(255,255,255,0.15)] transition-all duration-300 hover:scale-110 hover:drop-shadow-[0_8px_16px_rgba(255,255,255,0.3)]" 
          />
        </div>
        
        <p className="mt-6 text-center text-[9px] uppercase tracking-[0.16em] text-[#9DA9BB]/45">Oruro avanza · v1.0</p>
      </div>
    </nav>
  );
}
