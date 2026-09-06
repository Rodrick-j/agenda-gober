"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL, type Compromiso, type Evento, type Proyecto, type Publicacion, type Tarea } from "@/lib/api";

type CambioHandler = (payload: { accion: string; publicacion?: Publicacion; id?: string }) => void;
type EventoCambioHandler = (payload: { accion: string; evento?: Evento; id?: string }) => void;
type TareaCambioHandler = (payload: { accion: string; tarea?: Tarea; id?: string }) => void;
type ProyectoCambioHandler = (payload: { accion: string; proyecto?: Proyecto; id?: string }) => void;
type CompromisoCambioHandler = (payload: { accion: string; compromiso?: Compromiso; id?: string }) => void;

interface RealtimeCtx {
  conectado: boolean;
  onCambio: (handler: CambioHandler) => () => void;
  onEventoCambio: (handler: EventoCambioHandler) => () => void;
  onTareaCambio: (handler: TareaCambioHandler) => () => void;
  onProyectoCambio: (handler: ProyectoCambioHandler) => () => void;
  onCompromisoCambio: (handler: CompromisoCambioHandler) => () => void;
}

const Ctx = createContext<RealtimeCtx | null>(null);

// Una sola conexión WebSocket para todo el panel. Las páginas se suscriben a
// publicacion:cambio / evento:cambio y reciben solo lo que la RLS del
// backend ya autorizó para este usuario (ver pg-listener.service.ts).
export function RealtimeProvider({ token, children }: { token: string; children: React.ReactNode }) {
  const [conectado, setConectado] = useState(false);
  const handlers = useRef(new Set<CambioHandler>());
  const eventoHandlers = useRef(new Set<EventoCambioHandler>());
  const tareaHandlers = useRef(new Set<TareaCambioHandler>());
  const proyectoHandlers = useRef(new Set<ProyectoCambioHandler>());
  const compromisoHandlers = useRef(new Set<CompromisoCambioHandler>());

  useEffect(() => {
    const socket: Socket = io(API_URL, { auth: { token } });
    socket.on("connect", () => setConectado(true));
    socket.on("disconnect", () => setConectado(false));
    socket.on("publicacion:cambio", (payload: { accion: string; publicacion?: Publicacion; id?: string }) => {
      handlers.current.forEach((h) => h(payload));
    });
    socket.on("evento:cambio", (payload: { accion: string; evento?: Evento; id?: string }) => {
      eventoHandlers.current.forEach((h) => h(payload));
    });
    socket.on("tarea:cambio", (payload: { accion: string; tarea?: Tarea; id?: string }) => {
      tareaHandlers.current.forEach((h) => h(payload));
    });
    socket.on("proyecto:cambio", (payload: { accion: string; proyecto?: Proyecto; id?: string }) => {
      proyectoHandlers.current.forEach((h) => h(payload));
    });
    socket.on("compromiso:cambio", (payload: { accion: string; compromiso?: Compromiso; id?: string }) => {
      compromisoHandlers.current.forEach((h) => h(payload));
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

  const onEventoCambio = useCallback((handler: EventoCambioHandler) => {
    eventoHandlers.current.add(handler);
    return () => {
      eventoHandlers.current.delete(handler);
    };
  }, []);

  const onTareaCambio = useCallback((handler: TareaCambioHandler) => {
    tareaHandlers.current.add(handler);
    return () => {
      tareaHandlers.current.delete(handler);
    };
  }, []);

  const onProyectoCambio = useCallback((handler: ProyectoCambioHandler) => {
    proyectoHandlers.current.add(handler);
    return () => {
      proyectoHandlers.current.delete(handler);
    };
  }, []);

  const onCompromisoCambio = useCallback((handler: CompromisoCambioHandler) => {
    compromisoHandlers.current.add(handler);
    return () => {
      compromisoHandlers.current.delete(handler);
    };
  }, []);

  return (
    <Ctx.Provider
      value={{ conectado, onCambio, onEventoCambio, onTareaCambio, onProyectoCambio, onCompromisoCambio }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useRealtime(): RealtimeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRealtime fuera de RealtimeProvider");
  return ctx;
}
