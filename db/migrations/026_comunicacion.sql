-- Módulo Comunicación (UNICOM): capa sobre eventos_agenda para planificar la
-- cobertura comunicacional de los eventos. Una secretaría pide cobertura de un
-- evento suyo → UNICOM la planifica → Gabinete da el visto. NO hay tabla de
-- eventos nueva; esto sólo agrega el flujo de cobertura.

-- ---------------------------------------------------------------------------
-- Rol UNICOM: transversal pero acotado a comunicación. Ve el calendario
-- institucional (menos lo confidencial), gestiona coberturas; NO crea ni
-- edita eventos ajenos, NO ve publicaciones de otras áreas.
-- ---------------------------------------------------------------------------
INSERT INTO roles (nombre, ambito_secretaria) VALUES ('unicom', false)
ON CONFLICT (nombre) DO NOTHING;

-- Sólo se le agrega la vía de SELECT a la agenda. Las políticas de
-- insert/update/delete de eventos_agenda quedan igual (UNICOM no las pasa).
ALTER POLICY eventos_select ON eventos_agenda USING (
  current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
  OR (
    secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
    AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
  )
  OR EXISTS (
    SELECT 1 FROM evento_responsables er
    WHERE er.evento_id = eventos_agenda.id
      AND er.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  OR (
    current_setting('app.current_rol', true) = 'unicom'
    AND nivel_confidencialidad <> 'confidencial'
  )
);

-- ---------------------------------------------------------------------------
-- Cobertura
-- ---------------------------------------------------------------------------
CREATE TYPE cobertura_estado AS ENUM (
  'solicitada', 'planificada', 'en_produccion', 'lista', 'publicada', 'descartada'
);

CREATE TABLE cobertura (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL UNIQUE REFERENCES eventos_agenda(id) ON DELETE CASCADE,
  estado cobertura_estado NOT NULL DEFAULT 'solicitada',
  solicitada_por uuid REFERENCES usuarios(id),
  solicitada_at timestamptz NOT NULL DEFAULT now(),
  comunicador_id uuid REFERENCES usuarios(id),
  tipo_pieza text[] NOT NULL DEFAULT '{}',
  enfoque text,
  gabinete_visto_at timestamptz,
  gabinete_por uuid REFERENCES usuarios(id),
  publicacion_id uuid REFERENCES publicaciones(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cobertura_estado ON cobertura(estado);

GRANT SELECT, INSERT, UPDATE ON cobertura TO :"app_user_name";

ALTER TABLE cobertura ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobertura FORCE ROW LEVEL SECURITY;

-- Rompe el ciclo cobertura↔eventos_agenda (mismo motivo que
-- fn_evento_visible_completo en 011): SECURITY DEFINER, corre como el rol
-- admin (superusuario acá) y bypasea RLS, así consultar eventos_agenda desde
-- adentro no vuelve a disparar eventos_select.
CREATE OR REPLACE FUNCTION fn_evento_de_mi_secretaria(p_evento_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM eventos_agenda e
    WHERE e.id = p_evento_id
      AND e.secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
  );
$$;

CREATE POLICY cobertura_select ON cobertura
  FOR SELECT USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin', 'unicom')
    OR fn_evento_de_mi_secretaria(evento_id)
  );

-- Pedir cobertura: director+ de la secretaría dueña del evento, o UNICOM.
CREATE POLICY cobertura_insert ON cobertura
  FOR INSERT WITH CHECK (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin', 'unicom')
    OR (
      fn_evento_de_mi_secretaria(evento_id)
      AND rol_rango(current_setting('app.current_rol', true)) >= rol_rango('director')
    )
  );

-- Planificar / avanzar estado: UNICOM + transversales. La secretaría dueña
-- sólo mira.
CREATE POLICY cobertura_update ON cobertura
  FOR UPDATE
  USING (current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin', 'unicom'))
  WITH CHECK (current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin', 'unicom'));

-- El visto de Gabinete lo pone SÓLO un rol transversal, aunque UNICOM también
-- pueda hacer UPDATE de la fila (RLS no filtra por columna → trigger).
CREATE OR REPLACE FUNCTION fn_cobertura_sello() RETURNS trigger AS $$
DECLARE
  v_rol   text := current_setting('app.current_rol', true);
  v_actor uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
BEGIN
  IF NEW.gabinete_visto_at IS DISTINCT FROM OLD.gabinete_visto_at THEN
    IF v_rol NOT IN ('gobernador', 'jefe_gabinete', 'admin') THEN
      RAISE EXCEPTION 'Sólo Gabinete puede dar el visto de una cobertura';
    END IF;
    NEW.gabinete_por := CASE WHEN NEW.gabinete_visto_at IS NOT NULL THEN v_actor END;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cobertura_sello
BEFORE UPDATE ON cobertura
FOR EACH ROW EXECUTE FUNCTION fn_cobertura_sello();

-- Notificaciones (mismo esqueleto que Publicaciones/Reuniones/Tareas).
CREATE OR REPLACE FUNCTION fn_cobertura_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  v_ev    record;
BEGIN
  SELECT titulo, fecha_inicio INTO v_ev FROM eventos_agenda WHERE id = NEW.evento_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT u.id, 'cobertura_solicitada', 'Piden cobertura de comunicación',
           COALESCE(v_ev.titulo, 'Evento') || ' — ' ||
           to_char(v_ev.fecha_inicio AT TIME ZONE 'America/La_Paz', 'DD/MM'),
           '/comunicacion', 'cobertura', NEW.id
    FROM usuarios u
    JOIN usuario_roles ur ON ur.usuario_id = u.id
    JOIN roles r          ON r.id = ur.rol_id
    WHERE r.nombre = 'unicom' AND u.activo = true;
    RETURN NEW;
  END IF;

  IF NEW.estado = 'lista' AND OLD.estado <> 'lista' THEN
    -- Lista para el visto de Gabinete.
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT u.id, 'cobertura_lista', 'Cobertura lista para tu visto',
           COALESCE(v_ev.titulo, 'Evento'), '/comunicacion', 'cobertura', NEW.id
    FROM usuarios u
    JOIN usuario_roles ur ON ur.usuario_id = u.id
    JOIN roles r          ON r.id = ur.rol_id
    WHERE r.nombre = 'jefe_gabinete' AND u.activo = true;

    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT NEW.solicitada_por, 'cobertura_lista', 'Tu cobertura está lista',
           COALESCE(v_ev.titulo, 'Evento'), '/comunicacion', 'cobertura', NEW.id
    WHERE NEW.solicitada_por IS NOT NULL AND NEW.solicitada_por IS DISTINCT FROM v_actor;

  ELSIF NEW.gabinete_visto_at IS NOT NULL AND OLD.gabinete_visto_at IS NULL THEN
    -- Gabinete dio el visto.
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT NEW.comunicador_id, 'cobertura_visto', 'Gabinete dio el visto a la cobertura',
           COALESCE(v_ev.titulo, 'Evento'), '/comunicacion', 'cobertura', NEW.id
    WHERE NEW.comunicador_id IS NOT NULL AND NEW.comunicador_id IS DISTINCT FROM v_actor;

    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT NEW.solicitada_por, 'cobertura_visto', 'Gabinete dio el visto a tu cobertura',
           COALESCE(v_ev.titulo, 'Evento'), '/comunicacion', 'cobertura', NEW.id
    WHERE NEW.solicitada_por IS NOT NULL
      AND NEW.solicitada_por IS DISTINCT FROM v_actor
      AND NEW.solicitada_por IS DISTINCT FROM NEW.comunicador_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cobertura_notify
AFTER INSERT OR UPDATE ON cobertura
FOR EACH ROW EXECUTE FUNCTION fn_cobertura_notify();

-- fn_auditoria_publicaciones (001) es genérica: se reusa.
CREATE TRIGGER trg_auditoria_cobertura
AFTER INSERT OR UPDATE ON cobertura
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_publicaciones();
