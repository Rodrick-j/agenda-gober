"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  actualizarEvento,
  crearEvento,
  getMesaTrabajo,
  type EventoEstado,
  type MesaTrabajoFila,
  type MesaTrabajoFiltro,
} from "@/lib/api";
import { useRealtime } from "@/lib/realtime-context";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { Panel } from "@/components/InstitutionalPanel";

const ESTADOS: EventoEstado[] = [
  "solicitud",
  "tentativo",
  "confirmado",
  "cancelado",
  "realizado",
  "no_realizado",
];

const ESTADO_LABEL: Record<EventoEstado, string> = {
  solicitud: "Solicitud",
  tentativo: "Tentativo",
  confirmado: "Confirmado",
  cancelado: "Cancelado",
  realizado: "Realizado",
  no_realizado: "No realizado",
};

const ESTADO_ESTILO: Record<EventoEstado, string> = {
  solicitud: "bg-slate-100 text-slate-600 ring-slate-200",
  tentativo: "bg-amber-50 text-amber-800 ring-amber-200",
  confirmado: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cancelado: "bg-red-50 text-red-700 ring-red-200",
  realizado: "bg-blue-50 text-blue-700 ring-blue-200",
  no_realizado: "bg-slate-100 text-slate-500 ring-slate-200",
};

function fechaHora(fila: MesaTrabajoFila): string {
  if (!fila.fecha_inicio) return "Sin horario";
  const d = new Date(fila.fecha_inicio);
  return d.toLocaleString("es-BO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface CampoEdicion {
  filaId: string;
  campo: "titulo" | "lugar" | "organizacion_solicitante";
}

interface Props {
  onAbrirEvento: (id: string) => void;
}

// Mesa de trabajo: vista de tabla sobre los MISMOS eventos_agenda del
// calendario -- no duplica datos, no inventa un "responsable" a partir de
// ser invitado (evento_responsables es participación; "responsable_apoyo"
// sale de evento_colaboradores, trabajo delegado -- ver eventos.service.ts,
// mesaTrabajo()). Las acciones controladas (confirmar/cancelar/reprogramar,
// con detección de cruces e indicaciones) NO se reimplementan acá -- abren
// el mismo diálogo del calendario vía onAbrirEvento.
export function MesaTrabajoAgenda({ onAbrirEvento }: Props) {
  const { onEventoCambio } = useRealtime();

  const [filas, setFilas] = useState<MesaTrabajoFila[]>([]);
  const [total, setTotal] = useState(0);
  const [paginas, setPaginas] = useState(1);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [busquedaDebounced, setBusquedaDebounced] = useState("");
  const [estadosFiltro, setEstadosFiltro] = useState<Set<EventoEstado>>(new Set());
  const [soloSinHorario, setSoloSinHorario] = useState(false);
  const [soloIndicacionesPendientes, setSoloIndicacionesPendientes] = useState(false);
  const [participaGobernadorFiltro, setParticipaGobernadorFiltro] = useState<
    "todos" | "si" | "no"
  >("todos");
  const [responsableFiltro, setResponsableFiltro] = useState<string>("");

  // Se acumulan (nunca se achican) para que el filtro de responsable no
  // colapse a una sola opción apenas se filtra por esa misma persona.
  const [responsablesConocidos, setResponsablesConocidos] = useState<
    Map<string, string>
  >(new Map());

  // Registro corto (punto 5 del alcance): solo título + organización,
  // nace como 'solicitud' -- misma idea que el registro de apoyo, disponible
  // acá para que la Jefa no tenga que abrir el diálogo completo para algo
  // que todavía no tiene ni horario ni casi ningún dato.
  const [mostrarAlta, setMostrarAlta] = useState(false);
  const [altaTitulo, setAltaTitulo] = useState("");
  const [altaOrganizacion, setAltaOrganizacion] = useState("");
  const [creando, setCreando] = useState(false);

  const [edicion, setEdicion] = useState<CampoEdicion | null>(null);
  const [valorEdicion, setValorEdicion] = useState("");
  const [guardandoCelda, setGuardandoCelda] = useState(false);
  const [erroresCelda, setErroresCelda] = useState<Record<string, string>>({});

  const contenedorRef = useRef<HTMLDivElement>(null);
  const scrollPreservado = useRef(0);
  // Guarda contra el doble envío: al deshabilitar el input (guardando=true)
  // el navegador le quita el foco automáticamente, lo que dispara onBlur
  // ADEMÁS del onKeyDown de Enter que ya inició el guardado -- sin esto,
  // la segunda llamada manda el mismo ifUpdatedAt ya vencido y choca (409)
  // contra su propio primer guardado.
  const guardandoCeldaRef = useRef(false);

  // Búsqueda con debounce -- evita un fetch por cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounced(busqueda), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const filtro: MesaTrabajoFiltro = {
        busqueda: busquedaDebounced || undefined,
        estado: estadosFiltro.size > 0 ? [...estadosFiltro] : undefined,
        sinHorario: soloSinHorario ? true : undefined,
        conIndicacionPendiente: soloIndicacionesPendientes ? true : undefined,
        participaGobernador:
          participaGobernadorFiltro === "todos"
            ? undefined
            : participaGobernadorFiltro === "si",
        responsableApoyoId: responsableFiltro || undefined,
        pagina,
        porPagina: 20,
      };
      const res = await getMesaTrabajo(filtro);
      setFilas(res.datos);
      setTotal(res.total);
      setPaginas(res.paginas);
      setResponsablesConocidos((prev) => {
        const copia = new Map(prev);
        for (const f of res.datos) {
          if (f.responsable_apoyo_id && f.responsable_apoyo_nombre) {
            copia.set(f.responsable_apoyo_id, f.responsable_apoyo_nombre);
          }
        }
        return copia;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando la mesa de trabajo");
    } finally {
      setCargando(false);
    }
  }, [
    busquedaDebounced,
    estadosFiltro,
    soloSinHorario,
    soloIndicacionesPendientes,
    participaGobernadorFiltro,
    responsableFiltro,
    pagina,
  ]);

  useEffect(() => {
    queueMicrotask(() => void cargar());
  }, [cargar]);

  // Cambiar cualquier filtro vuelve a la página 1 (evita quedar en una
  // página vacía si el filtro nuevo trae menos resultados).
  useEffect(() => {
    setPagina(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    busquedaDebounced,
    estadosFiltro,
    soloSinHorario,
    soloIndicacionesPendientes,
    participaGobernadorFiltro,
    responsableFiltro,
  ]);

  // Tiempo real: cualquier cambio (de este módulo o de otra persona) vuelve
  // a pedir la página actual -- los filtros/búsqueda no viajan en el
  // payload de tiempo real, así que reconstruirlo a mano sería adivinar.
  // Se preserva el scroll del contenedor para no "saltar" cuando llega un
  // cambio ajeno mientras se está mirando la lista.
  useEffect(
    () =>
      onEventoCambio(() => {
        scrollPreservado.current = contenedorRef.current?.scrollTop ?? 0;
        void cargar().then(() => {
          requestAnimationFrame(() => {
            if (contenedorRef.current) {
              contenedorRef.current.scrollTop = scrollPreservado.current;
            }
          });
        });
      }),
    [onEventoCambio, cargar],
  );

  function toggleEstado(e: EventoEstado) {
    setEstadosFiltro((prev) => {
      const copia = new Set(prev);
      if (copia.has(e)) copia.delete(e);
      else copia.add(e);
      return copia;
    });
  }

  function limpiarFiltros() {
    setBusqueda("");
    setEstadosFiltro(new Set());
    setSoloSinHorario(false);
    setSoloIndicacionesPendientes(false);
    setParticipaGobernadorFiltro("todos");
    setResponsableFiltro("");
  }

  const hayFiltrosActivos =
    busqueda !== "" ||
    estadosFiltro.size > 0 ||
    soloSinHorario ||
    soloIndicacionesPendientes ||
    participaGobernadorFiltro !== "todos" ||
    responsableFiltro !== "";

  async function registrarSolicitud() {
    if (!altaTitulo.trim()) {
      setError("Escribe al menos un asunto.");
      return;
    }
    setCreando(true);
    setError(null);
    try {
      await crearEvento({
        titulo: altaTitulo.trim(),
        organizacionSolicitante: altaOrganizacion.trim() || undefined,
        nivelConfidencialidad: "interna",
        estado: "solicitud",
      });
      setAltaTitulo("");
      setAltaOrganizacion("");
      setMostrarAlta(false);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la solicitud");
    } finally {
      setCreando(false);
    }
  }

  function abrirEdicionCelda(fila: MesaTrabajoFila, campo: CampoEdicion["campo"]) {
    setEdicion({ filaId: fila.id, campo });
    setValorEdicion(
      campo === "titulo"
        ? fila.titulo
        : campo === "lugar"
          ? (fila.lugar ?? "")
          : (fila.organizacion_solicitante ?? ""),
    );
  }

  async function guardarCelda(fila: MesaTrabajoFila) {
    if (!edicion || guardandoCeldaRef.current) return;
    guardandoCeldaRef.current = true;
    const campo = edicion.campo;
    setGuardandoCelda(true);
    setErroresCelda((prev) => ({ ...prev, [fila.id]: "" }));
    try {
      const actualizado = await actualizarEvento(fila.id, {
        [campo === "titulo"
          ? "titulo"
          : campo === "lugar"
            ? "lugar"
            : "organizacionSolicitante"]: valorEdicion,
        ifUpdatedAt: fila.updated_at,
      } as Parameters<typeof actualizarEvento>[1]);
      setFilas((prev) =>
        prev.map((f) =>
          f.id === fila.id
            ? {
                ...f,
                titulo: actualizado.titulo,
                lugar: actualizado.lugar,
                organizacion_solicitante: actualizado.organizacion_solicitante,
                updated_at: actualizado.updated_at,
              }
            : f,
        ),
      );
      setEdicion(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setErroresCelda((prev) => ({
          ...prev,
          [fila.id]:
            "Esto cambió en el servidor mientras lo editabas -- recarga la fila antes de reintentar.",
        }));
        void cargar();
      } else {
        setErroresCelda((prev) => ({
          ...prev,
          [fila.id]: err instanceof Error ? err.message : "No se pudo guardar",
        }));
      }
    } finally {
      guardandoCeldaRef.current = false;
      setGuardandoCelda(false);
    }
  }

  const opcionesResponsable = useMemo(
    () => [...responsablesConocidos.entries()],
    [responsablesConocidos],
  );

  return (
    <Panel className="border-slate-300 bg-white shadow-[0_14px_40px_rgba(15,42,76,.09)]">
      <div className="border-b border-slate-100 p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-sm">
            <InstitutionalIcon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por asunto, organización o lugar…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs font-medium text-[#183558] outline-none focus:border-[#0A70D6] focus:bg-white focus:ring-3 focus:ring-[#2FA1F0]/15"
            />
          </div>
          <button
            type="button"
            onClick={() => setMostrarAlta((v) => !v)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[#37F0FC]/25 bg-gradient-to-r from-[#0A70D6] to-[#0451A5] px-3.5 py-2 text-xs font-extrabold text-white shadow-[0_8px_20px_rgba(10,112,214,0.2)] transition hover:-translate-y-0.5"
          >
            <InstitutionalIcon name="plus" className="h-4 w-4" />
            Registrar solicitud
          </button>
        </div>

        {mostrarAlta && (
          <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input
                value={altaTitulo}
                onChange={(e) => setAltaTitulo(e.target.value)}
                placeholder="Asunto"
                className="rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-medium text-[#183558] outline-none focus:border-[#0A70D6]"
              />
              <input
                value={altaOrganizacion}
                onChange={(e) => setAltaOrganizacion(e.target.value)}
                placeholder="Organización solicitante (opcional)"
                className="rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-medium text-[#183558] outline-none focus:border-[#0A70D6]"
              />
              <button
                type="button"
                disabled={creando}
                onClick={() => void registrarSolicitud()}
                className="rounded-lg bg-[#0A70D6] px-3 py-1.5 text-[10px] font-extrabold text-white hover:bg-[#0757aa] disabled:opacity-50"
              >
                {creando ? "Guardando…" : "Guardar"}
              </button>
            </div>
            <p className="mt-1.5 text-[9px] font-semibold text-blue-700">
              Registro corto: nace como Solicitud, sin horario. Ábrela después para completar el resto.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {ESTADOS.map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={estadosFiltro.has(e)}
              onClick={() => toggleEstado(e)}
              className={`rounded-full px-2.5 py-1 text-[9px] font-bold ring-1 ring-inset transition ${
                estadosFiltro.has(e)
                  ? "bg-[#0A70D6] text-white ring-[#0A70D6]"
                  : `${ESTADO_ESTILO[e]} hover:brightness-95`
              }`}
            >
              {ESTADO_LABEL[e]}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <button
            type="button"
            aria-pressed={soloSinHorario}
            onClick={() => setSoloSinHorario((v) => !v)}
            className={`rounded-full px-2.5 py-1 text-[9px] font-bold ring-1 ring-inset transition ${
              soloSinHorario
                ? "bg-slate-700 text-white ring-slate-700"
                : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            Sin horario
          </button>
          <button
            type="button"
            aria-pressed={soloIndicacionesPendientes}
            onClick={() => setSoloIndicacionesPendientes((v) => !v)}
            className={`rounded-full px-2.5 py-1 text-[9px] font-bold ring-1 ring-inset transition ${
              soloIndicacionesPendientes
                ? "bg-amber-600 text-white ring-amber-600"
                : "bg-white text-amber-700 ring-amber-200 hover:bg-amber-50"
            }`}
          >
            Indicaciones pendientes
          </button>
          <select
            value={participaGobernadorFiltro}
            onChange={(e) =>
              setParticipaGobernadorFiltro(e.target.value as "todos" | "si" | "no")
            }
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[9px] font-bold text-slate-600 outline-none focus:border-[#0A70D6]"
          >
            <option value="todos">Gobernador: todos</option>
            <option value="si">Gobernador: participa</option>
            <option value="no">Gobernador: no participa</option>
          </select>
          {opcionesResponsable.length > 0 && (
            <select
              value={responsableFiltro}
              onChange={(e) => setResponsableFiltro(e.target.value)}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[9px] font-bold text-slate-600 outline-none focus:border-[#0A70D6]"
            >
              <option value="">Responsable: todos</option>
              {opcionesResponsable.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          )}
          {hayFiltrosActivos && (
            <button
              type="button"
              onClick={limpiarFiltros}
              className="rounded-full px-2.5 py-1 text-[9px] font-bold text-red-600 hover:underline"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-4 mt-3 flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700"
        >
          <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div ref={contenedorRef} className="max-h-[640px] overflow-y-auto">
        {cargando ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : filas.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <InstitutionalIcon name="calendar" />
            </div>
            <p className="text-xs font-bold text-slate-600">
              {hayFiltrosActivos ? "Nada con estos filtros" : "Sin registros todavía"}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop: tabla. Columnas acotadas a propósito ("en laptop evita
                paneles cortados") -- descripción/tipo/etc. quedan para el
                detalle, no acá. */}
            <table className="hidden w-full text-left text-[11px] sm:table">
              <thead className="sticky top-0 bg-slate-50 text-[9px] font-extrabold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Fecha y hora</th>
                  <th className="px-3 py-2">Asunto</th>
                  <th className="px-3 py-2">Organización</th>
                  <th className="px-3 py-2">Lugar</th>
                  <th className="px-3 py-2">Apoyo responsable</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-center">Gob.</th>
                  <th className="px-3 py-2 text-center">Indicación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.map((fila) => (
                  // Toda la fila abre el detalle -- las celdas editables
                  // (asunto/organización/lugar) paran la propagación en su
                  // propio click para poder editar inline sin también abrir
                  // el diálogo completo.
                  <tr
                    key={fila.id}
                    className="cursor-pointer hover:bg-blue-50/40"
                    onClick={() => onAbrirEvento(fila.id)}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-600">
                      {fechaHora(fila)}
                    </td>
                    <td className="px-3 py-2.5">
                      {edicion?.filaId === fila.id && edicion.campo === "titulo" ? (
                        <CeldaEdicion
                          valor={valorEdicion}
                          onChange={setValorEdicion}
                          onGuardar={() => void guardarCelda(fila)}
                          onCancelar={() => setEdicion(null)}
                          guardando={guardandoCelda}
                        />
                      ) : (
                        <button
                          type="button"
                          className="max-w-[220px] truncate text-left font-bold text-[#183558] hover:underline"
                          title={`${fila.titulo} (clic: editar el asunto)`}
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirEdicionCelda(fila, "titulo");
                          }}
                        >
                          {fila.titulo}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {edicion?.filaId === fila.id &&
                      edicion.campo === "organizacion_solicitante" ? (
                        <CeldaEdicion
                          valor={valorEdicion}
                          onChange={setValorEdicion}
                          onGuardar={() => void guardarCelda(fila)}
                          onCancelar={() => setEdicion(null)}
                          guardando={guardandoCelda}
                        />
                      ) : (
                        <button
                          type="button"
                          className="max-w-[160px] truncate text-left text-slate-600 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirEdicionCelda(fila, "organizacion_solicitante");
                          }}
                        >
                          {fila.organizacion_solicitante || (
                            <span className="text-slate-300">—</span>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {edicion?.filaId === fila.id && edicion.campo === "lugar" ? (
                        <CeldaEdicion
                          valor={valorEdicion}
                          onChange={setValorEdicion}
                          onGuardar={() => void guardarCelda(fila)}
                          onCancelar={() => setEdicion(null)}
                          guardando={guardandoCelda}
                        />
                      ) : (
                        <button
                          type="button"
                          className="max-w-[140px] truncate text-left text-slate-600 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirEdicionCelda(fila, "lugar");
                          }}
                        >
                          {fila.lugar || <span className="text-slate-300">—</span>}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {fila.responsable_apoyo_nombre || (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ring-inset ${ESTADO_ESTILO[fila.estado]}`}
                      >
                        {ESTADO_LABEL[fila.estado]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {fila.participa_gobernador && (
                        <span title="Participa el Gobernador" className="text-amber-600">
                          <InstitutionalIcon name="shield" className="mx-auto h-4 w-4" />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {fila.indicacion_pendiente_id && (
                        <span
                          title={`Indicación pendiente: ${fila.indicacion_pendiente_tipo}`}
                          className="text-orange-600"
                        >
                          <InstitutionalIcon name="message" className="mx-auto h-4 w-4" />
                        </span>
                      )}
                    </td>
                    {erroresCelda[fila.id] && (
                      <td colSpan={8} className="px-3 pb-2 text-[9px] font-semibold text-red-600">
                        {erroresCelda[fila.id]}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile: lista de tarjetas, no la tabla comprimida ("en celular
                ofrece una lista legible... sin comprimir todas las
                columnas"). */}
            <div className="space-y-2 p-3 sm:hidden">
              {filas.map((fila) => (
                <button
                  key={fila.id}
                  type="button"
                  onClick={() => onAbrirEvento(fila.id)}
                  className="block w-full rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-left"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-bold text-[#183558]">{fila.titulo}</p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ring-inset ${ESTADO_ESTILO[fila.estado]}`}
                    >
                      {ESTADO_LABEL[fila.estado]}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {fechaHora(fila)}
                    {fila.lugar ? ` · ${fila.lugar}` : ""}
                  </p>
                  {fila.organizacion_solicitante && (
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {fila.organizacion_solicitante}
                    </p>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    {fila.responsable_apoyo_nombre && (
                      <span className="text-[9px] font-semibold text-slate-400">
                        {fila.responsable_apoyo_nombre}
                      </span>
                    )}
                    {fila.participa_gobernador && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-700">
                        <InstitutionalIcon name="shield" className="h-3 w-3" />
                        Gobernador
                      </span>
                    )}
                    {fila.indicacion_pendiente_id && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-orange-700">
                        <InstitutionalIcon name="message" className="h-3 w-3" />
                        Indicación
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-[10px] font-semibold text-slate-500">
        <span>{total} {total === 1 ? "registro" : "registros"}</span>
        {paginas > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pagina <= 1}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <span>
              {pagina} / {paginas}
            </span>
            <button
              type="button"
              disabled={pagina >= paginas}
              onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
              className="rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function CeldaEdicion({
  valor,
  onChange,
  onGuardar,
  onCancelar,
  guardando,
}: {
  valor: string;
  onChange: (v: string) => void;
  onGuardar: () => void;
  onCancelar: () => void;
  guardando: boolean;
}) {
  return (
    <input
      autoFocus
      value={valor}
      disabled={guardando}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={onGuardar}
      onKeyDown={(e) => {
        if (e.key === "Enter") onGuardar();
        if (e.key === "Escape") onCancelar();
      }}
      className="w-full rounded-lg border border-[#0A70D6] bg-white px-2 py-1 text-[11px] font-medium text-[#183558] outline-none"
    />
  );
}
