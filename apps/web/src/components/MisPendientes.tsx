"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getPendientes, type Pendientes } from "@/lib/api";
import { COBERTURA_ESTADO_LABEL } from "@/lib/comunicacion";
import { useRealtime } from "@/lib/realtime-context";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-BO", { day: "numeric", month: "short" });
}

interface Item {
  clave: string;
  texto: string;
  meta?: string;
  alerta?: boolean;
  // Enlace al registro exacto (no solo al módulo en general) -- ej. la
  // bandeja de solicitudes de agenda abre directo el evento puntual.
  href?: string;
}

function Grupo({
  titulo,
  href,
  items,
  tono,
}: {
  titulo: string;
  href: string;
  items: Item[];
  tono: string;
}) {
  if (items.length === 0) return null;
  const visibles = items.slice(0, 4);
  const resto = items.length - visibles.length;
  return (
    <div>
      <Link
        href={href}
        className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-[#0d5fc1]"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${tono}`} />
        {titulo}
        <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">{items.length}</span>
      </Link>
      <ul className="space-y-1">
        {visibles.map((it) => {
          const contenido = (
            <>
              <span className={`mt-1 h-1 w-1 shrink-0 rounded-full ${it.alerta ? "bg-red-500" : "bg-slate-300"}`} />
              <span className="min-w-0 flex-1 truncate">
                {it.texto}
                {it.meta && (
                  <span className={`ml-1.5 text-[10px] ${it.alerta ? "font-bold text-red-600" : "text-slate-400"}`}>
                    {it.meta}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={it.clave} className="flex items-start gap-2 text-xs text-[#183558]">
              {it.href ? (
                <Link href={it.href} className="flex min-w-0 flex-1 items-start gap-2 hover:text-[#0d5fc1]">
                  {contenido}
                </Link>
              ) : (
                contenido
              )}
            </li>
          );
        })}
      </ul>
      {resto > 0 && (
        <Link href={href} className="mt-1 block text-[10px] font-semibold text-[#0d5fc1] hover:underline">
          +{resto} más
        </Link>
      )}
    </div>
  );
}

export function MisPendientes() {
  const { onCambio, onTareaCambio, onCompromisoCambio, onEventoCambio } = useRealtime();
  const [data, setData] = useState<Pendientes | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setData(await getPendientes());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Refresca cuando algo se mueve en los módulos que alimentan la bandeja, y
  // al volver a la pestaña.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const refrescar = () => {
      clearTimeout(t);
      t = setTimeout(() => void cargar(), 400);
    };
    const offs = [
      onCambio(refrescar),
      onTareaCambio(refrescar),
      onCompromisoCambio(refrescar),
      onEventoCambio(refrescar),
    ];
    const onVis = () => document.visibilityState === "visible" && refrescar();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      offs.forEach((off) => off());
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [cargar, onCambio, onTareaCambio, onCompromisoCambio, onEventoCambio]);

  if (cargando || error || !data) {
    if (error) return null; // no estorbar el panel si el endpoint falla
    return <div className="mb-4 h-24 animate-pulse rounded-2xl bg-slate-100" />;
  }

  const p = data.publicaciones;
  const grupos: { titulo: string; href: string; tono: string; items: Item[] }[] = [
    {
      titulo: "Por revisar",
      href: "/dashboard#publicaciones",
      tono: "bg-amber-400",
      items: p.porRevisar.map((x) => ({ clave: x.id, texto: x.titulo, meta: fechaCorta(x.updated_at) })),
    },
    {
      titulo: "Por publicar",
      href: "/dashboard#publicaciones",
      tono: "bg-sky-400",
      items: p.porPublicar.map((x) => ({ clave: x.id, texto: x.titulo, meta: fechaCorta(x.aprobado_at) })),
    },
    {
      titulo: "Devueltas a vos",
      href: "/dashboard#publicaciones",
      tono: "bg-rose-400",
      items: p.rechazadas.map((x) => ({
        clave: x.id,
        texto: x.titulo,
        meta: x.motivo_rechazo ?? undefined,
        alerta: true,
      })),
    },
    {
      titulo: "Tus tareas",
      href: "/tareas",
      tono: "bg-[#0d5fc1]",
      items: data.tareas.map((x) => ({
        clave: x.id,
        texto: x.titulo,
        meta: x.fecha_vencimiento ? (x.vencida ? `vencida ${fechaCorta(x.fecha_vencimiento)}` : `vence ${fechaCorta(x.fecha_vencimiento)}`) : undefined,
        alerta: x.vencida,
      })),
    },
    {
      titulo: "Tus compromisos",
      href: "/reuniones",
      tono: "bg-emerald-400",
      items: data.compromisos.map((x) => ({
        clave: x.id,
        texto: x.descripcion,
        meta: x.fecha_limite ? (x.vencido ? `vencido ${fechaCorta(x.fecha_limite)}` : `vence ${fechaCorta(x.fecha_limite)}`) : x.reunion ?? undefined,
        alerta: x.vencido,
      })),
    },
    {
      titulo: "Comunicación",
      href: "/comunicacion",
      tono: "bg-fuchsia-400",
      items: data.comunicacion.map((x) => ({
        clave: x.id,
        texto: x.evento_titulo ?? "Cobertura",
        meta: COBERTURA_ESTADO_LABEL[x.estado],
      })),
    },
    {
      titulo: "Solicitudes de agenda",
      href: "/agenda",
      tono: "bg-teal-400",
      items: data.agenda.solicitudesPorRevisar.map((x) => ({
        clave: x.id,
        texto: x.titulo,
        meta: x.fecha_inicio
          ? `${x.estado} · ${fechaCorta(x.fecha_inicio)}`
          : `${x.estado} · sin horario`,
        href: `/agenda?evento=${x.id}`,
      })),
    },
    {
      titulo: "Tus solicitudes",
      href: "/agenda",
      tono: "bg-cyan-400",
      items: data.agenda.misSolicitudes
        .filter((x) => x.estado !== "confirmado")
        .map((x) => ({
          clave: x.id,
          texto: x.titulo,
          meta: x.fecha_inicio ? `${x.estado} · ${fechaCorta(x.fecha_inicio)}` : x.estado,
          href: `/agenda?evento=${x.id}`,
        })),
    },
    {
      titulo: "Indicaciones del Gobernador",
      href: "/agenda",
      tono: "bg-amber-400",
      items: data.agenda.indicacionesPendientes.map((x) => ({
        clave: x.id,
        texto: `${x.evento_titulo} — ${x.tipo}`,
        meta: `${x.texto.slice(0, 40)}${x.texto.length > 40 ? "…" : ""}`,
        alerta: true,
        href: `/agenda?evento=${x.evento_id}`,
      })),
    },
  ];

  const conItems = grupos.filter((g) => g.items.length > 0);

  return (
    <Panel className="mb-4">
      <PanelTitle
        icon="tasks"
        title="Mi bandeja"
        action={
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              data.total > 0 ? "bg-[#0d5fc1] text-white" : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {data.total > 0 ? `${data.total} pendiente${data.total === 1 ? "" : "s"}` : "Al día"}
          </span>
        }
      />
      {conItems.length === 0 ? (
        <div className="flex items-center gap-2.5 p-5 text-xs text-slate-500">
          <InstitutionalIcon name="check" className="h-4 w-4 text-emerald-500" />
          No tenés nada esperando tu acción.
        </div>
      ) : (
        <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {conItems.map((g) => (
            <Grupo key={g.titulo} titulo={g.titulo} href={g.href} items={g.items} tono={g.tono} />
          ))}
        </div>
      )}
    </Panel>
  );
}
