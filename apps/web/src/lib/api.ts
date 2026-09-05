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
