-- Modulo Tareas: seguimiento de pendientes institucionales, con posibilidad
-- de asignar a gente de otra secretaria (igual que evento_responsables en
-- 008). secretaria_id NULL = tarea transversal (gabinete, gobernador).
CREATE TYPE tarea_estado AS ENUM ('pendiente', 'en_progreso', 'completada', 'cancelada');
CREATE TYPE tarea_prioridad AS ENUM ('baja', 'media', 'alta');

CREATE TABLE tareas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secretaria_id uuid REFERENCES secretarias(id),
  titulo text NOT NULL,
  descripcion text,
  estado tarea_estado NOT NULL DEFAULT 'pendiente',
  prioridad tarea_prioridad NOT NULL DEFAULT 'media',
  fecha_vencimiento timestamptz,
  nivel_confidencialidad nivel_confidencialidad NOT NULL DEFAULT 'interna',
  creado_por uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tareas_secretaria ON tareas(secretaria_id);
CREATE INDEX idx_tareas_estado ON tareas(estado);
CREATE INDEX idx_tareas_vencimiento ON tareas(fecha_vencimiento);

-- Asignados: ver/actualizar una tarea por estar asignado a ella no depende
-- de pertenecer a su secretaria (para pedirle algo puntual a otra area).
CREATE TABLE tarea_asignados (
  tarea_id uuid NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (tarea_id, usuario_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON tareas TO :"app_user_name";
GRANT SELECT, INSERT, DELETE ON tarea_asignados TO :"app_user_name";

ALTER TABLE tareas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tareas FORCE ROW LEVEL SECURITY;
ALTER TABLE tarea_asignados ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarea_asignados FORCE ROW LEVEL SECURITY;

-- Mismo criterio que eventos_agenda: secretaria + rango vs. confidencialidad,
-- mas una tercera via por estar asignado, sin importar la secretaria.
CREATE POLICY tareas_select ON tareas
  FOR SELECT
  USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
    OR EXISTS (
      SELECT 1 FROM tarea_asignados ta
      WHERE ta.tarea_id = tareas.id
        AND ta.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY tareas_insert ON tareas
  FOR INSERT
  WITH CHECK (
    (current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin') AND secretaria_id IS NULL)
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
  );

-- A diferencia de eventos, aca SI se deja entrar a un asignado a UPDATE (para
-- que pueda marcar su propia tarea como completada): el trigger de abajo
-- (fn_validar_edicion_tarea) es el que decide que columnas puede tocar cada
-- camino, porque RLS no puede comparar fila vieja vs. nueva en una sola
-- condicion (mismo motivo que fn_validar_transicion_publicacion en 005).
CREATE POLICY tareas_update ON tareas
  FOR UPDATE
  USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= rol_rango('director')
    )
    OR EXISTS (
      SELECT 1 FROM tarea_asignados ta
      WHERE ta.tarea_id = tareas.id
        AND ta.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
    OR EXISTS (
      SELECT 1 FROM tarea_asignados ta
      WHERE ta.tarea_id = tareas.id
        AND ta.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY tareas_delete ON tareas
  FOR DELETE
  USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= rol_rango('director')
    )
  );

-- Un asignado sin rango de director en esa secretaria (o de otra secretaria)
-- pasa la politica tareas_update (arriba) pero solo puede tocar el estado --
-- todo lo demas debe quedar igual. Director+/transversal editan la fila entera.
CREATE OR REPLACE FUNCTION fn_validar_edicion_tarea() RETURNS trigger AS $$
DECLARE
  v_rol text := current_setting('app.current_rol', true);
BEGIN
  IF v_rol IN ('gobernador', 'jefe_gabinete', 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.secretaria_id IS NOT DISTINCT FROM OLD.secretaria_id
     AND OLD.secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
     AND rol_rango(v_rol) >= rol_rango('director')
  THEN
    RETURN NEW; -- director/secretario de la secretaria dueña: edicion completa
  END IF;

  IF NEW.titulo IS DISTINCT FROM OLD.titulo
     OR NEW.descripcion IS DISTINCT FROM OLD.descripcion
     OR NEW.secretaria_id IS DISTINCT FROM OLD.secretaria_id
     OR NEW.prioridad IS DISTINCT FROM OLD.prioridad
     OR NEW.fecha_vencimiento IS DISTINCT FROM OLD.fecha_vencimiento
     OR NEW.nivel_confidencialidad IS DISTINCT FROM OLD.nivel_confidencialidad
     OR NEW.creado_por IS DISTINCT FROM OLD.creado_por
  THEN
    RAISE EXCEPTION 'Solo podés actualizar el estado de una tarea asignada a vos';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_edicion_tarea
BEFORE UPDATE ON tareas
FOR EACH ROW EXECUTE FUNCTION fn_validar_edicion_tarea();

-- Misma funcion SECURITY DEFINER que fn_evento_visible_para_actual (008), y
-- por la misma razon: tarea_asignados no puede "heredar" la visibilidad de
-- tareas con un EXISTS directo porque tareas_select TAMBIEN consulta
-- tarea_asignados (via de "asignado") -> ciclo -> infinite recursion.
CREATE OR REPLACE FUNCTION fn_tarea_visible_para_actual(p_tarea_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM tareas t
    WHERE t.id = p_tarea_id
      AND (
        current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
        OR (
          t.secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
          AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(t.nivel_confidencialidad)
        )
      )
  );
$$;

CREATE POLICY tarea_asignados_select ON tarea_asignados
  FOR SELECT
  USING (
    usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR fn_tarea_visible_para_actual(tarea_id)
  );

CREATE POLICY tarea_asignados_insert ON tarea_asignados
  FOR INSERT
  WITH CHECK (fn_tarea_visible_para_actual(tarea_id));

CREATE POLICY tarea_asignados_delete ON tarea_asignados
  FOR DELETE
  USING (fn_tarea_visible_para_actual(tarea_id));

-- fn_auditoria_publicaciones (001) es generica: solo usa TG_TABLE_NAME /
-- NEW.id / OLD.id / to_jsonb, se reusa tal cual.
CREATE TRIGGER trg_auditoria_tareas
AFTER INSERT OR UPDATE OR DELETE ON tareas
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_publicaciones();

-- Tiempo real: mismo patron que publicaciones/eventos, canal propio.
CREATE OR REPLACE FUNCTION fn_notify_tareas() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'tareas_cambios',
    json_build_object('id', COALESCE(NEW.id, OLD.id), 'accion', TG_OP)::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_tareas
AFTER INSERT OR UPDATE OR DELETE ON tareas
FOR EACH ROW EXECUTE FUNCTION fn_notify_tareas();
