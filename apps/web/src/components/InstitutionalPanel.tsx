import type { ReactNode } from "react";
import { InstitutionalIcon, type IconName } from "@/components/InstitutionalIcon";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_5px_24px_rgba(15,23,42,.045)] ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelTitle({ icon, title, action }: { icon: IconName; title: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <InstitutionalIcon name={icon} className="h-[18px] w-[18px] shrink-0 text-[#0d4d91]" />
        <h2 className="truncate text-sm font-extrabold text-[#102a4c]">{title}</h2>
      </div>
      {action}
    </div>
  );
}
