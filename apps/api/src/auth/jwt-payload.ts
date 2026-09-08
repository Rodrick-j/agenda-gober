// El access token lleva lo mínimo: quién y qué sesión. rol / secretaría /
// activo se releen de la base en cada request (ver JwtStrategy.validate), así
// un cambio de rol o una baja de usuario tienen efecto inmediato.
export interface JwtPayload {
  sub: string; // usuario_id
  sid: string; // sesion_id
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  rol: string;
  secretariaId: string | null;
  sid: string;
}
