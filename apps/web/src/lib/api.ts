export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type NivelConfidencialidad =
  "publica" | "interna" | "reservada" | "confidencial";
export type EstadoPublicacion =
  "borrador" | "revision" | "aprobado" | "publicado";

export interface Publicacion {
  id: string;
  secretaria_id: string;
  titulo: string;
  contenido: string;
  nivel_confidencialidad: NivelConfidencialidad;
  estado: EstadoPublicacion;
  created_at: string;
  updated_at?: string;
  // Sello del flujo de aprobación (021): quién/cuándo en cada transición +
  // motivo cuando fue devuelta a borrador.
  motivo_rechazo?: string | null;
  enviado_revision_at?: string | null;
  aprobado_por?: string | null;
  aprobado_at?: string | null;
  publicado_por?: string | null;
  publicado_at?: string | null;
}

export class ApiError extends Error {
  status: number;
  // Body completo de la respuesta de error -- necesario para el 409 de
  // bloqueo optimista (034_agenda_mesa_trabajo.sql), que manda
  // {message, actual: EventoDetalle} y el caller necesita `actual`, no
  // solo el mensaje.
  body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Todos los listados del backend devuelven este envelope (cap duro de 100 por
// página). Las funciones getX() de abajo desenvuelven .datos para no romper
// las páginas que todavía no tienen paginador; getXPaginado() da el objeto
// completo para las que sí.
export interface Paginado<T> {
  datos: T[];
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
}

async function lista<T>(path: string): Promise<T[]> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await request<Paginado<T>>(`${path}${sep}porPagina=100`);
  return r.datos;
}

// El access token dura 15 min. Cuando expira, un request da 401: se llama
// UNA vez a /auth/refresh (que renueva las cookies con el refresh token) y se
// reintenta. Un solo refresh en vuelo aunque caigan varios 401 a la vez.
let refreshEnCurso: Promise<boolean> | null = null;

async function intentarRefresh(): Promise<boolean> {
  if (!refreshEnCurso) {
    refreshEnCurso = fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshEnCurso = null;
      });
  }
  return refreshEnCurso;
}

// credentials: "include" en cada request: la sesión vive en cookies httpOnly
// (access_token / refresh_token) que el navegador adjunta solo.
async function request<T>(
  path: string,
  options: RequestInit = {},
  _reintento = false,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  // 401 en un endpoint normal -> probar refrescar y reintentar una vez.
  const esAuth =
    path.startsWith("/auth/login") || path.startsWith("/auth/refresh");
  if (res.status === 401 && !_reintento && !esAuth) {
    if (await intentarRefresh()) return request<T>(path, options, true);
  }

  // Nest manda el body totalmente vacío (Content-Length: 0) cuando un
  // handler devuelve null -- res.json() revienta con "Unexpected end of JSON
  // input". Se lee como texto y solo se parsea si hay algo.
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = Array.isArray(body?.message)
      ? body.message.join(", ")
      : body?.message;
    throw new ApiError(
      message ?? res.statusText ?? "Error inesperado",
      res.status,
      body,
    );
  }

  return body as T;
}

export interface SesionUsuario {
  userId: string;
  email: string;
  rol: string;
  secretariaId: string | null;
}

export function login(email: string, password: string) {
  // El email va normalizado (sin espacios, en minúscula): que un teclado que
  // autocapitaliza o un espacio pegado no den "credenciales inválidas".
  return request<{ user: SesionUsuario }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
}

export function logout() {
  return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

// Para restaurar la sesión al recargar: no hay token que decodificar en el
// cliente, así que se le pregunta al backend quién sos según la cookie.
export function getMe() {
  return request<{ user: SesionUsuario }>("/auth/me");
}

export function getPublicaciones() {
  return lista<Publicacion>("/publicaciones");
}

export function crearPublicacion(data: {
  titulo: string;
  contenido: string;
  nivelConfidencialidad: NivelConfidencialidad;
}) {
  return request<Publicacion>("/publicaciones", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function actualizarEstado(
  id: string,
  estado: EstadoPublicacion,
  motivo?: string,
) {
  return request<Publicacion>(`/publicaciones/${id}/estado`, {
    method: "PATCH",
    body: JSON.stringify(motivo ? { estado, motivo } : { estado }),
  });
}

export interface Secretaria {
  id: string;
  nombre: string;
  slug: string;
  descripcion: string | null;
  activa: boolean;
  publicaciones_visibles: number;
}

export function getSecretarias() {
  return request<Secretaria[]>("/secretarias");
}

export interface CrearSecretariaInput {
  nombre: string;
  slug: string;
  descripcion?: string;
}

export interface ActualizarSecretariaInput {
  nombre?: string;
  descripcion?: string;
  activa?: boolean;
}

export function crearSecretaria(data: CrearSecretariaInput) {
  return request<Secretaria>("/admin/secretarias", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function actualizarSecretaria(
  id: string,
  data: ActualizarSecretariaInput,
) {
  return request<Secretaria>(`/admin/secretarias/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export type AccionAuditoria = "INSERT" | "UPDATE" | "DELETE";

export interface FiltrosAuditoria {
  q?: string;
  modulo?: string; // csv de nombres de tabla
  accion?: string; // csv de INSERT,UPDATE,DELETE
  usuarioId?: string;
  secretariaId?: string;
  desde?: string; // ISO con offset
  hasta?: string; // ISO con offset
  pagina?: number;
  porPagina?: number;
}

// Fila de la lista: liviana, sin los blobs. El diff campo-a-campo y el JSON
// crudo se piden aparte con getAuditoriaDetalle().
export interface RegistroAuditoria {
  id: number;
  created_at: string;
  accion: AccionAuditoria;
  tabla: string;
  registro_id: string;
  usuario_email: string | null;
  usuario_nombre: string | null;
  secretaria_id: string | null;
  secretaria_nombre: string | null;
  resumen: string;
}

export interface AuditoriaResumen {
  total: number;
  creaciones: number;
  actualizaciones: number;
  eliminaciones: number;
  actores: number;
}

export interface CampoCambio {
  campo: string;
  antesPresente: boolean;
  antes: unknown;
  despuesPresente: boolean;
  despues: unknown;
  cambiado: boolean;
}

export interface RegistroAuditoriaDetalle extends RegistroAuditoria {
  usuario_rol_actual: string | null;
  usuario_area_actual: string | null;
  cambios: CampoCambio[];
  datos_anteriores: Record<string, unknown> | null;
  datos_nuevos: Record<string, unknown> | null;
}

function qsAuditoria(f: FiltrosAuditoria): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.modulo) p.set("modulo", f.modulo);
  if (f.accion) p.set("accion", f.accion);
  if (f.usuarioId) p.set("usuarioId", f.usuarioId);
  if (f.secretariaId) p.set("secretariaId", f.secretariaId);
  if (f.desde) p.set("desde", f.desde);
  if (f.hasta) p.set("hasta", f.hasta);
  if (f.pagina) p.set("pagina", String(f.pagina));
  if (f.porPagina) p.set("porPagina", String(f.porPagina));
  const s = p.toString();
  return s ? `?${s}` : "";
}

const sinPaginacion = (f: FiltrosAuditoria): FiltrosAuditoria => ({
  ...f,
  pagina: undefined,
  porPagina: undefined,
});

export function getAuditoria(f: FiltrosAuditoria = {}) {
  return request<Paginado<RegistroAuditoria>>(`/auditoria${qsAuditoria(f)}`);
}

export function getAuditoriaResumen(f: FiltrosAuditoria = {}) {
  return request<AuditoriaResumen>(
    `/auditoria/resumen${qsAuditoria(sinPaginacion(f))}`,
  );
}

export function getAuditoriaDetalle(id: number) {
  return request<RegistroAuditoriaDetalle>(`/auditoria/${id}`);
}

// El CSV se baja como blob (igual que descargarDocumento): la cookie viaja
// sola con credentials: "include".
export async function exportarAuditoriaCsv(f: FiltrosAuditoria = {}) {
  const res = await fetch(
    `${API_URL}/auditoria/export.csv${qsAuditoria(sinPaginacion(f))}`,
    {
      credentials: "include",
    },
  );
  if (!res.ok)
    throw new ApiError("No se pudo exportar la auditoría", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// "Mi bandeja": lo que espera mi acción, agregado de varios módulos. El
// backend ya lo filtra por RLS + rol.
export interface Pendientes {
  publicaciones: {
    porRevisar: {
      id: string;
      titulo: string;
      secretaria_id: string | null;
      updated_at: string;
    }[];
    porPublicar: {
      id: string;
      titulo: string;
      secretaria_id: string | null;
      aprobado_at: string | null;
    }[];
    rechazadas: {
      id: string;
      titulo: string;
      motivo_rechazo: string | null;
      updated_at: string;
    }[];
  };
  tareas: {
    id: string;
    titulo: string;
    estado: TareaEstado;
    prioridad: TareaPrioridad;
    fecha_vencimiento: string | null;
    vencida: boolean;
  }[];
  compromisos: {
    id: string;
    descripcion: string;
    fecha_limite: string | null;
    evento_id: string;
    reunion: string | null;
    vencido: boolean;
  }[];
  comunicacion: {
    id: string;
    estado: CoberturaEstado;
    evento_titulo: string | null;
    evento_fecha: string | null;
    secretaria_nombre: string | null;
  }[];
  agenda: {
    // Solo jefe_gabinete/admin: todo lo transversal en estado temprano,
    // esperando que la jefa proponga/confirme horario.
    solicitudesPorRevisar: {
      id: string;
      titulo: string;
      estado: EventoEstado;
      fecha_inicio: string | null;
      fecha_fin: string | null;
      created_at: string;
      creado_por_nombre: string | null;
    }[];
    // Solo apoyo: estado de lo que fue registrando.
    misSolicitudes: {
      id: string;
      titulo: string;
      estado: EventoEstado;
      fecha_inicio: string | null;
      fecha_fin: string | null;
      created_at: string;
    }[];
    // Solo jefe_gabinete/admin: indicaciones del Gobernador sin atender.
    indicacionesPendientes: {
      id: string;
      evento_id: string;
      tipo: IndicacionTipo;
      texto: string;
      created_at: string;
      evento_titulo: string;
      autor_nombre: string;
    }[];
  };
  total: number;
}

export function getPendientes() {
  return request<Pendientes>("/pendientes");
}

export interface Documento {
  id: string;
  publicacion_id: string;
  nombre_archivo: string;
  mime: string;
  tamano_bytes: string;
  created_at: string;
}

export function getDocumentos(publicacionId: string) {
  return request<Documento[]>(`/publicaciones/${publicacionId}/documentos`);
}

// Subida multipart: no se pasa Content-Type a mano (el navegador arma el
// boundary de FormData por sí solo).
export async function subirDocumento(publicacionId: string, archivo: File) {
  const form = new FormData();
  form.append("archivo", archivo);
  const res = await fetch(
    `${API_URL}/publicaciones/${publicacionId}/documentos`,
    {
      method: "POST",
      credentials: "include",
      body: form,
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const message = Array.isArray(body.message)
      ? body.message.join(", ")
      : body.message;
    throw new ApiError(message ?? "Error al subir", res.status);
  }
  return res.json() as Promise<Documento>;
}

// Descarga autenticada: se baja como blob y se fuerza el guardado (la cookie
// va sola con credentials: "include", igual que en cualquier otro request).
export async function descargarDocumento(doc: Documento) {
  const res = await fetch(`${API_URL}/documentos/${doc.id}/descargar`, {
    credentials: "include",
  });
  if (!res.ok) throw new ApiError("No se pudo descargar", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.nombre_archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function eliminarDocumento(id: string) {
  return request<{ eliminado: boolean }>(`/documentos/${id}`, {
    method: "DELETE",
  });
}

export type EventoTipo =
  "reunion" | "audiencia" | "inspeccion" | "acto" | "conferencia" | "otro";

// Espejo de evento_estado (029_agenda_solicitudes.sql). DEFAULT en la base
// es 'confirmado' -- lo que ya existía antes de este campo sigue viéndose
// igual.
export type EventoEstado =
  | "solicitud"
  | "tentativo"
  | "confirmado"
  | "cancelado"
  | "realizado"
  | "no_realizado";

// fecha_inicio/fecha_fin quedan como `string` (no nullable) acá a propósito:
// getEventos()/listar() filtran por rango de fechas (WHERE fecha_fin >= ...
// AND fecha_inicio <= ...), así que una 'solicitud' sin horario (ambas en
// NULL) nunca puede aparecer en esa lista -- vive en la bandeja de
// pendientes hasta que alguien le pone horario. Donde sí puede llegar una
// fila con fechas en null es al pedir UN evento puntual por id
// (EventoDetalle, más abajo) -- por ejemplo desde el enlace de la bandeja.
export interface Evento {
  id: string;
  secretaria_id: string | null;
  tipo: EventoTipo;
  titulo: string;
  descripcion: string | null;
  lugar: string | null;
  // Texto libre, provisional (034_agenda_mesa_trabajo.sql) -- no hay
  // todavía un directorio de organizaciones/contactos.
  organizacion_solicitante: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  nivel_confidencialidad: NivelConfidencialidad;
  recordatorios_activos: boolean;
  estado: EventoEstado;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrearEventoInput {
  tipo?: EventoTipo;
  titulo: string;
  descripcion?: string;
  lugar?: string;
  organizacionSolicitante?: string;
  // Opcionales: una "solicitud" de apoyo puede registrarse sin horario
  // todavía (029_agenda_solicitudes.sql). Cualquier otro estado los exige --
  // lo valida el backend/la base, no este tipo.
  fechaInicio?: string;
  fechaFin?: string;
  nivelConfidencialidad: NivelConfidencialidad;
  recordatoriosActivos?: boolean;
  estado?: EventoEstado;
  // Bloqueo optimista (solo tiene sentido al editar, pero vive acá para que
  // actualizarEvento -- que usa Partial<CrearEventoInput> -- lo herede sin
  // un tipo aparte). Ver ApiError.body para leer el 409.
  ifUpdatedAt?: string;
  // Explícito, nunca inferido de confirmar -- ver eventos.service.ts,
  // marcarParticipacionGobernador().
  participaGobernador?: boolean;
}

export interface Participante {
  id: string;
  nombre: string;
  email: string;
}

export interface EventoDetalle extends Omit<
  Evento,
  "fecha_inicio" | "fecha_fin"
> {
  // Acá sí puede venir en null: una 'solicitud' todavía sin horario,
  // llegada por ejemplo desde el enlace de la bandeja de pendientes.
  fecha_inicio: string | null;
  fecha_fin: string | null;
  responsables: Participante[];
  creador: Participante | null;
  // Computado en el backend (no una columna) -- ver EventosService.obtener().
  participaGobernador: boolean;
}

// ---- Indicaciones del Gobernador (032_evento_indicaciones.sql) ----

export type IndicacionTipo = "reprogramar" | "cancelar" | "aclaracion" | "otro";
export type IndicacionEstado = "pendiente" | "aplicada" | "descartada";

export interface Indicacion {
  id: string;
  evento_id: string;
  tipo: IndicacionTipo;
  texto: string;
  estado: IndicacionEstado;
  atendida_at: string | null;
  resultado_nota: string | null;
  created_at: string;
  autor_id: string;
  autor_nombre: string;
  atendida_por_id: string | null;
  atendida_por_nombre: string | null;
}

export function crearIndicacion(
  eventoId: string,
  data: { tipo: IndicacionTipo; texto: string },
) {
  return request<Indicacion>(`/eventos/${eventoId}/indicaciones`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function getIndicaciones(eventoId: string) {
  return request<Indicacion[]>(`/eventos/${eventoId}/indicaciones`);
}

export function atenderIndicacion(
  indicacionId: string,
  data: { estado: "aplicada" | "descartada"; resultadoNota?: string },
) {
  return request<Indicacion>(`/eventos/indicaciones/${indicacionId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function getEvento(id: string) {
  return request<EventoDetalle>(`/eventos/${id}`);
}

export function getEventos(
  desde?: string,
  hasta?: string,
  opciones?: { miParticipacion?: boolean },
) {
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  if (opciones?.miParticipacion) params.set("miParticipacion", "true");
  const qs = params.toString();
  return request<Evento[]>(`/eventos${qs ? `?${qs}` : ""}`);
}

export function crearEvento(data: CrearEventoInput) {
  return request<Evento>("/eventos", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---- Mesa de trabajo (vista de tabla, 034_agenda_mesa_trabajo.sql) ----

export interface MesaTrabajoFila {
  id: string;
  titulo: string;
  organizacion_solicitante: string | null;
  lugar: string | null;
  estado: EventoEstado;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  secretaria_id: string | null;
  updated_at: string;
  // Sale de evento_colaboradores (trabajo delegado), nunca de ser invitado.
  responsable_apoyo_id: string | null;
  responsable_apoyo_nombre: string | null;
  participa_gobernador: boolean;
  indicacion_pendiente_id: string | null;
  indicacion_pendiente_tipo: IndicacionTipo | null;
}

export interface MesaTrabajoFiltro {
  desde?: string;
  hasta?: string;
  busqueda?: string;
  estado?: EventoEstado[];
  responsableApoyoId?: string;
  participaGobernador?: boolean;
  sinHorario?: boolean;
  conIndicacionPendiente?: boolean;
  pagina?: number;
  porPagina?: number;
}

export function getMesaTrabajo(filtro: MesaTrabajoFiltro = {}) {
  const params = new URLSearchParams();
  if (filtro.desde) params.set("desde", filtro.desde);
  if (filtro.hasta) params.set("hasta", filtro.hasta);
  if (filtro.busqueda) params.set("busqueda", filtro.busqueda);
  if (filtro.estado?.length) params.set("estado", filtro.estado.join(","));
  if (filtro.responsableApoyoId)
    params.set("responsableApoyoId", filtro.responsableApoyoId);
  if (filtro.participaGobernador !== undefined)
    params.set("participaGobernador", String(filtro.participaGobernador));
  if (filtro.sinHorario !== undefined)
    params.set("sinHorario", String(filtro.sinHorario));
  if (filtro.conIndicacionPendiente !== undefined)
    params.set("conIndicacionPendiente", String(filtro.conIndicacionPendiente));
  if (filtro.pagina) params.set("pagina", String(filtro.pagina));
  if (filtro.porPagina) params.set("porPagina", String(filtro.porPagina));
  const qs = params.toString();
  return request<Paginado<MesaTrabajoFila>>(
    `/eventos/mesa-trabajo${qs ? `?${qs}` : ""}`,
  );
}

export function getResponsablesMesaTrabajo() {
  return request<Array<{ id: string; nombre: string }>>(
    "/eventos/mesa-trabajo/responsables",
  );
}

// oculto=true: cruza con algo ya agendado del Gobernador que quien pregunta
// no puede ver en detalle (evento confidencial de otra secretaría, etc.) --
// id/titulo vienen null a propósito, nunca se debe intentar "completar" esa
// fila pidiendo el evento por id. Ver fn_disponibilidad_gobernador,
// 028_agenda_seguridad_conflictos.sql.
export interface ConflictoEvento {
  id: string | null;
  titulo: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  oculto: boolean;
}

export function buscarConflictosEvento(data: {
  fechaInicio: string;
  fechaFin: string;
  excluirId?: string;
}) {
  return request<ConflictoEvento[]>("/eventos/conflictos", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function actualizarEvento(id: string, data: Partial<CrearEventoInput>) {
  return request<Evento>(`/eventos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function eliminarEvento(id: string) {
  return request<{ eliminado: boolean }>(`/eventos/${id}`, {
    method: "DELETE",
  });
}

// Colaboración (evento_colaboradores, 029) es trabajo delegado, distinto de
// ser invitado (responsables) -- normalmente lo asigna quien puede editar el
// evento (la jefa). `apoyo` ya queda auto-asignado a lo que crea (backend).
export function reemplazarColaboradoresEvento(
  id: string,
  usuarioIds: string[],
) {
  return request<{ actualizado: boolean }>(`/eventos/${id}/colaboradores`, {
    method: "PUT",
    body: JSON.stringify({ usuarioIds }),
  });
}

export type TareaEstado =
  "pendiente" | "en_progreso" | "completada" | "cancelada";
export type TareaPrioridad = "baja" | "media" | "alta";

export interface TareaAsignado {
  id: string;
  nombre: string;
}

export interface Tarea {
  id: string;
  secretaria_id: string | null;
  titulo: string;
  descripcion: string | null;
  estado: TareaEstado;
  prioridad: TareaPrioridad;
  fecha_vencimiento: string | null;
  nivel_confidencialidad: NivelConfidencialidad;
  creado_por: string | null;
  completada_at: string | null;
  created_at: string;
  updated_at: string;
  asignados: TareaAsignado[];
}

export interface CrearTareaInput {
  titulo: string;
  descripcion?: string;
  prioridad?: TareaPrioridad;
  fechaVencimiento?: string;
  nivelConfidencialidad: NivelConfidencialidad;
  asignadoIds?: string[];
}

export function getTareas() {
  return lista<Tarea>("/tareas");
}

export function crearTarea(data: CrearTareaInput) {
  return request<Tarea>("/tareas", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function actualizarTarea(
  id: string,
  data: Partial<Omit<CrearTareaInput, "asignadoIds">> & {
    estado?: TareaEstado;
  },
) {
  return request<Tarea>(`/tareas/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function eliminarTarea(id: string) {
  return request<{ eliminado: boolean }>(`/tareas/${id}`, { method: "DELETE" });
}

export function asignarTarea(id: string, usuarioIds: string[]) {
  return request<{ actualizado: boolean }>(`/tareas/${id}/asignados`, {
    method: "PUT",
    body: JSON.stringify({ usuarioIds }),
  });
}

export function getMiembros() {
  return request<Participante[]>("/secretarias/miembros");
}

export interface GabineteSecretariaResumen {
  id: string;
  nombre: string;
  publicaciones_revision: number;
  tareas_pendientes: number;
  tareas_vencidas: number;
}

export interface GabineteTareaUrgente {
  id: string;
  titulo: string;
  estado: TareaEstado;
  prioridad: TareaPrioridad;
  fecha_vencimiento: string;
  secretaria_id: string | null;
  secretaria_nombre: string | null;
}

export interface GabineteEventoProximo {
  id: string;
  titulo: string;
  lugar: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  secretaria_id: string | null;
  secretaria_nombre: string | null;
}

export interface GabineteResumen {
  secretarias: GabineteSecretariaResumen[];
  tareasUrgentes: GabineteTareaUrgente[];
  proximosEventos: GabineteEventoProximo[];
  totales: {
    publicaciones_revision: number;
    tareas_pendientes: number;
    tareas_vencidas: number;
    eventos_semana: number;
  };
}

export function getGabineteResumen() {
  return request<GabineteResumen>("/gabinete/resumen");
}

export type ProyectoEstado =
  "planificacion" | "en_ejecucion" | "pausado" | "finalizado" | "cancelado";

export interface Proyecto {
  id: string;
  secretaria_id: string | null;
  nombre: string;
  descripcion: string | null;
  estado: ProyectoEstado;
  avance_porcentaje: number;
  presupuesto: string | null;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  nivel_confidencialidad: NivelConfidencialidad;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrearProyectoInput {
  nombre: string;
  descripcion?: string;
  presupuesto?: number;
  fechaInicio?: string;
  fechaFinEstimada?: string;
  nivelConfidencialidad: NivelConfidencialidad;
}

export interface ActualizarProyectoInput extends Partial<CrearProyectoInput> {
  estado?: ProyectoEstado;
  avancePorcentaje?: number;
}

export function getProyectos() {
  return lista<Proyecto>("/proyectos");
}

export function crearProyecto(data: CrearProyectoInput) {
  return request<Proyecto>("/proyectos", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function actualizarProyecto(id: string, data: ActualizarProyectoInput) {
  return request<Proyecto>(`/proyectos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function eliminarProyecto(id: string) {
  return request<{ eliminado: boolean }>(`/proyectos/${id}`, {
    method: "DELETE",
  });
}

export interface IndicadoresResumen {
  publicacionesPorEstado: { estado: string; total: number }[];
  tareasPorEstado: { estado: string; total: number }[];
  proyectosPorEstado: { estado: string; total: number }[];
  totales: {
    publicaciones_total: number;
    tareas_total: number;
    tareas_vencidas: number;
    proyectos_activos: number;
    avance_promedio: number;
    eventos_mes: number;
  };
}

export function getIndicadoresResumen() {
  return request<IndicadoresResumen>("/indicadores/resumen");
}

export interface ReunionActa {
  evento_id: string;
  contenido: string;
  actualizado_por: string | null;
  created_at: string;
  updated_at: string;
}

export type CompromisoEstado = "pendiente" | "cumplido";

export interface Compromiso {
  id: string;
  evento_id: string;
  descripcion: string;
  responsable_id: string | null;
  responsable_nombre: string | null;
  fecha_limite: string | null;
  estado: CompromisoEstado;
  cumplido_at: string | null;
  created_at: string;
  updated_at: string;
}

export function getActa(eventoId: string) {
  return request<ReunionActa | null>(`/eventos/${eventoId}/acta`);
}

export function guardarActa(eventoId: string, contenido: string) {
  return request<ReunionActa>(`/eventos/${eventoId}/acta`, {
    method: "PUT",
    body: JSON.stringify({ contenido }),
  });
}

export function getCompromisos(eventoId: string) {
  return request<Compromiso[]>(`/eventos/${eventoId}/compromisos`);
}

export function crearCompromiso(
  eventoId: string,
  data: { descripcion: string; responsableId?: string; fechaLimite?: string },
) {
  return request<Compromiso>(`/eventos/${eventoId}/compromisos`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function actualizarCompromiso(
  id: string,
  data: Partial<{
    descripcion: string;
    responsableId: string;
    fechaLimite: string;
    estado: CompromisoEstado;
  }>,
) {
  return request<Compromiso>(`/compromisos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function eliminarCompromiso(id: string) {
  return request<{ eliminado: boolean }>(`/compromisos/${id}`, {
    method: "DELETE",
  });
}

export type RolNombre =
  | "gobernador"
  | "jefe_gabinete"
  | "admin"
  | "unicom"
  | "secretario"
  | "director"
  | "operador"
  | "apoyo";

// ---- Comunicación (cobertura de eventos) ----

export type CoberturaEstado =
  | "solicitada"
  | "planificada"
  | "en_produccion"
  | "lista"
  | "publicada"
  | "descartada";

export interface Cobertura {
  id: string;
  evento_id: string;
  estado: CoberturaEstado;
  solicitada_por: string | null;
  solicitada_at: string;
  comunicador_id: string | null;
  tipo_pieza: string[];
  enfoque: string | null;
  gabinete_visto_at: string | null;
  gabinete_por: string | null;
  publicacion_id: string | null;
  updated_at: string;
  evento_titulo: string | null;
  evento_fecha: string | null;
  evento_lugar: string | null;
  evento_secretaria_id: string | null;
  secretaria_nombre: string | null;
  solicitante_nombre: string | null;
  comunicador_nombre: string | null;
}

export function getCoberturas(
  params: { mes?: string; estado?: string; secretaria?: string } = {},
) {
  const q = new URLSearchParams();
  if (params.mes) q.set("mes", params.mes);
  if (params.estado) q.set("estado", params.estado);
  if (params.secretaria) q.set("secretaria", params.secretaria);
  const s = q.toString();
  return request<Cobertura[]>(`/comunicacion${s ? `?${s}` : ""}`);
}

export function pedirCobertura(eventoId: string) {
  return request<Cobertura>("/comunicacion", {
    method: "POST",
    body: JSON.stringify({ eventoId }),
  });
}

export function actualizarCobertura(
  id: string,
  data: {
    estado?: CoberturaEstado;
    comunicadorId?: string;
    tipoPieza?: string[];
    enfoque?: string;
    publicacionId?: string;
  },
) {
  return request<Cobertura>(`/comunicacion/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function darVistoCobertura(id: string) {
  return request<Cobertura>(`/comunicacion/${id}/gabinete-visto`, {
    method: "POST",
  });
}

export function getEquipoComunicacion() {
  return request<{ id: string; nombre: string }[]>("/comunicacion/equipo");
}

export interface UsuarioAdmin {
  id: string;
  nombre: string;
  email: string;
  secretaria_id: string | null;
  secretaria_nombre: string | null;
  activo: boolean;
  created_at: string;
  rol: RolNombre;
}

export interface CrearUsuarioInput {
  nombre: string;
  email: string;
  password: string;
  rol: RolNombre;
  secretariaId?: string;
}

export interface ActualizarUsuarioInput {
  nombre?: string;
  rol?: RolNombre;
  secretariaId?: string;
  activo?: boolean;
}

export function getUsuarios() {
  return lista<UsuarioAdmin>("/admin/usuarios");
}

export function crearUsuario(data: CrearUsuarioInput) {
  return request<UsuarioAdmin>("/admin/usuarios", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function actualizarUsuario(id: string, data: ActualizarUsuarioInput) {
  return request<UsuarioAdmin>(`/admin/usuarios/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function resetearPassword(id: string, password: string) {
  return request<{ ok: boolean }>(`/admin/usuarios/${id}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

// ---- Despacho ----

export type InstruccionPrioridad = "baja" | "media" | "alta" | "urgente";
export type InstruccionEstado =
  | "emitida"
  | "en_organizacion"
  | "en_ejecucion"
  | "cumplida"
  | "observada"
  | "cancelada";
export type InstruccionItemTipo = "evento" | "tarea" | "proyecto" | "reunion";

export interface Instruccion {
  id: string;
  titulo: string;
  objetivo: string;
  prioridad: InstruccionPrioridad;
  fecha_limite: string | null;
  estado: InstruccionEstado;
  emitida_por: string | null;
  organiza_id: string | null;
  avance_porcentaje: number;
  en_riesgo: boolean;
  created_at: string;
  updated_at: string;
  items_total?: number;
  secretarias?: number;
}

export type ItemEstadoValidacion =
  "en_curso" | "pendiente_validacion" | "validado" | "devuelto";

export interface InstruccionItem {
  id: string;
  tipo: InstruccionItemTipo;
  ref_id: string;
  secretaria_id: string | null;
  secretaria_nombre: string | null;
  estado_validacion: ItemEstadoValidacion;
  peso: number;
  motivo_devolucion: string | null;
  evidencias_count: number;
  detalle: Record<string, unknown> | null;
}

export interface InstruccionVisto {
  usuario_id: string;
  nombre: string;
  abierto_at: string | null;
  acuse_at: string | null;
}

export interface BitacoraEntrada {
  accion: string;
  motivo: string | null;
  created_at: string;
  actor_nombre: string | null;
}

export interface Evidencia {
  id: string;
  tipo: "informe" | "foto" | "documento";
  nombre_archivo: string;
  mime: string;
  tamano_bytes: string;
  nota: string | null;
  created_at: string;
  subido_por_nombre?: string | null;
}

export interface InstruccionDetalle extends Instruccion {
  items: InstruccionItem[];
  vistos: InstruccionVisto[];
  bitacora: BitacoraEntrada[];
}

export function getInstrucciones() {
  return lista<Instruccion>("/despacho/instrucciones");
}

export function getInstruccion(id: string) {
  return request<InstruccionDetalle>(`/despacho/instrucciones/${id}`);
}

export function emitirInstruccion(data: {
  titulo: string;
  objetivo: string;
  prioridad?: InstruccionPrioridad;
  fechaLimite?: string;
  clientToken?: string;
}) {
  return request<Instruccion>("/despacho/instrucciones", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function actualizarInstruccion(
  id: string,
  data: { organizaId?: string; estado?: "observada" | "cancelada" },
) {
  return request<InstruccionDetalle>(`/despacho/instrucciones/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function agregarItemInstruccion(
  id: string,
  data: {
    tipo: InstruccionItemTipo;
    refId?: string;
    secretariaId?: string;
    titulo?: string;
    descripcion?: string;
    prioridad?: "baja" | "media" | "alta";
    fechaVencimiento?: string;
    asignadoIds?: string[];
  },
) {
  return request<InstruccionDetalle>(`/despacho/instrucciones/${id}/items`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function quitarItemInstruccion(id: string, itemId: string) {
  return request<{ eliminado: boolean }>(
    `/despacho/instrucciones/${id}/items/${itemId}`,
    {
      method: "DELETE",
    },
  );
}

export function marcarVistoInstruccion(
  id: string,
  tipo: "visto" | "acuse" = "visto",
) {
  return request<{ ok: boolean }>(`/despacho/instrucciones/${id}/visto`, {
    method: "POST",
    body: JSON.stringify({ tipo }),
  });
}

export function reabrirInstruccion(id: string, motivo: string) {
  return request<InstruccionDetalle>(`/despacho/instrucciones/${id}/reabrir`, {
    method: "POST",
    body: JSON.stringify({ motivo }),
  });
}

export function getBitacoraInstruccion(id: string) {
  return request<BitacoraEntrada[]>(`/despacho/instrucciones/${id}/bitacora`);
}

// --- Validación de ítems ---

// Item-scoped: lo usa el responsable, que no ve la instrucción madre.
export interface DespachoItemDeTarea {
  id: string;
  instruccion_id: string;
  estado_validacion: ItemEstadoValidacion;
  motivo_devolucion: string | null;
  evidencias_count: number;
}

export function getDespachoItemsPorTareas(tareaIds: string[]) {
  if (tareaIds.length === 0)
    return Promise.resolve({} as Record<string, DespachoItemDeTarea>);
  return request<Record<string, DespachoItemDeTarea>>(
    "/despacho/items/por-tareas",
    {
      method: "POST",
      body: JSON.stringify({ tareaIds }),
    },
  );
}

export function solicitarValidacionItem(itemId: string) {
  return request<{
    id: string;
    instruccion_id: string;
    estado_validacion: ItemEstadoValidacion;
    motivo_devolucion: string | null;
  }>(`/despacho/items/${itemId}/solicitar-validacion`, { method: "POST" });
}

export function validarItem(instId: string, itemId: string) {
  return request<InstruccionDetalle>(
    `/despacho/instrucciones/${instId}/items/${itemId}/validar`,
    {
      method: "POST",
    },
  );
}

export function devolverItem(instId: string, itemId: string, motivo: string) {
  return request<InstruccionDetalle>(
    `/despacho/instrucciones/${instId}/items/${itemId}/devolver`,
    {
      method: "POST",
      body: JSON.stringify({ motivo }),
    },
  );
}

// --- Evidencias ---

export function getEvidencias(itemId: string) {
  return request<Evidencia[]>(`/despacho/items/${itemId}/evidencias`);
}

export async function subirEvidencia(
  itemId: string,
  archivo: File,
  tipo?: "informe" | "foto" | "documento",
  nota?: string,
) {
  const form = new FormData();
  form.append("archivo", archivo);
  if (tipo) form.append("tipo", tipo);
  if (nota) form.append("nota", nota);
  const res = await fetch(`${API_URL}/despacho/items/${itemId}/evidencias`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const message = Array.isArray(body.message)
      ? body.message.join(", ")
      : body.message;
    throw new ApiError(message ?? "Error al subir la evidencia", res.status);
  }
  return res.json() as Promise<Evidencia>;
}

export async function descargarEvidencia(ev: Evidencia) {
  const res = await fetch(
    `${API_URL}/despacho/items/evidencias/${ev.id}/descargar`,
    {
      credentials: "include",
    },
  );
  if (!res.ok) throw new ApiError("No se pudo descargar", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ev.nombre_archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Notificaciones ----

export interface Notificacion {
  id: string;
  tipo: string;
  titulo: string;
  cuerpo: string | null;
  enlace: string | null;
  origen_tipo: string | null;
  origen_id: string | null;
  leida: boolean;
  leida_at: string | null;
  created_at: string;
}

export function getNotificaciones(soloNoLeidas = false) {
  return request<Notificacion[]>(
    `/notificaciones${soloNoLeidas ? "?soloNoLeidas=true" : ""}`,
  );
}

export function getConteoNotificaciones() {
  return request<{ noLeidas: number }>("/notificaciones/conteo");
}

export function marcarNotificacionLeida(id: string) {
  return request<{ ok: boolean }>(`/notificaciones/${id}/leida`, {
    method: "POST",
  });
}

export function marcarTodasNotificacionesLeidas() {
  return request<{ actualizadas: number }>("/notificaciones/leer-todas", {
    method: "POST",
  });
}
