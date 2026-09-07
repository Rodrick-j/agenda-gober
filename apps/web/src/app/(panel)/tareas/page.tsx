"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  actualizarTarea,
  asignarTarea,
  crearTarea,
  eliminarTarea,
  getDespachoItemsPorTareas,
  getMiembros,
  getTareas,
  solicitarValidacionItem,
  subirEvidencia,
  type CrearTareaInput,
  type DespachoItemDeTarea,
  type ItemEstadoValidacion,
  type NivelConfidencialidad,
  type Participante,
  type Tarea,
  type TareaEstado,
  type TareaPrioridad,
} from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { useRealtime } from "@/lib/realtime-context";
import { rangoDeRol } from "@/lib/roles";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

const COLUMNAS: { estado: TareaEstado; titulo: string; dot: string }[] = [
  { estado: "pendiente", titulo: "Pendientes", dot: "bg-[#9DA9BB]" },
  { estado: "en_progreso", titulo: "En progreso", dot: "bg-[#E99D19]" },
  { estado: "completada", titulo: "Completadas", dot: "bg-[#06E5FA]" },
  { estado: "cancelada", titulo: "Canceladas", dot: "bg-[#F47A2F]" },
];

const PRIORIDAD_ESTILO: Record<TareaPrioridad, string> = {
  baja: "bg-[#E3EAEF] text-[#52647c] ring-[#9DA9BB]/35",
  media: "bg-[#2FA1F0]/10 text-[#0451A5] ring-[#2FA1F0]/30",
  alta: "bg-[#F47A2F]/10 text-[#c34f12] ring-[#F47A2F]/35",
};

const SIGUIENTE_ESTADO: Partial<Record<TareaEstado, TareaEstado>> = {
  pendiente: "en_progreso",
  en_progreso: "completada",
};

function venceEn(fecha: string | null): { texto: string; vencida: boolean } | null {
  if (!fecha) return null;
  const d = new Date(fecha);
  const dias = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (dias < 0) return { texto: `Venció hace ${Math.abs(dias)} d`, vencida: true };
  if (dias === 0) return { texto: "Vence hoy", vencida: false };
  return { texto: `Vence en ${dias} d`, vencida: false };
}

const VAL_LABEL: Record<ItemEstadoValidacion, string> = {
  en_curso: "En curso",
  pendiente_validacion: "Esperando validación de Gabinete",
  validado: "Validado",
  devuelto: "Devuelto por Gabinete",
};
const VAL_CLS: Record<ItemEstadoValidacion, string> = {
  en_curso: "bg-[#E3EAEF] text-[#52647c]",
  pendiente_validacion: "bg-[#E99D19]/15 text-[#a67200]",
  validado: "bg-[#2FBF71]/15 text-[#1c7a46]",
  devuelto: "bg-[#F47A2F]/15 text-[#a63c0d]",
};

// Bloque del Despacho dentro de una tarjeta de tarea: el responsable adjunta
// evidencia y pide la validación sin salir de Tareas.
function DespachoBloque({
  info,
  puedeActuar,
  subiendo,
  onSubir,
  onPedir,
}: {
  info: DespachoItemDeTarea;
  puedeActuar: boolean;
  subiendo: boolean;
  onSubir: (f: File) => void;
  onPedir: () => void;
}) {
  const abierto = info.estado_validacion === "en_curso" || info.estado_validacion === "devuelto";
  return (
    <div className="mt-2 rounded-lg border border-[#0A70D6]/20 bg-[#0A70D6]/[0.05] p-2">
      <p className="flex flex-wrap items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-wide text-[#0451A5]">
        <InstitutionalIcon name="layers" className="h-3 w-3" /> Despacho
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] normal-case ${VAL_CLS[info.estado_validacion]}`}>
          {VAL_LABEL[info.estado_validacion]}
        </span>
      </p>
      {info.estado_validacion === "devuelto" && info.motivo_devolucion && (
        <p className="mt-1 text-[10px] text-[#a63c0d]">Motivo: {info.motivo_devolucion}</p>
      )}
      {puedeActuar && abierto && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <label className="cursor-pointer rounded-md border border-[#7CC7F6]/50 bg-white px-2 py-1 text-[10px] font-bold text-[#0451A5] transition hover:bg-[#f5f9fd]">
            {subiendo ? "Subiendo…" : `Adjuntar evidencia (${info.evidencias_count})`}
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onSubir(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            disabled={info.evidencias_count === 0}
            onClick={onPedir}
            className="rounded-md border border-[#E99D19]/50 bg-[#E99D19]/10 px-2 py-1 text-[10px] font-bold text-[#a67200] transition hover:bg-[#E99D19]/20 disabled:opacity-50"
          >
            Pedir validación
          </button>
        </div>
      )}
    </div>
  );
}

export default function TareasPage() {
  const { sesion } = useSession();
  const { onTareaCambio } = useRealtime();

  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [miembros, setMiembros] = useState<Participante[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<Tarea | null>(null);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [prioridad, setPrioridad] = useState<TareaPrioridad>("media");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [nivel, setNivel] = useState<NivelConfidencialidad>("interna");
  const [asignadoIds, setAsignadoIds] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const tituloInputRef = useRef<HTMLInputElement>(null);

  const [despacho, setDespacho] = useState<Record<string, DespachoItemDeTarea>>({});
  const [subiendoTarea, setSubiendoTarea] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [t, m] = await Promise.all([getTareas(), getMiembros().catch(() => [] as Participante[])]);
      setTareas(t);
      setMiembros(m);
      const disp = await getDespachoItemsPorTareas(t.map((x) => x.id)).catch(
        () => ({}) as Record<string, DespachoItemDeTarea>,
      );
      setDespacho(disp);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando las tareas");
    } finally {
      setCargando(false);
    }
  }, []);

  async function onSubirEvidencia(tareaId: string, itemId: string, file: File) {
    setSubiendoTarea(tareaId);
    setError(null);
    try {
      await subirEvidencia(itemId, file);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la evidencia");
    } finally {
      setSubiendoTarea(null);
    }
  }

  async function onPedirValidacion(itemId: string) {
    setError(null);
    try {
      await solicitarValidacionItem(itemId);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo pedir la validación");
    }
  }

  useEffect(() => {
    queueMicrotask(() => void cargar());
  }, [cargar]);

  const miRango = rangoDeRol(sesion.rol);
  const rangoDirector = rangoDeRol("director");
  // Espejo de fn_validar_edicion_tarea: transversal, o tu secretaria + rango
  // director+. Solo evita mostrar un boton "Editar" que el backend igual
  // rechazaria (un asignado sin ese rango solo puede tocar el estado, ya
  // resuelto con los botones Iniciar/Completar/Cancelar de la tarjeta).
  function puedeGestionar(t: Tarea) {
    return miRango >= 99 || (miRango >= rangoDirector && t.secretaria_id === sesion.secretariaId);
  }

  useEffect(() => {
    if (!mostrarForm) return;

    const previousOverflow = document.body.style.overflow;
    const focusFrame = requestAnimationFrame(() => tituloInputRef.current?.focus());
    const cerrarConEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMostrarForm(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", cerrarConEscape);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", cerrarConEscape);
    };
  }, [mostrarForm]);

  // Mismo canal RLS-filtrado que Agenda/Publicaciones: si el backend no te
  // manda la fila (RLS la bloqueó) simplemente no llega nada acá.
  useEffect(
    () =>
      onTareaCambio(({ tarea, id }) => {
        setTareas((prev) => {
          if (!tarea) return id ? prev.filter((t) => t.id !== id) : prev;
          const idx = prev.findIndex((t) => t.id === tarea.id);
          if (idx === -1) return [tarea, ...prev];
          const copy = [...prev];
          copy[idx] = tarea;
          return copy;
        });
      }),
    [onTareaCambio],
  );

  const porColumna = useMemo(() => {
    const map = new Map<TareaEstado, Tarea[]>();
    for (const col of COLUMNAS) map.set(col.estado, []);
    for (const t of tareas) map.get(t.estado)?.push(t);
    return map;
  }, [tareas]);

  function abrirNueva() {
    setError(null);
    setEditando(null);
    setTitulo("");
    setDescripcion("");
    setPrioridad("media");
    setFechaVencimiento("");
    setNivel("interna");
    setAsignadoIds([]);
    setMostrarForm(true);
  }

  function abrirEditar(t: Tarea) {
    setError(null);
    setEditando(t);
    setTitulo(t.titulo);
    setDescripcion(t.descripcion ?? "");
    setPrioridad(t.prioridad);
    setFechaVencimiento(t.fecha_vencimiento ? t.fecha_vencimiento.slice(0, 10) : "");
    setNivel(t.nivel_confidencialidad);
    setAsignadoIds(t.asignados.map((a) => a.id));
    setMostrarForm(true);
  }

  function toggleAsignado(id: string) {
    setAsignadoIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onGuardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const payload: CrearTareaInput = {
        titulo,
        descripcion: descripcion || undefined,
        prioridad,
        fechaVencimiento: fechaVencimiento ? new Date(`${fechaVencimiento}T00:00:00`).toISOString() : undefined,
        nivelConfidencialidad: nivel,
      };
      if (editando) {
        await actualizarTarea(editando.id, payload);
        await asignarTarea(editando.id, asignadoIds);
      } else {
        const nueva = await crearTarea(payload);
        if (asignadoIds.length > 0) await asignarTarea(nueva.id, asignadoIds);
      }
      setMostrarForm(false);
      // El tiempo real cubre a los demás usuarios conectados, pero acá
      // refrescamos de una para no depender de la secuencia exacta de
      // notificaciones (crear + asignar son dos requests, dos commits).
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la tarea");
    } finally {
      setGuardando(false);
    }
  }

  // RLS + el trigger fn_validar_edicion_tarea deciden de verdad qué se puede
  // tocar (asignado sin rango director solo puede mover el estado); esto es
  // solo para que el botón exista en la tarjeta.
  async function onAvanzar(t: Tarea) {
    const siguiente = SIGUIENTE_ESTADO[t.estado];
    if (!siguiente) return;
    setError(null);
    try {
      await actualizarTarea(t.id, { estado: siguiente });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la tarea");
    }
  }

  async function onCancelar(t: Tarea) {
    setError(null);
    try {
      await actualizarTarea(t.id, { estado: "cancelada" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cancelar la tarea");
    }
  }

  async function onEliminar(id: string) {
    setError(null);
    try {
      await eliminarTarea(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la tarea");
    }
  }

  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-[#7CC7F6]/45 bg-[#f5f9fd] px-3.5 py-2.5 text-sm font-medium text-[#02224F] outline-none transition placeholder:text-[#9DA9BB] hover:border-[#2FA1F0]/55 focus:border-[#0A70D6] focus:bg-white focus:ring-3 focus:ring-[#2FA1F0]/15";

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0A70D6]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#06E5FA] shadow-[0_0_10px_rgba(6,229,250,.85)]" /> Seguimiento institucional
          </div>
          <h1 className="text-xl font-black tracking-tight text-[#02224F] sm:text-2xl">Tareas</h1>
          <p className="mt-1 text-xs text-slate-500">Pendientes de tu secretaría y lo que te asignaron de otras áreas.</p>
        </div>
        <button
          onClick={abrirNueva}
          aria-haspopup="dialog"
          aria-controls="tarea-dialog"
          className="group inline-flex items-center justify-center gap-3 rounded-2xl border border-[#37F0FC]/25 bg-gradient-to-r from-[#0A70D6] to-[#0451A5] px-3.5 py-2.5 text-left text-white shadow-[0_12px_28px_rgba(10,112,214,.24)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(10,112,214,.3)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#2FA1F0]/30"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 transition group-hover:bg-white/15">
            <InstitutionalIcon name="plus" className="h-4 w-4" />
          </span>
          <span className="pr-1">
            <span className="block text-xs font-extrabold leading-tight">Nueva tarea</span>
            <span className="mt-0.5 block text-[9px] font-medium leading-tight text-[#E3EAEF]/80">Asignar seguimiento</span>
          </span>
        </button>
      </div>

      {error && !mostrarForm && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {COLUMNAS.map((col) => {
          const items = porColumna.get(col.estado) ?? [];
          return (
            <Panel key={col.estado} className="flex min-h-[330px] flex-col border-[#7CC7F6]/20 shadow-[0_10px_30px_rgba(2,34,79,.06)]">
              <PanelTitle
                icon="tasks"
                title={col.titulo}
                action={<span className={`h-2 w-2 rounded-full shadow-[0_0_9px_currentColor] ${col.dot}`} />}
              />
              <div className="flex-1 space-y-2 p-3">
                {cargando ? (
                  [0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />)
                ) : items.length === 0 ? (
                  <p className="py-8 text-center text-[10px] font-semibold text-slate-400">Sin tareas acá</p>
                ) : (
                  items.map((t) => {
                    const vence = venceEn(t.fecha_vencimiento);
                    const siguiente = SIGUIENTE_ESTADO[t.estado];
                    return (
                      <div key={t.id} className="rounded-xl border border-[#7CC7F6]/20 bg-gradient-to-br from-white to-[#f4f8fd] p-3 shadow-[0_5px_16px_rgba(2,34,79,.05)] transition duration-200 hover:-translate-y-0.5 hover:border-[#2FA1F0]/35 hover:shadow-[0_9px_22px_rgba(2,34,79,.09)]">
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <p className="text-xs font-bold text-[#183558]">{t.titulo}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold capitalize ring-1 ring-inset ${PRIORIDAD_ESTILO[t.prioridad]}`}>
                            {t.prioridad}
                          </span>
                        </div>
                        {t.descripcion && <p className="mb-1.5 text-[10px] text-slate-500">{t.descripcion}</p>}
                        {t.asignados.length > 0 && (
                          <p className="mb-1.5 truncate text-[10px] font-semibold text-[#0A70D6]" title={t.asignados.map((a) => a.nombre).join(", ")}>
                            Asignado a {t.asignados.map((a) => a.nombre).join(", ")}
                          </p>
                        )}
                        {vence && (
                          <p className={`mb-1.5 text-[10px] font-bold ${vence.vencida ? "text-red-600" : "text-slate-400"}`}>
                            {vence.texto}
                          </p>
                        )}
                        {despacho[t.id] && (
                          <DespachoBloque
                            info={despacho[t.id]}
                            puedeActuar={miRango < 99}
                            subiendo={subiendoTarea === t.id}
                            onSubir={(f) => onSubirEvidencia(t.id, despacho[t.id].id, f)}
                            onPedir={() => onPedirValidacion(despacho[t.id].id)}
                          />
                        )}
                        {(t.estado === "pendiente" || t.estado === "en_progreso") && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {siguiente && (
                              <button
                                onClick={() => onAvanzar(t)}
                                className="rounded-lg border border-[#2FA1F0]/35 bg-[#2FA1F0]/10 px-2.5 py-1.5 text-[10px] font-extrabold text-[#0451A5] transition hover:border-[#0A70D6]/45 hover:bg-[#2FA1F0]/18"
                              >
                                {siguiente === "en_progreso" ? "Iniciar" : "Marcar completada"}
                              </button>
                            )}
                            {puedeGestionar(t) && (
                              <button
                                onClick={() => abrirEditar(t)}
                                className="rounded-lg border border-[#9DA9BB]/35 bg-white px-2.5 py-1.5 text-[10px] font-extrabold text-[#52647c] transition hover:border-[#7CC7F6] hover:bg-[#f5f9fd]"
                              >
                                Editar
                              </button>
                            )}
                            <button
                              onClick={() => onCancelar(t)}
                              className="rounded-lg border border-[#9DA9BB]/35 bg-white px-2.5 py-1.5 text-[10px] font-extrabold text-[#52647c] transition hover:border-[#7CC7F6] hover:bg-[#f5f9fd]"
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                        {(t.estado === "completada" || t.estado === "cancelada") && (
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => onEliminar(t.id)}
                              className="rounded-lg border border-[#F47A2F]/35 bg-[#F47A2F]/8 px-2.5 py-1.5 text-[10px] font-extrabold text-[#c34f12] transition hover:border-[#ED5611]/50 hover:bg-[#F47A2F]/14"
                            >
                              Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      {mostrarForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <button
            type="button"
            aria-label="Cerrar ventana de tarea"
            onClick={() => setMostrarForm(false)}
            className="absolute inset-0 cursor-default bg-[#02224F]/72 backdrop-blur-[5px]"
          />

          <form
            id="tarea-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tarea-dialog-title"
            onSubmit={onGuardar}
            className="animate-fade-in-up relative flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.75rem] border border-[#7CC7F6]/30 bg-white shadow-[0_30px_90px_rgba(2,34,79,.48)] sm:rounded-[1.75rem]"
          >
            <div className="h-1 shrink-0 bg-gradient-to-r from-[#06E5FA] via-[#2FA1F0] to-[#E99D19]" />

            <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#043472] via-[#0451A5] to-[#02224F] px-5 py-5 text-white sm:px-7">
              <div className="pointer-events-none absolute -right-14 -top-20 h-44 w-44 rounded-full border border-[#37F0FC]/15" />
              <div className="pointer-events-none absolute -right-3 -top-10 h-28 w-28 rounded-full border border-[#E99D19]/12" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3.5">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#37F0FC]/30 bg-[#06E5FA]/10 text-[#37F0FC] shadow-[0_0_24px_rgba(6,229,250,.12)]">
                    <InstitutionalIcon name="tasks" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#37F0FC]">Seguimiento institucional</p>
                    <h2 id="tarea-dialog-title" className="text-lg font-black tracking-tight sm:text-xl">{editando ? "Editar tarea" : "Crear nueva tarea"}</h2>
                    <p className="mt-1 text-[11px] font-medium text-[#E3EAEF]/75">
                      Define claramente la prioridad, el plazo y el nivel de acceso.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMostrarForm(false)}
                  aria-label="Cerrar"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/8 text-[#E3EAEF] transition hover:border-[#37F0FC]/35 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37F0FC]/50"
                >
                  <InstitutionalIcon name="plus" className="h-4 w-4 rotate-45" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto bg-[linear-gradient(145deg,#ffffff_0%,#f4f8fd_100%)] px-5 py-5 sm:px-7 sm:py-6">
              <div className="mb-4 flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#0A70D6]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#06E5FA] shadow-[0_0_8px_rgba(6,229,250,.8)]" />
                Información de la tarea
              </div>

              {error && (
                <div role="alert" className="mb-4 flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs font-semibold text-red-700">
                  <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                <label className="block text-xs font-extrabold text-[#02224F] sm:col-span-2">
                  Título <span className="text-[#0A70D6]">*</span>
                  <input
                    ref={tituloInputRef}
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                    required
                    placeholder="Ej. Revisar informe presupuestario"
                    className={fieldClass}
                  />
                </label>

                <label className="block text-xs font-extrabold text-[#02224F]">
                  Prioridad
                  <select
                    value={prioridad}
                    onChange={(e) => setPrioridad(e.target.value as TareaPrioridad)}
                    className={fieldClass}
                  >
                    <option value="baja">Baja</option>
                    <option value="media">Media</option>
                    <option value="alta">Alta</option>
                  </select>
                </label>

                <label className="block text-xs font-extrabold text-[#02224F]">
                  Fecha de vencimiento
                  <input
                    type="date"
                    value={fechaVencimiento}
                    onChange={(e) => setFechaVencimiento(e.target.value)}
                    className={fieldClass}
                  />
                </label>

                <label className="block text-xs font-extrabold text-[#02224F] sm:col-span-2">
                  Confidencialidad
                  <select
                    value={nivel}
                    onChange={(e) => setNivel(e.target.value as NivelConfidencialidad)}
                    className={fieldClass}
                  >
                    <option value="publica">Pública</option>
                    <option value="interna">Interna</option>
                    <option value="reservada">Reservada</option>
                    <option value="confidencial">Confidencial</option>
                  </select>
                </label>

                <label className="block text-xs font-extrabold text-[#02224F] sm:col-span-2">
                  Descripción
                  <textarea
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    rows={3}
                    placeholder="Describe el objetivo, alcance o instrucciones principales..."
                    className={`${fieldClass} min-h-24 resize-y leading-relaxed`}
                  />
                </label>

                <div className="sm:col-span-2">
                  <p className="text-xs font-extrabold text-[#02224F]">Responsables</p>
                  <p className="mt-0.5 text-[10px] text-[#71829a]">
                    Quien asignes puede marcar el avance de esta tarea aunque no tenga tu rango.
                  </p>
                  {miembros.length === 0 ? (
                    <p className="mt-2 text-[10px] text-[#9DA9BB]">Sin compañeros de secretaría para asignar todavía.</p>
                  ) : (
                    <div className="mt-2 flex max-h-32 flex-col gap-1 overflow-y-auto rounded-xl border border-[#7CC7F6]/45 bg-[#f5f9fd] p-2">
                      {miembros.map((m) => (
                        <label key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-[#02224F] hover:bg-white">
                          <input
                            type="checkbox"
                            checked={asignadoIds.includes(m.id)}
                            onChange={() => toggleAsignado(m.id)}
                            className="h-3.5 w-3.5 rounded border-[#9DA9BB] accent-[#0A70D6]"
                          />
                          <span className="truncate">{m.nombre}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-3 border-t border-[#7CC7F6]/25 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div className="hidden items-center gap-2 text-[10px] font-medium text-[#71829a] sm:flex">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2FA1F0]/10 text-[#0A70D6]">
                  <InstitutionalIcon name="shield" className="h-3.5 w-3.5" />
                </span>
                La tarea quedará registrada y protegida.
              </div>
              <div className="flex gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={() => setMostrarForm(false)}
                  className="flex-1 rounded-xl border border-[#9DA9BB]/45 bg-white px-4 py-2.5 text-xs font-extrabold text-[#52647c] transition hover:border-[#7CC7F6] hover:bg-[#f5f9fd] sm:flex-none"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#37F0FC]/25 bg-gradient-to-r from-[#0A70D6] to-[#0451A5] px-5 py-2.5 text-xs font-extrabold text-white shadow-[0_8px_20px_rgba(10,112,214,.22)] transition hover:-translate-y-0.5 hover:shadow-[0_11px_24px_rgba(10,112,214,.28)] disabled:cursor-wait disabled:translate-y-0 disabled:opacity-60 sm:flex-none"
                >
                  <InstitutionalIcon name={guardando ? "clock" : "check"} className="h-4 w-4" />
                  {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear tarea"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
