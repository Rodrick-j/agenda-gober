export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type NivelConfidencialidad = "publica" | "interna" | "reservada" | "confidencial";
export type EstadoPublicacion = "borrador" | "revision" | "aprobado" | "publicado";

export interface Publicacion {
  id: string;
  secretaria_id: string;
  titulo: string;
  contenido: string;
  nivel_confidencialidad: NivelConfidencialidad;
  estado: EstadoPublicacion;
  created_at: string;
  updated_at?: string;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new ApiError(message ?? "Error inesperado", res.status);
  }

  return res.json();
}

export function login(email: string, password: string) {
  return request<{ accessToken: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function getPublicaciones(token: string) {
  return request<Publicacion[]>("/publicaciones", {}, token);
}

export function crearPublicacion(
  token: string,
  data: { titulo: string; contenido: string; nivelConfidencialidad: NivelConfidencialidad },
) {
  return request<Publicacion>("/publicaciones", { method: "POST", body: JSON.stringify(data) }, token);
}

export function actualizarEstado(token: string, id: string, estado: EstadoPublicacion) {
  return request<Publicacion>(
    `/publicaciones/${id}/estado`,
    { method: "PATCH", body: JSON.stringify({ estado }) },
    token,
  );
}

export interface Secretaria {
  id: string;
  nombre: string;
  slug: string;
  activa: boolean;
  publicaciones_visibles: number;
}

export function getSecretarias(token: string) {
  return request<Secretaria[]>("/secretarias", {}, token);
}

export interface RegistroAuditoria {
  id: number;
  tabla: string;
  accion: string;
  registro_id: string;
  datos_anteriores: Record<string, unknown> | null;
  datos_nuevos: Record<string, unknown> | null;
  created_at: string;
  usuario_email: string | null;
}

export function getAuditoria(token: string) {
  return request<RegistroAuditoria[]>("/auditoria", {}, token);
}

export interface Documento {
  id: string;
  publicacion_id: string;
  nombre_archivo: string;
  mime: string;
  tamano_bytes: string;
  created_at: string;
}

export function getDocumentos(token: string, publicacionId: string) {
  return request<Documento[]>(`/publicaciones/${publicacionId}/documentos`, {}, token);
}

// Subida multipart: no se pasa Content-Type a mano (el navegador arma el
// boundary de FormData por sí solo).
export async function subirDocumento(token: string, publicacionId: string, archivo: File) {
  const form = new FormData();
  form.append("archivo", archivo);
  const res = await fetch(`${API_URL}/publicaciones/${publicacionId}/documentos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new ApiError(message ?? "Error al subir", res.status);
  }
  return res.json() as Promise<Documento>;
}

// Descarga autenticada: se baja como blob y se fuerza el guardado, porque el
// endpoint requiere el header Authorization (no se puede usar un <a href>).
export async function descargarDocumento(token: string, doc: Documento) {
  const res = await fetch(`${API_URL}/documentos/${doc.id}/descargar`, {
    headers: { Authorization: `Bearer ${token}` },
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

export function eliminarDocumento(token: string, id: string) {
  return request<{ eliminado: boolean }>(`/documentos/${id}`, { method: "DELETE" }, token);
}

export interface Evento {
  id: string;
  secretaria_id: string | null;
  titulo: string;
  descripcion: string | null;
  lugar: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  nivel_confidencialidad: NivelConfidencialidad;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrearEventoInput {
  titulo: string;
  descripcion?: string;
  lugar?: string;
  fechaInicio: string;
  fechaFin: string;
  nivelConfidencialidad: NivelConfidencialidad;
}

export function getEventos(token: string, desde?: string, hasta?: string) {
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  const qs = params.toString();
  return request<Evento[]>(`/eventos${qs ? `?${qs}` : ""}`, {}, token);
}

export function crearEvento(token: string, data: CrearEventoInput) {
  return request<Evento>("/eventos", { method: "POST", body: JSON.stringify(data) }, token);
}

export function actualizarEvento(token: string, id: string, data: Partial<CrearEventoInput>) {
  return request<Evento>(`/eventos/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token);
}

export function eliminarEvento(token: string, id: string) {
  return request<{ eliminado: boolean }>(`/eventos/${id}`, { method: "DELETE" }, token);
}

export type TareaEstado = "pendiente" | "en_progreso" | "completada" | "cancelada";
export type TareaPrioridad = "baja" | "media" | "alta";

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
  created_at: string;
  updated_at: string;
}

export interface CrearTareaInput {
  titulo: string;
  descripcion?: string;
  prioridad?: TareaPrioridad;
  fechaVencimiento?: string;
  nivelConfidencialidad: NivelConfidencialidad;
}

export function getTareas(token: string) {
  return request<Tarea[]>("/tareas", {}, token);
}

export function crearTarea(token: string, data: CrearTareaInput) {
  return request<Tarea>("/tareas", { method: "POST", body: JSON.stringify(data) }, token);
}

export function actualizarTarea(
  token: string,
  id: string,
  data: Partial<CrearTareaInput> & { estado?: TareaEstado },
) {
  return request<Tarea>(`/tareas/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token);
}

export function eliminarTarea(token: string, id: string) {
  return request<{ eliminado: boolean }>(`/tareas/${id}`, { method: "DELETE" }, token);
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

export function getGabineteResumen(token: string) {
  return request<GabineteResumen>("/gabinete/resumen", {}, token);
}

export type ProyectoEstado = "planificacion" | "en_ejecucion" | "pausado" | "finalizado" | "cancelado";

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

export function getProyectos(token: string) {
  return request<Proyecto[]>("/proyectos", {}, token);
}

export function crearProyecto(token: string, data: CrearProyectoInput) {
  return request<Proyecto>("/proyectos", { method: "POST", body: JSON.stringify(data) }, token);
}

export function actualizarProyecto(token: string, id: string, data: ActualizarProyectoInput) {
  return request<Proyecto>(`/proyectos/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token);
}

export function eliminarProyecto(token: string, id: string) {
  return request<{ eliminado: boolean }>(`/proyectos/${id}`, { method: "DELETE" }, token);
}
