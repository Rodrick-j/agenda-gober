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

// credentials: "include" en cada request: la sesión vive en una cookie
// httpOnly (access_token) que el navegador adjunta solo -- nunca hay un
// token legible por JavaScript que pasar a mano acá.
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  // Nest manda el body totalmente vacío (Content-Length: 0) cuando un
  // handler devuelve null -- no el string "null" -- así que res.json()
  // revienta con "Unexpected end of JSON input". Se lee como texto primero
  // y solo se parsea si hay algo, tanto acá como en la rama de error.
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    throw new ApiError(message ?? res.statusText ?? "Error inesperado", res.status);
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
  return request<{ user: SesionUsuario }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
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
  return request<Publicacion[]>("/publicaciones");
}

export function crearPublicacion(data: { titulo: string; contenido: string; nivelConfidencialidad: NivelConfidencialidad }) {
  return request<Publicacion>("/publicaciones", { method: "POST", body: JSON.stringify(data) });
}

export function actualizarEstado(id: string, estado: EstadoPublicacion) {
  return request<Publicacion>(`/publicaciones/${id}/estado`, { method: "PATCH", body: JSON.stringify({ estado }) });
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
  return request<Secretaria>("/admin/secretarias", { method: "POST", body: JSON.stringify(data) });
}

export function actualizarSecretaria(id: string, data: ActualizarSecretariaInput) {
  return request<Secretaria>(`/admin/secretarias/${id}`, { method: "PATCH", body: JSON.stringify(data) });
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

export function getAuditoria() {
  return request<RegistroAuditoria[]>("/auditoria");
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
  const res = await fetch(`${API_URL}/publicaciones/${publicacionId}/documentos`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new ApiError(message ?? "Error al subir", res.status);
  }
  return res.json() as Promise<Documento>;
}

// Descarga autenticada: se baja como blob y se fuerza el guardado (la cookie
// va sola con credentials: "include", igual que en cualquier otro request).
export async function descargarDocumento(doc: Documento) {
  const res = await fetch(`${API_URL}/documentos/${doc.id}/descargar`, { credentials: "include" });
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
  return request<{ eliminado: boolean }>(`/documentos/${id}`, { method: "DELETE" });
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

export interface Participante {
  id: string;
  nombre: string;
  email: string;
}

export interface EventoDetalle extends Evento {
  responsables: Participante[];
  creador: Participante | null;
}

export function getEvento(id: string) {
  return request<EventoDetalle>(`/eventos/${id}`);
}

export function getEventos(desde?: string, hasta?: string) {
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  const qs = params.toString();
  return request<Evento[]>(`/eventos${qs ? `?${qs}` : ""}`);
}

export function crearEvento(data: CrearEventoInput) {
  return request<Evento>("/eventos", { method: "POST", body: JSON.stringify(data) });
}

export function actualizarEvento(id: string, data: Partial<CrearEventoInput>) {
  return request<Evento>(`/eventos/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function eliminarEvento(id: string) {
  return request<{ eliminado: boolean }>(`/eventos/${id}`, { method: "DELETE" });
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

export function getTareas() {
  return request<Tarea[]>("/tareas");
}

export function crearTarea(data: CrearTareaInput) {
  return request<Tarea>("/tareas", { method: "POST", body: JSON.stringify(data) });
}

export function actualizarTarea(id: string, data: Partial<CrearTareaInput> & { estado?: TareaEstado }) {
  return request<Tarea>(`/tareas/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function eliminarTarea(id: string) {
  return request<{ eliminado: boolean }>(`/tareas/${id}`, { method: "DELETE" });
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

export function getProyectos() {
  return request<Proyecto[]>("/proyectos");
}

export function crearProyecto(data: CrearProyectoInput) {
  return request<Proyecto>("/proyectos", { method: "POST", body: JSON.stringify(data) });
}

export function actualizarProyecto(id: string, data: ActualizarProyectoInput) {
  return request<Proyecto>(`/proyectos/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function eliminarProyecto(id: string) {
  return request<{ eliminado: boolean }>(`/proyectos/${id}`, { method: "DELETE" });
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
  created_at: string;
  updated_at: string;
}

export function getActa(eventoId: string) {
  return request<ReunionActa | null>(`/eventos/${eventoId}/acta`);
}

export function guardarActa(eventoId: string, contenido: string) {
  return request<ReunionActa>(`/eventos/${eventoId}/acta`, { method: "PUT", body: JSON.stringify({ contenido }) });
}

export function getCompromisos(eventoId: string) {
  return request<Compromiso[]>(`/eventos/${eventoId}/compromisos`);
}

export function crearCompromiso(eventoId: string, data: { descripcion: string; responsableId?: string; fechaLimite?: string }) {
  return request<Compromiso>(`/eventos/${eventoId}/compromisos`, { method: "POST", body: JSON.stringify(data) });
}

export function actualizarCompromiso(
  id: string,
  data: Partial<{ descripcion: string; responsableId: string; fechaLimite: string; estado: CompromisoEstado }>,
) {
  return request<Compromiso>(`/compromisos/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function eliminarCompromiso(id: string) {
  return request<{ eliminado: boolean }>(`/compromisos/${id}`, { method: "DELETE" });
}

export type RolNombre = "gobernador" | "jefe_gabinete" | "admin" | "secretario" | "director" | "operador";

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
  return request<UsuarioAdmin[]>("/admin/usuarios");
}

export function crearUsuario(data: CrearUsuarioInput) {
  return request<UsuarioAdmin>("/admin/usuarios", { method: "POST", body: JSON.stringify(data) });
}

export function actualizarUsuario(id: string, data: ActualizarUsuarioInput) {
  return request<UsuarioAdmin>(`/admin/usuarios/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function resetearPassword(id: string, password: string) {
  return request<{ ok: boolean }>(`/admin/usuarios/${id}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}
