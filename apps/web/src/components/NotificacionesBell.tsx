"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getConteoNotificaciones,
  getNotificaciones,
  marcarNotificacionLeida,
  marcarTodasNotificacionesLeidas,
  type Notificacion,
} from "@/lib/api";
import { useRealtime } from "@/lib/realtime-context";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";

const SILENCIO_KEY = "despacho:silencio";

function leerSilencio(): boolean {
  try {
    return localStorage.getItem(SILENCIO_KEY) === "1";
  } catch {
    return false;
  }
}

// Tono corto sintetizado -- sin archivo que cargar (la CSP del panel no
// bloquea nada acá, pero igual es más liviano y no depende de un asset).
function reproducirTono() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => ctx.close().catch(() => undefined);
  } catch {
    /* el navegador puede bloquear el audio hasta el primer gesto: no pasa nada */
  }
}

interface Toast {
  id: string;
  titulo: string;
  cuerpo: string | null;
  enlace: string | null;
}

export function NotificacionesBell() {
  const router = useRouter();
  const { onNotificacion } = useRealtime();

  const [abierto, setAbierto] = useState(false);
  const [items, setItems] = useState<Notificacion[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [silencio, setSilencio] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSilencio(leerSilencio());
  }, []);

  const cargar = useCallback(async () => {
    try {
      const [lista, conteo] = await Promise.all([
        getNotificaciones().catch(() => [] as Notificacion[]),
        getConteoNotificaciones().catch(() => ({ noLeidas: 0 })),
      ]);
      setItems(lista.slice(0, 20));
      setNoLeidas(conteo.noLeidas);
    } catch {
      /* la campana es accesoria: si falla, no rompe el panel */
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Llega una notificación en vivo: la sumamos, sonamos y mostramos un toast.
  useEffect(() => {
    return onNotificacion(({ notificacion }) => {
      if (!notificacion) return;
      setItems((prev) => [notificacion, ...prev.filter((n) => n.id !== notificacion.id)].slice(0, 20));
      setNoLeidas((n) => n + 1);
      if (!leerSilencio()) reproducirTono();
      const t: Toast = {
        id: notificacion.id,
        titulo: notificacion.titulo,
        cuerpo: notificacion.cuerpo,
        enlace: notificacion.enlace,
      };
      setToasts((prev) => [...prev, t]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 6000);
    });
  }, [onNotificacion]);

  // Cerrar el desplegable al hacer clic afuera.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  async function abrir(n: Notificacion) {
    if (!n.leida) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, leida: true } : x)));
      setNoLeidas((c) => Math.max(0, c - 1));
      await marcarNotificacionLeida(n.id).catch(() => undefined);
    }
    setAbierto(false);
    if (n.enlace) router.push(n.enlace);
  }

  async function leerTodas() {
    setItems((prev) => prev.map((x) => ({ ...x, leida: true })));
    setNoLeidas(0);
    await marcarTodasNotificacionesLeidas().catch(() => undefined);
  }

  function alternarSilencio() {
    const nuevo = !silencio;
    setSilencio(nuevo);
    try {
      localStorage.setItem(SILENCIO_KEY, nuevo ? "1" : "0");
    } catch {
      /* modo privado: se queda solo en memoria */
    }
  }

  function abrirToast(t: Toast) {
    setToasts((prev) => prev.filter((x) => x.id !== t.id));
    if (t.enlace) router.push(t.enlace);
  }

  return (
    <>
      <div ref={contenedorRef} className="relative">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-label={`Notificaciones${noLeidas ? `, ${noLeidas} sin leer` : ""}`}
          className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-[#7CC7F6]/20 bg-[#043472]/65 text-[#E3EAEF] transition-all hover:border-[#37F0FC]/35 hover:bg-[#0A70D6]/70 focus:outline-none focus:ring-2 focus:ring-[#06E5FA]/25"
        >
          <InstitutionalIcon name="bell" className="h-4 w-4" />
          {noLeidas > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#F47A2F] px-1 text-[10px] font-bold text-white">
              {noLeidas > 9 ? "9+" : noLeidas}
            </span>
          )}
        </button>

        {abierto && (
          <div className="absolute right-0 top-11 z-50 w-[min(88vw,360px)] overflow-hidden rounded-2xl border border-[#7CC7F6]/20 bg-[#02224F] text-[#E3EAEF] shadow-[0_24px_60px_rgba(2,34,79,.5)]">
            <div className="flex items-center justify-between border-b border-[#7CC7F6]/15 px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#7CC7F6]/85">Notificaciones</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={alternarSilencio}
                  title={silencio ? "Activar sonido" : "Silenciar sonido"}
                  className="rounded-lg p-1 text-[#9DA9BB] transition hover:text-[#37F0FC]"
                >
                  <InstitutionalIcon name={silencio ? "eyeOff" : "wifi"} className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={leerTodas}
                  className="text-[11px] font-semibold text-[#37F0FC] hover:underline"
                >
                  Marcar todo leído
                </button>
              </div>
            </div>
            <ul className="max-h-[60vh] divide-y divide-[#7CC7F6]/10 overflow-y-auto">
              {items.length === 0 && (
                <li className="px-4 py-8 text-center text-xs text-[#9DA9BB]">Sin notificaciones</li>
              )}
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => abrir(n)}
                    className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left transition hover:bg-[#043472]/70 ${
                      n.leida ? "opacity-60" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-semibold">
                      {!n.leida && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#06E5FA]" />}
                      {n.titulo}
                    </span>
                    {n.cuerpo && <span className="line-clamp-2 text-xs text-[#9DA9BB]">{n.cuerpo}</span>}
                    <span className="text-[10px] uppercase tracking-wide text-[#7CC7F6]/60">
                      {new Date(n.created_at).toLocaleString("es-BO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(90vw,340px)] flex-col gap-2">
          {toasts.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => abrirToast(t)}
              className="pointer-events-auto flex flex-col gap-0.5 rounded-xl border border-[#37F0FC]/25 bg-[#02224F] px-4 py-3 text-left text-[#E3EAEF] shadow-[0_18px_44px_rgba(2,34,79,.45)] transition hover:border-[#37F0FC]/50"
            >
              <span className="flex items-center gap-2 text-[13px] font-bold">
                <InstitutionalIcon name="bell" className="h-3.5 w-3.5 text-[#37F0FC]" />
                {t.titulo}
              </span>
              {t.cuerpo && <span className="line-clamp-2 text-xs text-[#9DA9BB]">{t.cuerpo}</span>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
