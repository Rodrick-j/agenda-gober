"use client";

import { createContext, useContext } from "react";
import type { SesionUsuario } from "@/lib/api";

interface SessionCtx {
  sesion: SesionUsuario;
  logout: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ value, children }: { value: SessionCtx; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession fuera de SessionProvider");
  return ctx;
}
