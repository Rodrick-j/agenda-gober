export interface SesionUsuario {
  userId: string;
  email: string;
  rol: string;
  secretariaId: string | null;
}

const TOKEN_KEY = "agenda_gober_token";

export function guardarToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function obtenerToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function cerrarSesion() {
  localStorage.removeItem(TOKEN_KEY);
}

// Decodifica el payload del JWT solo para mostrar quién sos en la UI -- NO
// valida la firma. La autorización real la decide siempre el backend
// (RLS + trigger); esto es puramente cosmético.
export function decodificarSesion(token: string): SesionUsuario | null {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return {
      userId: json.sub,
      email: json.email,
      rol: json.rol,
      secretariaId: json.secretariaId ?? null,
    };
  } catch {
    return null;
  }
}
