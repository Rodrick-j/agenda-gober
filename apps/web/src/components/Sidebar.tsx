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
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          AG
        </div>
        <span className="font-semibold text-slate-900">AGENDA.GOBER</span>
      </div>

      <div className="flex-1 space-y-1 px-3 py-2">
        {items.map((item) => {
          const activo = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                activo
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="border-t border-slate-200 px-5 py-4 text-xs text-slate-400">
        Uso institucional · v0.1
      </div>
    </nav>
  );
}
