"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  actualizarEvento,
  atenderIndicacion,
  buscarConflictosEvento,
  crearEvento,
  crearIndicacion,
  eliminarEvento,
  getCoberturas,
  getEvento,
  getEventos,
  getIndicaciones,
  pedirCobertura,
  type Cobertura,
  type ConflictoEvento,
  type CrearEventoInput,
  type Evento,
  type EventoDetalle,
  type EventoEstado,
  type EventoTipo,
  type Indicacion,
  type IndicacionTipo,
  type NivelConfidencialidad,
} from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { useRealtime } from "@/lib/realtime-context";
import { COBERTURA_ESTADO_LABEL } from "@/lib/comunicacion";
import { rangoDeRol } from "@/lib/roles";
import {
  InstitutionalIcon,
  type IconName,
} from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

const DIAS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const NIVEL_ESTILO: Record<string, string> = {
  publica: "bg-slate-100 text-slate-600 ring-slate-200",
  interna: "bg-blue-50 text-blue-700 ring-blue-200",
  reservada: "bg-amber-50 text-amber-800 ring-amber-200",
  confidencial: "bg-red-50 text-red-700 ring-red-200",
};

// Recorrido de solicitudes (029_agenda_solicitudes.sql). El campo `estado`
// solo se expone en el formulario para los roles que participan del
// recorrido -- para el resto (secretarías) todo evento sigue naciendo y
// quedando 'confirmado', exactamente como siempre.
const ROLES_RECORRIDO_SOLICITUDES = ["apoyo", "jefe_gabinete", "gobernador", "admin"];
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
// apoyo nunca puede dejar un evento en 'confirmado'/'cancelado'/etc.
// (eventos_insert/update, 029) -- "el apoyo no confirma ni cancela por su
// cuenta". El resto de estos roles sí puede, al editar.
function estadosDisponibles(rol: string, editando: boolean): EventoEstado[] {
  if (rol === "apoyo") return ["solicitud", "tentativo"];
  if (!editando) return ["solicitud", "tentativo", "confirmado"];
  return ["solicitud", "tentativo", "confirmado", "cancelado", "realizado", "no_realizado"];
}

// Indicaciones del Gobernador (032_evento_indicaciones.sql): acción escrita
// para pedir reprogramación/cancelación/aclaración -- el Gobernador ya no
// edita el evento directo (ver 033), esto es lo que tiene en su lugar.
const INDICACION_TIPO_LABEL: Record<IndicacionTipo, string> = {
  reprogramar: "Reprogramar",
  cancelar: "Cancelar",
  aclaracion: "Aclaración",
  otro: "Otro",
};

interface PlantillaEvento {
  tipo: EventoTipo;
  etiqueta: string;
  titulo: string;
  duracion: number;
  icono: IconName;
  cobertura: boolean;
}

const PLANTILLAS: PlantillaEvento[] = [
  {
    tipo: "reunion",
    etiqueta: "Reunión",
    titulo: "Reunión de coordinación",
    duracion: 60,
    icono: "users",
    cobertura: false,
  },
  {
    tipo: "audiencia",
    etiqueta: "Audiencia",
    titulo: "Audiencia institucional",
    duracion: 45,
    icono: "message",
    cobertura: false,
  },
  {
    tipo: "inspeccion",
    etiqueta: "Inspección",
    titulo: "Inspección técnica",
    duracion: 90,
    icono: "shield",
    cobertura: true,
  },
  {
    tipo: "acto",
    etiqueta: "Acto oficial",
    titulo: "Acto oficial",
    duracion: 90,
    icono: "building",
    cobertura: true,
  },
  {
    tipo: "conferencia",
    etiqueta: "Conferencia",
    titulo: "Conferencia de prensa",
    duracion: 60,
    icono: "megaphone",
    cobertura: true,
  },
  {
    tipo: "otro",
    etiqueta: "Otro",
    titulo: "",
    duracion: 60,
    icono: "calendar",
    cobertura: false,
  },
];

const DURACIONES = [30, 45, 60, 90, 120];
const HORARIOS = Array.from({ length: 96 }, (_, indice) => {
  const minutos = indice * 15;
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
});

function sumarMinutos(hora: string, minutosExtra: number) {
  const [horas, minutos] = hora.split(":").map(Number);
  const total = Math.min(horas * 60 + minutos + minutosExtra, 23 * 60 + 45);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function duracionEntre(inicio: string, fin: string) {
  const [horaInicioValor, minutoInicio] = inicio.split(":").map(Number);
  const [horaFinValor, minutoFin] = fin.split(":").map(Number);
  return Math.max(
    15,
    horaFinValor * 60 + minutoFin - (horaInicioValor * 60 + minutoInicio),
  );
}

function valorFecha(fecha: Date) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
}

function claveDia(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function horaEvento(fecha: string) {
  return new Intl.DateTimeFormat("es-BO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(fecha));
}

export default function AgendaPage() {
  const { sesion } = useSession();
  const { onEventoCambio } = useRealtime();
  const miRango = rangoDeRol(sesion.rol);
  const rangoDirector = rangoDeRol("director");
  const esUnicom = sesion.rol === "unicom";
  const puedeSolicitarCobertura = esUnicom || miRango >= rangoDirector;
  const enRecorridoSolicitudes = ROLES_RECORRIDO_SOLICITUDES.includes(sesion.rol);
  // Solo quien coordina la agenda del Gabinete marca participación y
  // atiende indicaciones -- ni apoyo ni el propio Gobernador (que ya no
  // escribe eventos_agenda directo, ver 033).
  const puedeMarcarParticipacion = ["jefe_gabinete", "admin"].includes(sesion.rol);
  const esGobernador = sesion.rol === "gobernador";

  const [calendar, setCalendar] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [coberturas, setCoberturas] = useState<Cobertura[]>([]);
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seleccionado, setSeleccionado] = useState<Date>(() => new Date());

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<Evento | null>(null);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [lugar, setLugar] = useState("");
  const [horaInicio, setHoraInicio] = useState("09:00");
  const [horaFin, setHoraFin] = useState("10:00");
  const [duracion, setDuracion] = useState(60);
  const [tipo, setTipo] = useState<EventoTipo>("reunion");
  const [nivel, setNivel] = useState<NivelConfidencialidad>("interna");
  const [recordatoriosActivos, setRecordatoriosActivos] = useState(true);
  const [solicitarCobertura, setSolicitarCobertura] = useState(false);
  const [conflictos, setConflictos] = useState<ConflictoEvento[]>([]);
  const [permitirConflicto, setPermitirConflicto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [estado, setEstado] = useState<EventoEstado>("confirmado");
  // "Sin horario todavía" -- registro corto de una solicitud
  // (029_agenda_solicitudes.sql). Solo relevante cuando estado='solicitud'.
  const [conHorario, setConHorario] = useState(true);
  // Participación explícita del Gobernador -- nunca inferida de confirmar
  // (ver eventos.service.ts, marcarParticipacionGobernador()).
  const [participaGobernador, setParticipaGobernador] = useState(false);
  const [indicaciones, setIndicaciones] = useState<Indicacion[]>([]);
  const [pidiendoIndicacion, setPidiendoIndicacion] = useState(false);
  const [tipoIndicacion, setTipoIndicacion] = useState<IndicacionTipo>("reprogramar");
  const [textoIndicacion, setTextoIndicacion] = useState("");
  const [atendiendoId, setAtendiendoId] = useState<string | null>(null);
  const [notaAtencion, setNotaAtencion] = useState("");
  const tituloInputRef = useRef<HTMLInputElement>(null);
  const enlaceProcesado = useRef<string | null>(null);
  const cargandoDetalleParaId = useRef<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const desde = new Date(calendar.year, calendar.month, 1);
      const hasta = new Date(calendar.year, calendar.month + 1, 0, 23, 59, 59);
      const mes = `${calendar.year}-${String(calendar.month + 1).padStart(2, "0")}`;
      const [evs, cobs] = await Promise.all([
        getEventos(desde.toISOString(), hasta.toISOString()),
        getCoberturas({ mes }).catch(() => [] as Cobertura[]),
      ]);
      setEventos(evs);
      setCoberturas(cobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando la agenda");
    } finally {
      setCargando(false);
    }
  }, [calendar]);

  useEffect(() => {
    queueMicrotask(() => void cargar());
  }, [cargar]);

  useEffect(() => {
    if (!mostrarForm) return;

    const previousOverflow = document.body.style.overflow;
    const focusFrame = requestAnimationFrame(() =>
      tituloInputRef.current?.focus(),
    );
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

  // Tiempo real: mismo canal RLS-filtrado que el resto del panel. En un
  // borrado no llega la fila (ya no existe) -- solo el id, para sacarla.
  useEffect(
    () =>
      onEventoCambio(({ evento, id }) => {
        setEventos((prev) => {
          if (!evento) return id ? prev.filter((e) => e.id !== id) : prev;
          const idx = prev.findIndex((e) => e.id === evento.id);
          if (idx === -1) return [...prev, evento];
          const copy = [...prev];
          copy[idx] = evento;
          return copy;
        });
      }),
    [onEventoCambio],
  );

  const eventosPorDia = useMemo(() => {
    const map = new Map<string, Evento[]>();
    for (const ev of eventos) {
      const key = claveDia(new Date(ev.fecha_inicio));
      const lista = map.get(key) ?? [];
      lista.push(ev);
      map.set(key, lista);
    }
    for (const lista of map.values())
      lista.sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
    return map;
  }, [eventos]);

  const eventosDelDia = eventosPorDia.get(claveDia(seleccionado)) ?? [];

  function moverMes(offset: number) {
    setCalendar((c) => {
      const d = new Date(c.year, c.month + offset, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function volverAHoy() {
    const fecha = new Date();
    setCalendar({ year: fecha.getFullYear(), month: fecha.getMonth() });
    setSeleccionado(fecha);
  }

  function abrirNuevo() {
    setError(null);
    setEditando(null);
    setTitulo("");
    setDescripcion("");
    setLugar("");
    setHoraInicio("09:00");
    setHoraFin("10:00");
    setDuracion(60);
    setTipo("reunion");
    setNivel("interna");
    setRecordatoriosActivos(true);
    setSolicitarCobertura(false);
    setConflictos([]);
    setPermitirConflicto(false);
    // apoyo: "registro corto, incluso sin horario" es el punto de entrada
    // por defecto -- puede tildar "definir horario" si ya lo conoce.
    const esApoyo = sesion.rol === "apoyo";
    setEstado(esApoyo ? "solicitud" : "confirmado");
    setConHorario(!esApoyo);
    setParticipaGobernador(false);
    setIndicaciones([]);
    cargandoDetalleParaId.current = null;
    setMostrarForm(true);
  }

  // Acepta tanto un Evento del calendario (fechas siempre presentes) como un
  // EventoDetalle traído por id (puede venir sin horario -- una solicitud
  // todavía no propuesta, típicamente abierta desde el enlace de la
  // bandeja de pendientes).
  function abrirEditar(ev: Evento | EventoDetalle) {
    setError(null);
    setEditando(ev as Evento);
    setTitulo(ev.titulo);
    setDescripcion(ev.descripcion ?? "");
    setLugar(ev.lugar ?? "");
    const tieneHorario = ev.fecha_inicio !== null && ev.fecha_fin !== null;
    setHoraInicio(
      tieneHorario ? new Date(ev.fecha_inicio!).toTimeString().slice(0, 5) : "09:00",
    );
    setHoraFin(
      tieneHorario ? new Date(ev.fecha_fin!).toTimeString().slice(0, 5) : "10:00",
    );
    setDuracion(
      tieneHorario
        ? Math.round(
            (new Date(ev.fecha_fin!).getTime() -
              new Date(ev.fecha_inicio!).getTime()) /
              60_000,
          )
        : 60,
    );
    setTipo(ev.tipo ?? "reunion");
    setNivel(ev.nivel_confidencialidad);
    setRecordatoriosActivos(ev.recordatorios_activos ?? true);
    setSolicitarCobertura(false);
    setConflictos([]);
    setPermitirConflicto(false);
    setEstado(ev.estado);
    setConHorario(tieneHorario);
    setSeleccionado(tieneHorario ? new Date(ev.fecha_inicio!) : new Date());
    setParticipaGobernador("participaGobernador" in ev ? ev.participaGobernador : false);
    setIndicaciones([]);
    setTipoIndicacion("reprogramar");
    setTextoIndicacion("");
    setAtendiendoId(null);
    setNotaAtencion("");
    setMostrarForm(true);
    // El Evento del calendario no trae participaGobernador/indicaciones
    // (solo EventoDetalle los tiene) -- se completan aparte, sin bloquear
    // la apertura del formulario. Guard por id: si mientras tanto se abrió
    // otro evento, esta respuesta llega tarde y no debe pisar su estado.
    cargandoDetalleParaId.current = ev.id;
    void (async () => {
      try {
        const [detalle, indics] = await Promise.all([
          getEvento(ev.id),
          getIndicaciones(ev.id).catch(() => [] as Indicacion[]),
        ]);
        if (cargandoDetalleParaId.current !== ev.id) return;
        setParticipaGobernador(detalle.participaGobernador);
        setIndicaciones(indics);
      } catch {
        // El formulario ya tiene lo básico -- esto es un complemento, no
        // bloquea nada si falla.
      }
    })();
  }

  // Enlace desde la bandeja de pendientes (?evento=<id>): trae el evento
  // puntual por id (RLS propia, no depende de que esté en el rango del mes
  // que el calendario tenga cargado) y abre el mismo formulario de editar.
  // Se lee window.location directamente (no useSearchParams de
  // next/navigation) para no forzar un boundary de Suspense en toda la
  // página solo por un enlace opcional que se lee una vez al montar.
  useEffect(() => {
    const eventoId = new URLSearchParams(window.location.search).get("evento");
    if (!eventoId || enlaceProcesado.current === eventoId) return;
    enlaceProcesado.current = eventoId;
    (async () => {
      try {
        const detalle = await getEvento(eventoId);
        abrirEditar(detalle);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo abrir el evento enlazado",
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onGuardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      let fechaInicioIso: string | undefined;
      let fechaFinIso: string | undefined;

      if (conHorario) {
        const [hIni, mIni] = horaInicio.split(":").map(Number);
        const [hFin, mFin] = horaFin.split(":").map(Number);
        const fechaInicio = new Date(seleccionado);
        fechaInicio.setHours(hIni, mIni, 0, 0);
        const fechaFin = new Date(seleccionado);
        fechaFin.setHours(hFin, mFin, 0, 0);

        if (fechaFin <= fechaInicio) {
          throw new Error(
            "La hora de finalizacion debe ser posterior a la de inicio",
          );
        }

        if (!permitirConflicto) {
          const encontrados = await buscarConflictosEvento({
            fechaInicio: fechaInicio.toISOString(),
            fechaFin: fechaFin.toISOString(),
            excluirId: editando?.id,
          });
          if (encontrados.length > 0) {
            setConflictos(encontrados);
            return;
          }
        }

        fechaInicioIso = fechaInicio.toISOString();
        fechaFinIso = fechaFin.toISOString();
      }

      const payload: CrearEventoInput = {
        tipo,
        titulo,
        descripcion: descripcion || undefined,
        lugar: lugar || undefined,
        fechaInicio: fechaInicioIso,
        fechaFin: fechaFinIso,
        nivelConfidencialidad: nivel,
        recordatoriosActivos,
        estado: enRecorridoSolicitudes ? estado : undefined,
        // Solo quien puede marcarla (la jefa/admin) la manda -- nunca
        // inferida de a qué estado se mueve el evento.
        participaGobernador: puedeMarcarParticipacion ? participaGobernador : undefined,
      };

      const eventoGuardado = editando
        ? await actualizarEvento(editando.id, payload)
        : await crearEvento(payload);

      if (!editando && solicitarCobertura) {
        try {
          await pedirCobertura(eventoGuardado.id);
        } catch (err) {
          setMostrarForm(false);
          await cargar();
          setError(
            `El evento se creo, pero la cobertura no pudo solicitarse: ${
              err instanceof Error ? err.message : "error desconocido"
            }`,
          );
          return;
        }
      }

      setMostrarForm(false);
      await cargar();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo guardar el evento",
      );
    } finally {
      setGuardando(false);
    }
  }

  function cambiarProgramacion(callback: () => void) {
    callback();
    setConflictos([]);
    setPermitirConflicto(false);
  }

  function aplicarPlantilla(plantilla: PlantillaEvento) {
    const tituloPlantillaActual = PLANTILLAS.find(
      (item) => item.tipo === tipo,
    )?.titulo;
    setTipo(plantilla.tipo);
    setDuracion(plantilla.duracion);
    setHoraFin(sumarMinutos(horaInicio, plantilla.duracion));
    setSolicitarCobertura(plantilla.cobertura && puedeSolicitarCobertura);
    if (!titulo.trim() || titulo === tituloPlantillaActual)
      setTitulo(plantilla.titulo);
    setConflictos([]);
    setPermitirConflicto(false);
  }

  function seleccionarFechaRapida(opcion: "hoy" | "manana" | "lunes") {
    const fecha = new Date();
    fecha.setHours(0, 0, 0, 0);
    if (opcion === "manana") fecha.setDate(fecha.getDate() + 1);
    if (opcion === "lunes") {
      const diasHastaLunes = (8 - fecha.getDay()) % 7 || 7;
      fecha.setDate(fecha.getDate() + diasHastaLunes);
    }
    cambiarProgramacion(() => setSeleccionado(fecha));
  }

  async function onEliminar(id: string) {
    setError(null);
    try {
      await eliminarEvento(id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo eliminar el evento",
      );
    }
  }

  // Espejo de eventos_update/delete: transversal, o tu secretaria + rango
  // director+. Solo evita mostrar un boton que el backend igual rechazaria.
  // gobernador queda afuera a propósito (033_eventos_agenda_gobernador_no_escribe.sql
  // lo sacó de esas políticas) -- sin este chequeo, vería "Editar"/
  // "Eliminar" en el calendario normal (no solo en Mi jornada) y el envío
  // fallaría con un 404 confuso; su acción en su lugar es una indicación
  // (ver el botón "Pedir cambio" en Mi jornada).
  function puedeGestionar(ev: Evento) {
    return (
      !esGobernador &&
      (miRango >= 99 ||
        (miRango >= rangoDirector && ev.secretaria_id === sesion.secretariaId))
    );
  }

  // Comunicación: director+ de la secretaría dueña o UNICOM pueden pedir
  // cobertura. El backend (RLS cobertura_insert) decide de verdad.
  const coberturaPorEvento = useMemo(
    () => new Map(coberturas.map((c) => [c.evento_id, c])),
    [coberturas],
  );
  const diasConCobertura = useMemo(() => {
    const s = new Set<string>();
    for (const c of coberturas) {
      if (c.evento_fecha) s.add(claveDia(new Date(c.evento_fecha)));
    }
    return s;
  }, [coberturas]);

  async function onPedirCobertura(eventoId: string) {
    setPidiendo(eventoId);
    setError(null);
    try {
      const cob = await pedirCobertura(eventoId);
      setCoberturas((prev) => [
        ...prev.filter((c) => c.evento_id !== eventoId),
        cob,
      ]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo pedir la cobertura",
      );
    } finally {
      setPidiendo(null);
    }
  }

  const primerDiaSemana =
    (new Date(calendar.year, calendar.month, 1).getDay() + 6) % 7;
  const diasEnMes = new Date(calendar.year, calendar.month + 1, 0).getDate();
  const totalCeldas = Math.ceil((primerDiaSemana + diasEnMes) / 7) * 7;
  const celdas = Array.from({ length: totalCeldas }, (_, indice) => {
    const fecha = new Date(
      calendar.year,
      calendar.month,
      indice - primerDiaSemana + 1,
    );
    return {
      fecha,
      dia: fecha.getDate(),
      esMesActual: fecha.getMonth() === calendar.month,
    };
  });

  const hoy = new Date();
  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-[#7CC7F6]/45 bg-[#f5f9fd] px-3.5 py-2.5 text-sm font-medium text-[#02224F] outline-none transition placeholder:text-[#9DA9BB] hover:border-[#2FA1F0]/55 focus:border-[#0A70D6] focus:bg-white focus:ring-3 focus:ring-[#2FA1F0]/15";

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0A70D6]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#06E5FA] shadow-[0_0_10px_rgba(6,229,250,0.85)]" />{" "}
            Agenda institucional
          </div>
          <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">
            Calendario de actividades
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Reuniones y actividades ·{" "}
            <span className="font-bold capitalize text-[#0A70D6]">
              {sesion.rol}
            </span>
          </p>
        </div>
        {/* gobernador ya no puede crear eventos directo (033) -- sin este
            botón acá, en el calendario normal; su acción es una indicación
            desde "Mi jornada". */}
        {!esGobernador && (
          <button
            onClick={abrirNuevo}
            aria-haspopup="dialog"
            aria-controls="evento-dialog"
            className="group inline-flex items-center justify-center gap-3 rounded-2xl border border-[#37F0FC]/25 bg-gradient-to-r from-[#0A70D6] to-[#0451A5] px-3.5 py-2.5 text-left text-white shadow-[0_12px_28px_rgba(10,112,214,0.24)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(10,112,214,0.3)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#2FA1F0]/30"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 transition group-hover:bg-white/15">
              <InstitutionalIcon name="plus" className="h-4 w-4" />
            </span>
            <span className="pr-1">
              <span className="block text-xs font-extrabold leading-tight">
                Nuevo evento
              </span>
              <span className="mt-0.5 block text-[9px] font-medium leading-tight text-[#E3EAEF]/80">
                Programar actividad
              </span>
            </span>
          </button>
        )}
      </div>

      {error && !mostrarForm && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700"
        >
          <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <Panel className="border-slate-300 bg-white shadow-[0_14px_40px_rgba(15,42,76,.09)]">
          <div className="relative overflow-hidden border-b border-blue-100 bg-gradient-to-r from-[#eef6ff] via-white to-[#f3f8fd] px-4 py-3">
            <div className="pointer-events-none absolute -right-12 -top-20 h-40 w-40 rounded-full border border-blue-200/50 bg-blue-100/40" />
            <div className="relative flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0d5fc1] to-[#0a70d6] text-white shadow-[0_7px_18px_rgba(13,95,193,.24)]">
                  <InstitutionalIcon
                    name="calendar"
                    className="h-[18px] w-[18px]"
                  />
                </span>
                <div className="min-w-0">
                  <p className="text-[8px] font-extrabold uppercase tracking-[0.17em] text-[#0d5fc1]">
                    Agenda mensual
                  </p>
                  <h2 className="truncate text-lg font-black capitalize tracking-tight text-[#102a4c]">
                    {MESES[calendar.month]}{" "}
                    <span className="text-[#0d5fc1]">{calendar.year}</span>
                  </h2>
                  <p className="text-[9px] font-medium text-slate-500">
                    {eventos.length}{" "}
                    {eventos.length === 1
                      ? "actividad programada"
                      : "actividades programadas"}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={volverAHoy}
                  className="hidden rounded-lg border border-blue-200 bg-white px-2.5 py-2 text-[9px] font-extrabold uppercase tracking-wider text-[#0d5fc1] shadow-sm transition hover:border-[#2fa1f0] hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-100 sm:block"
                >
                  Hoy
                </button>
                <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => moverMes(-1)}
                    className="flex h-9 w-9 items-center justify-center border-r border-slate-200 text-slate-600 transition hover:bg-[#0d5fc1] hover:text-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                    aria-label="Mes anterior"
                  >
                    <InstitutionalIcon name="chevronLeft" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moverMes(1)}
                    className="flex h-9 w-9 items-center justify-center text-slate-600 transition hover:bg-[#0d5fc1] hover:text-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                    aria-label="Mes siguiente"
                  >
                    <InstitutionalIcon
                      name="chevronRight"
                      className="h-4 w-4"
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#edf3f9] p-2.5 sm:p-3">
            {cargando ? (
              <div className="overflow-hidden rounded-2xl border border-slate-300 bg-[#d8e2ed]">
                <div className="grid grid-cols-7 gap-px">
                  {Array.from({ length: 35 }).map((_, indice) => (
                    <div
                      key={indice}
                      className="h-[76px] animate-pulse bg-white/80"
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_5px_18px_rgba(15,42,76,.07)]">
                <div className="grid grid-cols-7 border-b border-[#174f86] bg-gradient-to-r from-[#0a3c73] via-[#0d4f91] to-[#0a3c73] text-center">
                  {DIAS.map((d) => (
                    <span
                      key={d}
                      className="border-r border-white/10 py-2 text-[9px] font-extrabold uppercase tracking-[0.16em] text-blue-50 last:border-r-0"
                    >
                      {d}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-px bg-[#d8e2ed]">
                  {celdas.map(({ fecha, dia, esMesActual }, idx) => {
                    const items = eventosPorDia.get(claveDia(fecha)) ?? [];
                    const esHoy =
                      esMesActual &&
                      fecha.toDateString() === hoy.toDateString();
                    const esSeleccionado =
                      fecha.toDateString() === seleccionado.toDateString();
                    const esFinDeSemana = idx % 7 >= 5;
                    return (
                      <button
                        key={claveDia(fecha)}
                        type="button"
                        aria-pressed={esSeleccionado}
                        aria-label={fecha.toLocaleDateString("es-BO", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        })}
                        onClick={() => {
                          setSeleccionado(fecha);
                          if (!esMesActual)
                            setCalendar({
                              year: fecha.getFullYear(),
                              month: fecha.getMonth(),
                            });
                        }}
                        className={`flex h-[76px] min-w-0 flex-col items-stretch gap-1 overflow-hidden p-1.5 text-left transition focus:z-10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#0A70D6] ${
                          !esMesActual
                            ? "bg-slate-100/95 text-slate-400 hover:bg-slate-200/80"
                            : esSeleccionado
                              ? "bg-[#eaf4ff] shadow-[inset_0_0_0_2px_#3b82f6]"
                              : esHoy
                                ? "bg-blue-50"
                                : esFinDeSemana
                                  ? "bg-[#f5f9fd] hover:bg-blue-50/80"
                                  : "bg-white hover:bg-blue-50/70"
                        }`}
                      >
                        <div className="flex min-h-7 items-center justify-between gap-1">
                          <span
                            className={`flex h-7 min-w-7 items-center justify-center rounded-lg text-lg font-black leading-none tabular-nums ${
                              esSeleccionado || esHoy
                                ? "bg-[#0d5fc1] text-white shadow-[0_4px_10px_rgba(13,95,193,.25)]"
                                : esMesActual
                                  ? "text-[#183558]"
                                  : "text-slate-400"
                            }`}
                          >
                            {dia}
                          </span>
                          <span className="flex min-w-0 items-center gap-1">
                            {diasConCobertura.has(claveDia(fecha)) && (
                              <span
                                className="flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-100 text-fuchsia-700"
                                title="Con cobertura de comunicación"
                              >
                                <InstitutionalIcon
                                  name="megaphone"
                                  className="h-3 w-3"
                                />
                              </span>
                            )}
                            {items.length > 0 && (
                              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0d5fc1] px-1.5 text-[8px] font-black text-white">
                                {items.length}
                              </span>
                            )}
                          </span>
                        </div>

                        {esMesActual &&
                          items.slice(0, 1).map((evento) => (
                            <span
                              key={evento.id}
                              className="flex min-w-0 items-center gap-1 rounded-md bg-[#dff7fb] px-1.5 py-1 text-[#075b72] ring-1 ring-inset ring-[#7cc7f6]/60"
                            >
                              <span className="shrink-0 text-[7px] font-black tabular-nums">
                                {horaEvento(evento.fecha_inicio)}
                              </span>
                              <span className="truncate text-[8px] font-extrabold">
                                {evento.titulo}
                              </span>
                            </span>
                          ))}
                        {esMesActual && items.length > 1 && (
                          <span className="truncate px-0.5 text-[7px] font-extrabold text-[#0d5fc1]">
                            +{items.length - 1} más
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Panel>

        <Panel className="border-slate-300 bg-white shadow-[0_14px_40px_rgba(15,42,76,.08)]">
          <PanelTitle
            icon="clock"
            title={seleccionado.toLocaleDateString("es-BO", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
            action={
              <span className="text-[10px] font-semibold text-slate-400">
                {eventosDelDia.length} eventos
              </span>
            }
          />
          <div className="max-h-[520px] space-y-2 overflow-y-auto p-4">
            {cargando ? (
              [0, 1].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-xl bg-slate-100"
                />
              ))
            ) : eventosDelDia.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <InstitutionalIcon name="calendar" />
                </div>
                <p className="text-xs font-bold text-slate-600">
                  Sin eventos este día
                </p>
              </div>
            ) : (
              eventosDelDia.map((ev) => {
                const cob = coberturaPorEvento.get(ev.id);
                return (
                  <div
                    key={ev.id}
                    className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-[#183558]">
                        {ev.titulo}
                      </p>
                      <span className="flex shrink-0 items-center gap-1">
                        {ev.estado !== "confirmado" && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ring-inset ${ESTADO_ESTILO[ev.estado]}`}
                          >
                            {ESTADO_LABEL[ev.estado]}
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-bold capitalize ring-1 ring-inset ${NIVEL_ESTILO[ev.nivel_confidencialidad]}`}
                        >
                          {ev.nivel_confidencialidad}
                        </span>
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      {new Date(ev.fecha_inicio).toLocaleTimeString("es-BO", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      –{" "}
                      {new Date(ev.fecha_fin).toLocaleTimeString("es-BO", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {ev.lugar ? ` · ${ev.lugar}` : ""}
                    </p>
                    {ev.descripcion && (
                      <p className="mt-1.5 text-[10px] text-slate-500">
                        {ev.descripcion}
                      </p>
                    )}

                    {cob ? (
                      <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-fuchsia-50 px-2 py-0.5 text-[9px] font-bold text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200">
                        📣 Cobertura: {COBERTURA_ESTADO_LABEL[cob.estado]}
                      </p>
                    ) : puedeGestionar(ev) || esUnicom ? (
                      <button
                        onClick={() => onPedirCobertura(ev.id)}
                        disabled={pidiendo === ev.id}
                        className="mt-2 rounded-lg border border-fuchsia-200 px-2.5 py-1 text-[10px] font-bold text-fuchsia-700 transition hover:bg-fuchsia-50 disabled:opacity-50"
                      >
                        {pidiendo === ev.id
                          ? "Enviando…"
                          : "📣 Pedir cobertura"}
                      </button>
                    ) : null}

                    {puedeGestionar(ev) && (
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => abrirEditar(ev)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-white"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => onEliminar(ev.id)}
                          className="rounded-lg border border-red-200 px-2.5 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50"
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
      </div>

      {mostrarForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <button
            type="button"
            aria-label="Cerrar ventana de evento"
            onClick={() => setMostrarForm(false)}
            className="absolute inset-0 cursor-default bg-[#02224F]/72 backdrop-blur-[5px]"
          />

          <form
            id="evento-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evento-dialog-title"
            onSubmit={onGuardar}
            className="animate-fade-in-up relative flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.75rem] border border-[#7CC7F6]/30 bg-white shadow-[0_30px_90px_rgba(2,34,79,0.48)] sm:rounded-[1.75rem]"
          >
            <div className="h-1 shrink-0 bg-gradient-to-r from-[#06E5FA] via-[#2FA1F0] to-[#E99D19]" />

            <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#043472] via-[#0451A5] to-[#02224F] px-5 py-5 text-white sm:px-7">
              <div className="pointer-events-none absolute -right-14 -top-20 h-44 w-44 rounded-full border border-[#37F0FC]/15" />
              <div className="pointer-events-none absolute -right-3 -top-10 h-28 w-28 rounded-full border border-[#37F0FC]/10" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3.5">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#37F0FC]/30 bg-[#06E5FA]/10 text-[#37F0FC] shadow-[0_0_24px_rgba(6,229,250,0.12)]">
                    <InstitutionalIcon name="calendar" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#37F0FC]">
                      {editando ? "Actualizar agenda" : "Agenda institucional"}
                    </p>
                    <h2
                      id="evento-dialog-title"
                      className="text-lg font-black tracking-tight sm:text-xl"
                    >
                      {editando ? "Editar evento" : "Programar nuevo evento"}
                    </h2>
                    <p className="mt-1 text-[11px] font-medium text-[#E3EAEF]/75">
                      Organiza la fecha, el horario y el nivel de acceso de la
                      actividad.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMostrarForm(false)}
                  aria-label="Cerrar"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/8 text-[#E3EAEF] transition hover:border-[#37F0FC]/35 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#37F0FC]/50"
                >
                  <InstitutionalIcon
                    name="plus"
                    className="h-4 w-4 rotate-45"
                  />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto bg-[linear-gradient(145deg,#ffffff_0%,#f4f8fd_100%)] px-5 py-5 sm:px-7 sm:py-6">
              <div className="mb-4 flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#0A70D6]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#06E5FA] shadow-[0_0_8px_rgba(6,229,250,0.8)]" />
                Detalles de la actividad
              </div>

              {error && (
                <div
                  role="alert"
                  className="mb-4 flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs font-semibold text-red-700"
                >
                  <InstitutionalIcon
                    name="shield"
                    className="h-4 w-4 shrink-0"
                  />
                  {error}
                </div>
              )}

              {conflictos.length > 0 && (
                <div
                  role="alert"
                  className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
                      <InstitutionalIcon name="clock" className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black">Horario ocupado</p>
                      <p className="mt-0.5 text-[10px] font-medium text-amber-800">
                        Encontramos {conflictos.length}{" "}
                        {conflictos.length === 1
                          ? "actividad que se cruza"
                          : "actividades que se cruzan"}{" "}
                        con este horario.
                      </p>
                      <div className="mt-2 space-y-1.5">
                        {conflictos.map((conflicto, indice) => (
                          <div
                            key={conflicto.id ?? `oculto-${indice}`}
                            className="flex items-center justify-between gap-3 rounded-lg bg-white/75 px-2.5 py-2 ring-1 ring-inset ring-amber-200"
                          >
                            <span className="truncate text-[10px] font-extrabold">
                              {conflicto.oculto
                                ? "Ocupado — agenda del Gobernador"
                                : conflicto.titulo}
                            </span>
                            <span className="shrink-0 text-[9px] font-bold tabular-nums text-amber-700">
                              {horaEvento(conflicto.fecha_inicio)}–
                              {horaEvento(conflicto.fecha_fin)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setPermitirConflicto(true)}
                        className={`mt-3 rounded-lg px-3 py-1.5 text-[10px] font-extrabold transition ${
                          permitirConflicto
                            ? "bg-emerald-600 text-white"
                            : "border border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
                        }`}
                      >
                        {permitirConflicto
                          ? "Cruce autorizado"
                          : "Crear de todos modos"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <fieldset className="mb-5">
                <legend className="mb-2 text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#52647c]">
                  Tipo de actividad · completa datos automáticamente
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {PLANTILLAS.map((plantilla) => {
                    const activa = tipo === plantilla.tipo;
                    return (
                      <button
                        key={plantilla.tipo}
                        type="button"
                        aria-pressed={activa}
                        onClick={() => aplicarPlantilla(plantilla)}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                          activa
                            ? "border-[#0A70D6] bg-blue-50 text-[#0757aa] shadow-[0_5px_14px_rgba(10,112,214,.12)] ring-2 ring-blue-100"
                            : "border-slate-200 bg-white text-[#52647c] hover:border-blue-300 hover:bg-blue-50/50"
                        }`}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${activa ? "bg-[#0A70D6] text-white" : "bg-slate-100 text-slate-500"}`}
                        >
                          <InstitutionalIcon
                            name={plantilla.icono}
                            className="h-4 w-4"
                          />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[10px] font-black">
                            {plantilla.etiqueta}
                          </span>
                          <span className="block text-[8px] font-bold text-slate-400">
                            {plantilla.duracion} min
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {enRecorridoSolicitudes && (
                <fieldset className="mb-5 rounded-xl border border-[#7CC7F6]/35 bg-[#f5f9fd] p-3.5">
                  <legend className="mb-2 px-1 text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#0A70D6]">
                    Estado de la actividad
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label
                      htmlFor="evento-estado"
                      className="block text-xs font-extrabold text-[#02224F]"
                    >
                      Estado
                      <span className="relative block">
                        <select
                          id="evento-estado"
                          name="estado"
                          value={estado}
                          onChange={(e) => {
                            const nuevo = e.target.value as EventoEstado;
                            setEstado(nuevo);
                            if (nuevo !== "solicitud") setConHorario(true);
                          }}
                          className={`${fieldClass} appearance-none pr-10`}
                        >
                          {estadosDisponibles(sesion.rol, Boolean(editando)).map(
                            (opcion) => (
                              <option key={opcion} value={opcion}>
                                {ESTADO_LABEL[opcion]}
                              </option>
                            ),
                          )}
                        </select>
                        <InstitutionalIcon
                          name="chevronDown"
                          className="pointer-events-none absolute bottom-3 right-3.5 h-4 w-4 text-slate-400"
                        />
                      </span>
                    </label>

                    {estado === "solicitud" && (
                      <button
                        type="button"
                        aria-pressed={conHorario}
                        onClick={() =>
                          cambiarProgramacion(() => setConHorario((v) => !v))
                        }
                        className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${conHorario ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${conHorario ? "bg-[#0A70D6] text-white" : "bg-slate-100 text-slate-400"}`}
                        >
                          <InstitutionalIcon name="clock" className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[10px] font-black text-[#183558]">
                            {conHorario ? "Con horario propuesto" : "Sin horario todavía"}
                          </span>
                          <span className="block text-[8px] font-semibold text-slate-500">
                            Registro corto: se puede definir después
                          </span>
                        </span>
                        <span
                          className={`h-5 w-9 rounded-full p-0.5 transition ${conHorario ? "bg-[#0A70D6]" : "bg-slate-300"}`}
                        >
                          <span
                            className={`block h-4 w-4 rounded-full bg-white shadow transition ${conHorario ? "translate-x-4" : "translate-x-0"}`}
                          />
                        </span>
                      </button>
                    )}

                    {puedeMarcarParticipacion && (
                      <button
                        type="button"
                        aria-pressed={participaGobernador}
                        onClick={() => setParticipaGobernador((v) => !v)}
                        className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${participaGobernador ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${participaGobernador ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-400"}`}
                        >
                          <InstitutionalIcon name="shield" className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[10px] font-black text-[#183558]">
                            {participaGobernador ? "Participa el Gobernador" : "El Gobernador no participa"}
                          </span>
                          <span className="block text-[8px] font-semibold text-slate-500">
                            Marca explícita -- nunca automática
                          </span>
                        </span>
                        <span
                          className={`h-5 w-9 rounded-full p-0.5 transition ${participaGobernador ? "bg-amber-500" : "bg-slate-300"}`}
                        >
                          <span
                            className={`block h-4 w-4 rounded-full bg-white shadow transition ${participaGobernador ? "translate-x-4" : "translate-x-0"}`}
                          />
                        </span>
                      </button>
                    )}
                  </div>
                </fieldset>
              )}

              {editando && indicaciones.length > 0 && (
                <fieldset className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-3.5">
                  <legend className="mb-2 px-1 text-[9px] font-extrabold uppercase tracking-[0.14em] text-amber-800">
                    Indicaciones del Gobernador
                  </legend>
                  <div className="space-y-2">
                    {indicaciones.map((ind) => (
                      <div
                        key={ind.id}
                        className="rounded-lg border border-amber-200 bg-white p-3"
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-[10px] font-black text-[#183558]">
                            {INDICACION_TIPO_LABEL[ind.tipo]} · {ind.autor_nombre}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                              ind.estado === "pendiente"
                                ? "bg-amber-100 text-amber-800"
                                : ind.estado === "aplicada"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {ind.estado}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-600">{ind.texto}</p>
                        {ind.resultado_nota && (
                          <p className="mt-1 text-[10px] italic text-slate-500">
                            Nota: {ind.resultado_nota}
                          </p>
                        )}
                        {puedeMarcarParticipacion && ind.estado === "pendiente" && (
                          <div className="mt-2">
                            {atendiendoId === ind.id ? (
                              <div className="space-y-2">
                                <input
                                  value={notaAtencion}
                                  onChange={(e) => setNotaAtencion(e.target.value)}
                                  placeholder="Nota (opcional): qué se hizo al respecto"
                                  className={`${fieldClass} text-[10px]`}
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    disabled={pidiendoIndicacion}
                                    onClick={async () => {
                                      setPidiendoIndicacion(true);
                                      try {
                                        const actualizada = await atenderIndicacion(ind.id, {
                                          estado: "aplicada",
                                          resultadoNota: notaAtencion || undefined,
                                        });
                                        setIndicaciones((prev) =>
                                          prev.map((i) => (i.id === ind.id ? { ...i, ...actualizada } : i)),
                                        );
                                        setAtendiendoId(null);
                                        setNotaAtencion("");
                                      } catch (err) {
                                        setError(err instanceof Error ? err.message : "No se pudo marcar como aplicada");
                                      } finally {
                                        setPidiendoIndicacion(false);
                                      }
                                    }}
                                    className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                                  >
                                    Marcar aplicada
                                  </button>
                                  <button
                                    type="button"
                                    disabled={pidiendoIndicacion}
                                    onClick={async () => {
                                      setPidiendoIndicacion(true);
                                      try {
                                        const actualizada = await atenderIndicacion(ind.id, {
                                          estado: "descartada",
                                          resultadoNota: notaAtencion || undefined,
                                        });
                                        setIndicaciones((prev) =>
                                          prev.map((i) => (i.id === ind.id ? { ...i, ...actualizada } : i)),
                                        );
                                        setAtendiendoId(null);
                                        setNotaAtencion("");
                                      } catch (err) {
                                        setError(err instanceof Error ? err.message : "No se pudo descartar");
                                      } finally {
                                        setPidiendoIndicacion(false);
                                      }
                                    }}
                                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    Descartar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAtendiendoId(null);
                                      setNotaAtencion("");
                                    }}
                                    className="rounded-lg px-2.5 py-1 text-[10px] font-bold text-slate-400 hover:text-slate-600"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setAtendiendoId(ind.id)}
                                className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-100"
                              >
                                Atender
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </fieldset>
              )}

              <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                <label
                  htmlFor="evento-titulo"
                  className="block text-xs font-extrabold text-[#02224F] sm:col-span-2"
                >
                  Título <span className="text-[#0A70D6]">*</span>
                  <input
                    id="evento-titulo"
                    name="titulo"
                    ref={tituloInputRef}
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                    required
                    placeholder="Ej. Reunión de coordinación interinstitucional"
                    className={fieldClass}
                  />
                </label>

                {conHorario ? (
                  <div className="block text-xs font-extrabold text-[#02224F]">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="evento-fecha">
                        Fecha <span className="text-[#0A70D6]">*</span>
                      </label>
                      <div className="flex gap-1">
                        {(
                          [
                            ["hoy", "Hoy"],
                            ["manana", "Mañana"],
                            ["lunes", "Lunes"],
                          ] as const
                        ).map(([valor, etiqueta]) => (
                          <button
                            key={valor}
                            type="button"
                            onClick={() => seleccionarFechaRapida(valor)}
                            className="rounded-md bg-blue-50 px-1.5 py-1 text-[8px] font-extrabold text-[#0A70D6] transition hover:bg-blue-100"
                          >
                            {etiqueta}
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      id="evento-fecha"
                      name="fecha"
                      type="date"
                      value={valorFecha(seleccionado)}
                      onChange={(e) => {
                        if (e.target.value)
                          cambiarProgramacion(() =>
                            setSeleccionado(
                              new Date(`${e.target.value}T00:00:00`),
                            ),
                          );
                      }}
                      required
                      className={fieldClass}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#9DA9BB]/60 bg-[#f5f9fd] px-3.5 py-2.5 text-[10px] font-semibold text-[#52647c]">
                    <InstitutionalIcon name="clock" className="h-4 w-4 shrink-0 text-[#0A70D6]" />
                    Sin fecha todavía — la jefa de Gabinete propondrá un horario.
                  </div>
                )}

                <label
                  htmlFor="evento-confidencialidad"
                  className="block text-xs font-extrabold text-[#02224F]"
                >
                  Confidencialidad
                  <span className="relative block">
                    <select
                      id="evento-confidencialidad"
                      name="nivelConfidencialidad"
                      value={nivel}
                      onChange={(e) =>
                        setNivel(e.target.value as NivelConfidencialidad)
                      }
                      className={`${fieldClass} appearance-none pr-10`}
                    >
                      <option value="publica">Pública</option>
                      <option value="interna">Interna</option>
                      <option value="reservada">Reservada</option>
                      <option value="confidencial">Confidencial</option>
                    </select>
                    <InstitutionalIcon
                      name="chevronDown"
                      className="pointer-events-none absolute bottom-3 right-3.5 h-4 w-4 text-slate-400"
                    />
                  </span>
                </label>

                {conHorario && (
                  <>
                    <label
                      htmlFor="evento-hora-inicio"
                      className="block text-xs font-extrabold text-[#02224F]"
                    >
                      Hora de inicio <span className="text-[#0A70D6]">*</span>
                      <span className="relative block">
                        <select
                          id="evento-hora-inicio"
                          name="horaInicio"
                          value={horaInicio}
                          onChange={(e) =>
                            cambiarProgramacion(() => {
                              setHoraInicio(e.target.value);
                              setHoraFin(sumarMinutos(e.target.value, duracion));
                            })
                          }
                          required
                          className={`${fieldClass} appearance-none pr-10 tabular-nums`}
                        >
                          {HORARIOS.map((hora) => (
                            <option key={hora} value={hora}>
                              {hora}
                            </option>
                          ))}
                        </select>
                        <InstitutionalIcon
                          name="clock"
                          className="pointer-events-none absolute bottom-3 right-3.5 h-4 w-4 text-[#0A70D6]"
                        />
                      </span>
                    </label>

                    <label
                      htmlFor="evento-hora-fin"
                      className="block text-xs font-extrabold text-[#02224F]"
                    >
                      Hora de finalización <span className="text-[#0A70D6]">*</span>
                      <span className="relative block">
                        <select
                          id="evento-hora-fin"
                          name="horaFin"
                          value={horaFin}
                          onChange={(e) =>
                            cambiarProgramacion(() => {
                              setHoraFin(e.target.value);
                              setDuracion(
                                duracionEntre(horaInicio, e.target.value),
                              );
                            })
                          }
                          required
                          className={`${fieldClass} appearance-none pr-10 tabular-nums`}
                        >
                          {HORARIOS.map((hora) => (
                            <option key={hora} value={hora}>
                              {hora}
                            </option>
                          ))}
                        </select>
                        <InstitutionalIcon
                          name="clock"
                          className="pointer-events-none absolute bottom-3 right-3.5 h-4 w-4 text-[#0A70D6]"
                        />
                      </span>
                    </label>

                    <div className="sm:col-span-2">
                      <p className="mb-2 text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#52647c]">
                        Duración automática
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {DURACIONES.map((minutos) => (
                          <button
                            key={minutos}
                            type="button"
                            aria-pressed={duracion === minutos}
                            onClick={() =>
                              cambiarProgramacion(() => {
                                setDuracion(minutos);
                                setHoraFin(sumarMinutos(horaInicio, minutos));
                              })
                            }
                            className={`rounded-lg px-3 py-1.5 text-[10px] font-extrabold transition ${
                              duracion === minutos
                                ? "bg-[#0A70D6] text-white shadow-sm"
                                : "border border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-[#0A70D6]"
                            }`}
                          >
                            {minutos < 60 ? `${minutos} min` : `${minutos / 60} h`}
                          </button>
                        ))}
                        {!DURACIONES.includes(duracion) && (
                          <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] font-extrabold text-slate-500">
                            {duracion} min
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}

                <label
                  htmlFor="evento-lugar"
                  className="block text-xs font-extrabold text-[#02224F] sm:col-span-2"
                >
                  Lugar
                  <input
                    id="evento-lugar"
                    name="lugar"
                    value={lugar}
                    onChange={(e) => setLugar(e.target.value)}
                    placeholder="Ej. Sala de gabinete, edificio central"
                    className={fieldClass}
                  />
                </label>

                <div
                  className={`grid gap-2 ${puedeSolicitarCobertura && !editando ? "sm:col-span-2 sm:grid-cols-2" : "sm:col-span-2"}`}
                >
                  <button
                    type="button"
                    aria-pressed={recordatoriosActivos}
                    onClick={() => setRecordatoriosActivos((activo) => !activo)}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${recordatoriosActivos ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${recordatoriosActivos ? "bg-[#0A70D6] text-white" : "bg-slate-100 text-slate-400"}`}
                    >
                      <InstitutionalIcon name="bell" className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-black text-[#183558]">
                        Recordatorios inteligentes
                      </span>
                      <span className="block text-[8px] font-semibold text-slate-500">
                        24 h · 2 h · 15 min antes
                      </span>
                    </span>
                    <span
                      className={`h-5 w-9 rounded-full p-0.5 transition ${recordatoriosActivos ? "bg-[#0A70D6]" : "bg-slate-300"}`}
                    >
                      <span
                        className={`block h-4 w-4 rounded-full bg-white shadow transition ${recordatoriosActivos ? "translate-x-4" : "translate-x-0"}`}
                      />
                    </span>
                  </button>

                  {puedeSolicitarCobertura && !editando && (
                    <button
                      type="button"
                      aria-pressed={solicitarCobertura}
                      onClick={() => setSolicitarCobertura((activo) => !activo)}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${solicitarCobertura ? "border-fuchsia-300 bg-fuchsia-50" : "border-slate-200 bg-white"}`}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${solicitarCobertura ? "bg-fuchsia-600 text-white" : "bg-slate-100 text-slate-400"}`}
                      >
                        <InstitutionalIcon
                          name="megaphone"
                          className="h-4 w-4"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10px] font-black text-[#183558]">
                          Solicitar cobertura
                        </span>
                        <span className="block text-[8px] font-semibold text-slate-500">
                          Envía el evento a UNICOM
                        </span>
                      </span>
                      <span
                        className={`h-5 w-9 rounded-full p-0.5 transition ${solicitarCobertura ? "bg-fuchsia-600" : "bg-slate-300"}`}
                      >
                        <span
                          className={`block h-4 w-4 rounded-full bg-white shadow transition ${solicitarCobertura ? "translate-x-4" : "translate-x-0"}`}
                        />
                      </span>
                    </button>
                  )}
                </div>

                <label
                  htmlFor="evento-descripcion"
                  className="block text-xs font-extrabold text-[#02224F] sm:col-span-2"
                >
                  Descripción
                  <textarea
                    id="evento-descripcion"
                    name="descripcion"
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    rows={3}
                    placeholder="Añade el objetivo o los puntos principales del evento..."
                    className={`${fieldClass} min-h-24 resize-y leading-relaxed`}
                  />
                </label>
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-3 border-t border-[#7CC7F6]/25 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div className="hidden items-center gap-2 text-[10px] font-medium text-[#71829a] sm:flex">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2FA1F0]/10 text-[#0A70D6]">
                  <InstitutionalIcon name="clock" className="h-3.5 w-3.5" />
                </span>
                Validación de horario y avisos automáticos activos.
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
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#37F0FC]/25 bg-gradient-to-r from-[#0A70D6] to-[#0451A5] px-5 py-2.5 text-xs font-extrabold text-white shadow-[0_8px_20px_rgba(10,112,214,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_11px_24px_rgba(10,112,214,0.28)] disabled:cursor-wait disabled:translate-y-0 disabled:opacity-60 sm:flex-none"
                >
                  <InstitutionalIcon
                    name={guardando ? "clock" : "check"}
                    className="h-4 w-4"
                  />
                  {guardando
                    ? "Guardando…"
                    : editando
                      ? "Guardar cambios"
                      : permitirConflicto
                        ? "Confirmar evento"
                        : "Crear evento"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
