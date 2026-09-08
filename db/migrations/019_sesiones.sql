-- Sesiones para refresh tokens y revocación.
--
-- access token  -> JWT corto (15 min), cookie httpOnly access_token, payload
--                  mínimo { sub, sid }. La identidad real (rol, secretaría,
--                  activo) se relee de la base en CADA request.
-- refresh token -> string opaco de alta entropía (30 días), cookie httpOnly
--                  refresh_token con path /auth. Se guarda sólo su sha256.
--
-- Efecto: desactivar un usuario o cambiarle el rol corta la sesión al
-- instante (antes había una ventana de 2 h con el JWT stateless).
--
-- Sin RLS a propósito, igual que usuarios / usuario_roles: se consulta desde
-- JwtStrategy.validate con el pool crudo, ANTES de que exista contexto de
-- sesión que una política pudiera evaluar. AuthService es el único escritor y
-- filtra cada query por id / usuario_id / refresh_hash.
CREATE TABLE sesiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  refresh_hash text NOT NULL UNIQUE,
  user_agent text,
  ip text,
  creada_at timestamptz NOT NULL DEFAULT now(),
  ultima_actividad timestamptz NOT NULL DEFAULT now(),
  expira_at timestamptz NOT NULL,
  revocada_at timestamptz
);

-- Para listar/revocar las sesiones activas de un usuario.
CREATE INDEX idx_sesiones_usuario_activas ON sesiones(usuario_id) WHERE revocada_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON sesiones TO :"app_user_name";
