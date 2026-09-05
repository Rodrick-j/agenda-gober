"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL, type Publicacion } from "@/lib/api";

type CambioHandler = (payload: { accion: string; publicacion: Publicacion }) => void;

interface RealtimeCtx {
  conectado: boolean;
  onCambio: (handler: CambioHandler) => () => void;
}

const Ctx = createContext<RealtimeCtx | null>(null);

// Una sola conexión WebSocket para todo el panel. Las páginas se suscriben
// al evento publicacion:cambio con onCambio() y reciben solo lo que la RLS
// del backend ya autorizó para este usuario.
export function RealtimeProvider({ token, children }: { token: string; children: React.ReactNode }) {
  const [conectado, setConectado] = useState(false);
  const handlers = useRef(new Set<CambioHandler>());

  useEffect(() => {
    const socket: Socket = io(API_URL, { auth: { token } });
    socket.on("connect", () => setConectado(true));
    socket.on("disconnect", () => setConectado(false));
    socket.on("publicacion:cambio", (payload: { accion: string; publicacion: Publicacion }) => {
      handlers.current.forEach((h) => h(payload));
    });
    return () => {
      socket.disconnect();
    };
  }, [token]);

  const onCambio = useCallback((handler: CambioHandler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  return <Ctx.Provider value={{ conectado, onCambio }}>{children}</Ctx.Provider>;
}

export function useRealtime(): RealtimeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRealtime fuera de RealtimeProvider");
  return ctx;
}
