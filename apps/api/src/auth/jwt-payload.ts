export interface JwtPayload {
  sub: string; // usuario_id
  email: string;
  rol: string;
  secretariaId: string | null;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  rol: string;
  secretariaId: string | null;
}
