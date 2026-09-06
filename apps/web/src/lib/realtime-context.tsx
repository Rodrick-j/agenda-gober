"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  API_URL,
  type Compromiso,
  type Evento,
  type Instruccion,
  type Notificacion,
  type Proyecto,
  type Publicacion,
  type Tarea,
} from "@/lib/api";

type CambioHandler = (payload: { accion: string; publicacion?: Publicacion; id?: string }) => void;
type EventoCambioHandler = (payload: { accion: string; evento?: Evento; id?: string }) => void;
type TareaCambioHandler = (payload: { accion: string; tarea?: Tarea; id?: string }) => void;
type ProyectoCambioHandler = (payload: { accion: string; proyecto?: Proyecto; id?: string }) => void;
type CompromisoCambioHandler = (payload: { accion: string; compromiso?: Compromiso; id?: string }) => void;
type InstruccionCambioHandler = (payload: { accion: string; instruccion?: Instruccion; id?: string }) => void;
type NotificacionHandler = (payload: { notificacion?: Notificacion }) => void;

interface RealtimeCtx {
  conectado: boolean;
  onCambio: (handler: CambioHandler) => () => void;
  onEventoCambio: (handler: EventoCambioHandler) => () => void;
  onTareaCambio: (handler: TareaCambioHandler) => () => void;
  onProyectoCambio: (handler: ProyectoCambioHandler) => () => void;
  onCompromisoCambio: (handler: CompromisoCambioHandler) => () => void;
  onInstruccionCambio: (handler: InstruccionCambioHandler) => () => void;
  onNotificacion: (handler: NotificacionHandler) => () => void;
}

const Ctx = createContext<RealtimeCtx | null>(null);

// Una sola conexión WebSocket para todo el panel. Las páginas se suscriben a
// publicacion:cambio / evento:cambio y reciben solo lo que la RLS del
// backend ya autorizó para este usuario (ver pg-listener.service.ts).
// withCredentials: la cookie httpOnly de la sesión viaja sola en el
// handshake -- no hay token legible por JS que pasarle a mano (ver
// realtime.gateway.ts, que la lee del header cookie del handshake).
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [conectado, setConectado] = useState(false);
  const handlers = useRef(new Set<CambioHandler>());
  const eventoHandlers = useRef(new Set<EventoCambioHandler>());
  const tareaHandlers = useRef(new Set<TareaCambioHandler>());
  const proyectoHandlers = useRef(new Set<ProyectoCambioHandler>());
  const compromisoHandlers = useRef(new Set<CompromisoCambioHandler>());
  const instruccionHandlers = useRef(new Set<InstruccionCambioHandler>());
  const notificacionHandlers = useRef(new Set<NotificacionHandler>());

  useEffect(() => {
    const socket: Socket = io(API_URL, { withCredentials: true });
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
    socket.on("instruccion:cambio", (payload: { accion: string; instruccion?: Instruccion; id?: string }) => {
      instruccionHandlers.current.forEach((h) => h(payload));
    });
    socket.on("notificacion:nueva", (payload: { notificacion?: Notificacion }) => {
      notificacionHandlers.current.forEach((h) => h(payload));
    });
    return () => {
      socket.disconnect();
    };
  }, []);

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

  const onInstruccionCambio = useCallback((handler: InstruccionCambioHandler) => {
    instruccionHandlers.current.add(handler);
    return () => {
      instruccionHandlers.current.delete(handler);
    };
  }, []);

  const onNotificacion = useCallback((handler: NotificacionHandler) => {
    notificacionHandlers.current.add(handler);
    return () => {
      notificacionHandlers.current.delete(handler);
    };
  }, []);

  return (
    <Ctx.Provider
      value={{
        conectado,
        onCambio,
        onEventoCambio,
        onTareaCambio,
        onProyectoCambio,
        onCompromisoCambio,
        onInstruccionCambio,
        onNotificacion,
      }}
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
