"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { rangoDeRol } from "@/lib/roles";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  soloTransversal?: boolean;
}

const ICON = "h-5 w-5 shrink-0";

const NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Publicaciones",
    icon: (
      <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    href: "/secretarias",
    label: "Secretarías",
    icon: (
      <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 11h.01M15 11h.01" />
      </svg>
    ),
  },
  {
    href: "/auditoria",
    label: "Auditoría",
    soloTransversal: true,
    icon: (
      <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

interface Props {
  rol: string;
  onNavigate?: () => void;
}

export function Sidebar({ rol, onNavigate }: Props) {
  const pathname = usePathname();
  const esTransversal = rangoDeRol(rol) >= 99;
  const items = NAV.filter((i) => !i.soloTransversal || esTransversal);

  return (
    <nav className="flex h-full flex-col bg-white shadow-sm ring-1 ring-slate-200/50">
      <div className="flex items-center gap-3 px-6 py-6 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-200">
          <span className="text-sm font-black tracking-tight text-white">AG</span>
        </div>
        <span className="font-bold text-slate-800 tracking-tight text-lg">AGENDA.GOBER</span>
      </div>

      <div className="flex-1 space-y-1.5 px-4 py-2">
        {items.map((item) => {
          const activo = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`group flex items-center gap-3.5 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${
                activo
                  ? "bg-indigo-50 text-indigo-700 shadow-sm ring-1 ring-indigo-100"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <div className={`${activo ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600"} transition-colors`}>
                {item.icon}
              </div>
              {item.label}
              {activo && (
                <div className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-600 shadow-[0_0_8px_rgba(79,70,229,0.6)]"></div>
              )}
            </Link>
          );
        })}
      </div>

      <div className="border-t border-slate-100 p-5 mt-4">
        <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/50">
          <p className="text-xs font-semibold text-slate-600">Uso Institucional</p>
          <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest font-mono">v0.1-beta</p>
        </div>
      </div>
    </nav>
  );
}
