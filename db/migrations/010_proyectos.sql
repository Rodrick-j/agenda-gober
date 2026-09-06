-- Modulo Proyectos: obras/programas institucionales, sin la via de
-- "asignado" que tienen eventos/tareas (un proyecto pertenece a una
-- secretaria, punto -- si despues hace falta colaboracion cruzada se agrega
-- una tabla proyecto_colaboradores igual que evento_responsables).
CREATE TYPE proyecto_estado AS ENUM ('planificacion', 'en_ejecucion', 'pausado', 'finalizado', 'cancelado');

CREATE TABLE proyectos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secretaria_id uuid REFERENCES secretarias(id),
  nombre text NOT NULL,
  descripcion text,
  estado proyecto_estado NOT NULL DEFAULT 'planificacion',
  avance_porcentaje int NOT NULL DEFAULT 0 CHECK (avance_porcentaje BETWEEN 0 AND 100),
  presupuesto numeric(14,2),
  fecha_inicio date,
  fecha_fin_estimada date,
  nivel_confidencialidad nivel_confidencialidad NOT NULL DEFAULT 'interna',
  creado_por uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_proyectos_secretaria ON proyectos(secretaria_id);
CREATE INDEX idx_proyectos_estado ON proyectos(estado);

GRANT SELECT, INSERT, UPDATE, DELETE ON proyectos TO :"app_user_name";

ALTER TABLE proyectos ENABLE ROW LEVEL SECURITY;
ALTER TABLE proyectos FORCE ROW LEVEL SECURITY;

-- Mismo criterio base que publicaciones/eventos: secretaria + rango vs.
-- confidencialidad, o transversal sin restriccion.
CREATE POLICY proyectos_select ON proyectos
  FOR SELECT
  USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
  );

CREATE POLICY proyectos_insert ON proyectos
  FOR INSERT
  WITH CHECK (
    (current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin') AND secretaria_id IS NULL)
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
  );

-- Editar (incluye avance_porcentaje) exige rango director+, igual que
-- eventos_update: un proyecto institucional no lo reprograma un operador.
CREATE POLICY proyectos_update ON proyectos
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

CREATE POLICY proyectos_delete ON proyectos
  FOR DELETE
  USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= rol_rango('director')
    )
  );

CREATE TRIGGER trg_auditoria_proyectos
AFTER INSERT OR UPDATE OR DELETE ON proyectos
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_publicaciones();

CREATE OR REPLACE FUNCTION fn_notify_proyectos() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'proyectos_cambios',
    json_build_object('id', COALESCE(NEW.id, OLD.id), 'accion', TG_OP)::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_proyectos
AFTER INSERT OR UPDATE OR DELETE ON proyectos
FOR EACH ROW EXECUTE FUNCTION fn_notify_proyectos();
