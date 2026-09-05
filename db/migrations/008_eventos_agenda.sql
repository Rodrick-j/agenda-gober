-- Modulo Agenda: eventos institucionales (reuniones, actividades, actos).
-- secretaria_id NULL = evento transversal (gabinete, gobernador).
CREATE TABLE eventos_agenda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secretaria_id uuid REFERENCES secretarias(id),
  titulo text NOT NULL,
  descripcion text,
  lugar text,
  fecha_inicio timestamptz NOT NULL,
  fecha_fin timestamptz NOT NULL,
  nivel_confidencialidad nivel_confidencialidad NOT NULL DEFAULT 'interna',
  creado_por uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fechas_validas CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX idx_eventos_secretaria ON eventos_agenda(secretaria_id);
CREATE INDEX idx_eventos_rango_fechas ON eventos_agenda(fecha_inicio, fecha_fin);

-- Invitados/responsables de un evento. Ver un evento por estar invitado no
-- depende de pertenecer a su secretaria (ver politica eventos_select).
CREATE TABLE evento_responsables (
  evento_id uuid NOT NULL REFERENCES eventos_agenda(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (evento_id, usuario_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON eventos_agenda TO :"app_user_name";
GRANT SELECT, INSERT, DELETE ON evento_responsables TO :"app_user_name";

ALTER TABLE eventos_agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_agenda FORCE ROW LEVEL SECURITY;
ALTER TABLE evento_responsables ENABLE ROW LEVEL SECURITY;
ALTER TABLE evento_responsables FORCE ROW LEVEL SECURITY;

-- Mismo criterio que publicaciones (secretaria + rango vs. confidencialidad),
-- mas una tercera via: ver el evento si sos uno de sus invitados, sin
-- importar de que secretaria seas (para reuniones inter-secretariales).
CREATE POLICY eventos_select ON eventos_agenda
  FOR SELECT
  USING (
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
  );

-- Crear: un rol transversal puede crear eventos transversales (sin
-- secretaria); un rol de secretaria solo dentro de la suya y sin superar su
-- rango de confidencialidad permitido.
CREATE POLICY eventos_insert ON eventos_agenda
  FOR INSERT
  WITH CHECK (
    (current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin') AND secretaria_id IS NULL)
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
  );

-- Editar/cancelar: igual que crear, pero sin la via de "invitado" (estar
-- invitado te deja ver el evento, no modificarlo). Ademas exige rango
-- director+ para no dejar que cualquier operador reprograme una reunion.
CREATE POLICY eventos_update ON eventos_agenda
  FOR UPDATE
  USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= rol_rango('director')
    )
  )
  WITH CHECK (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
  );

CREATE POLICY eventos_delete ON eventos_agenda
  FOR DELETE
  USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= rol_rango('director')
    )
  );

-- OJO con esto: NO se puede hacer "la visibilidad de evento_responsables
-- hereda de eventos_agenda" con un EXISTS directo (como documentos hereda de
-- publicaciones), porque eventos_select TAMBIEN consulta evento_responsables
-- (para la via de "invitado") -> ciclo -> "infinite recursion detected in
-- policy for relation eventos_agenda". Se rompe el ciclo con una funcion
-- SECURITY DEFINER: como la crea el rol admin (superusuario en este
-- entorno), corre bypaseando RLS, asi que consultar eventos_agenda desde
-- adentro no vuelve a disparar eventos_select.
CREATE OR REPLACE FUNCTION fn_evento_visible_para_actual(p_evento_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM eventos_agenda e
    WHERE e.id = p_evento_id
      AND (
        current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
        OR (
          e.secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
          AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(e.nivel_confidencialidad)
        )
      )
  );
$$;

-- Ademas de fn_evento_visible_para_actual, un invitado siempre puede ver SU
-- PROPIA fila de invitacion -- si no, no habria forma de que eventos_select
-- descubra que esta invitado (necesita leer esta tabla para saberlo).
CREATE POLICY evento_responsables_select ON evento_responsables
  FOR SELECT
  USING (
    usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR fn_evento_visible_para_actual(evento_id)
  );

CREATE POLICY evento_responsables_insert ON evento_responsables
  FOR INSERT
  WITH CHECK (fn_evento_visible_para_actual(evento_id));

CREATE POLICY evento_responsables_delete ON evento_responsables
  FOR DELETE
  USING (fn_evento_visible_para_actual(evento_id));

-- fn_auditoria_publicaciones (001) es generica pese al nombre: solo usa
-- TG_TABLE_NAME / NEW.id / OLD.id / to_jsonb, nada especifico de
-- publicaciones. Se reusa tal cual para no duplicar el trigger.
CREATE TRIGGER trg_auditoria_eventos_agenda
AFTER INSERT OR UPDATE OR DELETE ON eventos_agenda
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_publicaciones();

-- Tiempo real: mismo patron que publicaciones (006), canal propio para que
-- el backend sepa contra que tabla volver a consultar.
CREATE OR REPLACE FUNCTION fn_notify_eventos() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'eventos_cambios',
    json_build_object('id', COALESCE(NEW.id, OLD.id), 'accion', TG_OP)::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_eventos
AFTER INSERT OR UPDATE OR DELETE ON eventos_agenda
FOR EACH ROW EXECUTE FUNCTION fn_notify_eventos();
