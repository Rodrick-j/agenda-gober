CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE nivel_confidencialidad AS ENUM ('publica', 'interna', 'reservada', 'confidencial');
CREATE TYPE estado_publicacion AS ENUM ('borrador', 'revision', 'aprobado', 'publicado');

CREATE TABLE secretarias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Catálogo de roles. ambito_secretaria=false => rol transversal (gobernador, gabinete, admin).
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  ambito_secretaria boolean NOT NULL DEFAULT true
);

CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  email text NOT NULL UNIQUE,
  secretaria_id uuid REFERENCES secretarias(id),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuario_roles (
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  secretaria_id uuid REFERENCES secretarias(id),
  PRIMARY KEY (usuario_id, rol_id, secretaria_id)
);

CREATE TABLE publicaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secretaria_id uuid NOT NULL REFERENCES secretarias(id),
  autor_id uuid NOT NULL REFERENCES usuarios(id),
  titulo text NOT NULL,
  contenido text NOT NULL,
  nivel_confidencialidad nivel_confidencialidad NOT NULL DEFAULT 'interna',
  estado estado_publicacion NOT NULL DEFAULT 'borrador',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_publicaciones_secretaria ON publicaciones(secretaria_id);
CREATE INDEX idx_usuario_roles_usuario ON usuario_roles(usuario_id);

-- Auditoría append-only: más abajo se revocan UPDATE/DELETE para todo el mundo.
CREATE TABLE auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id uuid REFERENCES usuarios(id),
  tabla text NOT NULL,
  registro_id uuid NOT NULL,
  accion text NOT NULL,
  datos_anteriores jsonb,
  datos_nuevos jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- La auditoría se llena sola por trigger: nadie puede "olvidarse" de auditar.
CREATE OR REPLACE FUNCTION fn_auditoria_publicaciones() RETURNS trigger AS $$
BEGIN
  INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, datos_anteriores, datos_nuevos)
  VALUES (
    NULLIF(current_setting('app.current_user_id', true), '')::uuid,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_publicaciones
AFTER INSERT OR UPDATE OR DELETE ON publicaciones
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_publicaciones();

-- Limite de conexiones simultaneas: contiene el impacto de un agotamiento de
-- conexiones (por bug o ataque) sin depender de la capa de aplicacion.
ALTER ROLE :"app_user_name" CONNECTION LIMIT 20;

-- Permisos mínimos del rol de aplicación: nunca superusuario, nunca BYPASSRLS.
GRANT USAGE ON SCHEMA public TO :"app_user_name";
GRANT SELECT, INSERT, UPDATE ON secretarias, roles, usuarios, usuario_roles TO :"app_user_name";
GRANT SELECT, INSERT, UPDATE ON publicaciones TO :"app_user_name";
GRANT SELECT, INSERT ON auditoria TO :"app_user_name";

-- FORCE hace que la política aplique incluso al dueño de la tabla (el rol que corrió esta migración).
ALTER TABLE publicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicaciones FORCE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria FORCE ROW LEVEL SECURITY;

-- Estas políticas asumen que el backend, en cada transacción, ejecuta (vía
-- set_config, parametrizado — nunca concatenando el valor en el SQL):
--   SELECT set_config('app.current_rol', '<rol>', true);
--   SELECT set_config('app.current_secretaria_id', '<uuid o vacío>', true);
--   SELECT set_config('app.current_user_id', '<uuid>', true);
-- (No se puede llamar la variable "app.current_role": CURRENT_ROLE es palabra
-- reservada de SQL y rompe la gramática de SET/current_setting.)
-- Sin esto, current_setting(..., true) da NULL y las políticas deniegan por defecto (correcto).

CREATE POLICY publicaciones_select ON publicaciones
  FOR SELECT
  USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete')
    OR secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
  );

CREATE POLICY publicaciones_insert ON publicaciones
  FOR INSERT
  WITH CHECK (
    secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
  );

CREATE POLICY publicaciones_update ON publicaciones
  FOR UPDATE
  USING (secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid)
  WITH CHECK (secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid);

CREATE POLICY auditoria_select ON auditoria
  FOR SELECT
  USING (current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin'));
