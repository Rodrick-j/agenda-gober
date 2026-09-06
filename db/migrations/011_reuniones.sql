-- Modulo Reuniones: no es una tabla de "reuniones" nueva -- una reunion ES
-- un eventos_agenda (008). Lo que agrega este modulo es el RESULTADO de la
-- reunion: el acta (minuta) y los compromisos (acuerdos con responsable y
-- fecha) que salen de ella.
CREATE TYPE compromiso_estado AS ENUM ('pendiente', 'cumplido');

CREATE TABLE reunion_actas (
  evento_id uuid PRIMARY KEY REFERENCES eventos_agenda(id) ON DELETE CASCADE,
  contenido text NOT NULL,
  actualizado_por uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE compromisos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL REFERENCES eventos_agenda(id) ON DELETE CASCADE,
  descripcion text NOT NULL,
  responsable_id uuid REFERENCES usuarios(id),
  fecha_limite timestamptz,
  estado compromiso_estado NOT NULL DEFAULT 'pendiente',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_compromisos_evento ON compromisos(evento_id);
CREATE INDEX idx_compromisos_responsable ON compromisos(responsable_id);

GRANT SELECT, INSERT, UPDATE ON reunion_actas TO :"app_user_name";
GRANT SELECT, INSERT, UPDATE, DELETE ON compromisos TO :"app_user_name";

ALTER TABLE reunion_actas ENABLE ROW LEVEL SECURITY;
ALTER TABLE reunion_actas FORCE ROW LEVEL SECURITY;
ALTER TABLE compromisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE compromisos FORCE ROW LEVEL SECURITY;

-- Visibilidad completa de un evento (igual que eventos_select: transversal,
-- secretaria+rango, o invitado). SECURITY DEFINER para no repetir el ciclo
-- de recursion ya resuelto en 008 -- esta funcion es nueva (no la de 008,
-- que a proposito NO incluye la via de invitado) porque el acta/compromisos
-- de una reunion los debe poder leer cualquier invitado, sea de la
-- secretaria que sea.
CREATE OR REPLACE FUNCTION fn_evento_visible_completo(p_evento_id uuid) RETURNS boolean
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
        OR EXISTS (
          SELECT 1 FROM evento_responsables er
          WHERE er.evento_id = e.id
            AND er.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        )
      )
  );
$$;

-- Quien puede editar el evento (mismo criterio que eventos_update: rango
-- director+ de su secretaria, o transversal) tambien puede registrar su
-- acta y crear/borrar compromisos.
CREATE OR REPLACE FUNCTION fn_evento_editable_por_actual(p_evento_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM eventos_agenda e
    WHERE e.id = p_evento_id
      AND (
        current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
        OR (
          e.secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
          AND rol_rango(current_setting('app.current_rol', true)) >= rol_rango('director')
        )
      )
  );
$$;

CREATE POLICY reunion_actas_select ON reunion_actas
  FOR SELECT
  USING (fn_evento_visible_completo(evento_id));

CREATE POLICY reunion_actas_insert ON reunion_actas
  FOR INSERT
  WITH CHECK (fn_evento_editable_por_actual(evento_id));

CREATE POLICY reunion_actas_update ON reunion_actas
  FOR UPDATE
  USING (fn_evento_editable_por_actual(evento_id))
  WITH CHECK (fn_evento_editable_por_actual(evento_id));

-- Compromisos: ademas de quien edita el evento, el responsable del
-- compromiso siempre puede ver/actualizar EL SUYO (para marcarlo cumplido)
-- aunque no pertenezca a la secretaria dueña del evento -- mismo espiritu
-- que tareas (009).
CREATE POLICY compromisos_select ON compromisos
  FOR SELECT
  USING (
    responsable_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR fn_evento_visible_completo(evento_id)
  );

CREATE POLICY compromisos_insert ON compromisos
  FOR INSERT
  WITH CHECK (fn_evento_editable_por_actual(evento_id));

CREATE POLICY compromisos_update ON compromisos
  FOR UPDATE
  USING (
    fn_evento_editable_por_actual(evento_id)
    OR responsable_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  WITH CHECK (
    fn_evento_editable_por_actual(evento_id)
    OR responsable_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY compromisos_delete ON compromisos
  FOR DELETE
  USING (fn_evento_editable_por_actual(evento_id));

-- Mismo mecanismo que fn_validar_edicion_tarea (009): RLS deja pasar al
-- responsable a UPDATE, pero solo el trigger puede saber si la fila NUEVA
-- solo cambio el estado -- si quien edita no puede editar el evento entero,
-- se le rechaza cualquier otro cambio.
CREATE OR REPLACE FUNCTION fn_validar_edicion_compromiso() RETURNS trigger AS $$
BEGIN
  IF fn_evento_editable_por_actual(OLD.evento_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.descripcion IS DISTINCT FROM OLD.descripcion
     OR NEW.evento_id IS DISTINCT FROM OLD.evento_id
     OR NEW.responsable_id IS DISTINCT FROM OLD.responsable_id
     OR NEW.fecha_limite IS DISTINCT FROM OLD.fecha_limite
  THEN
    RAISE EXCEPTION 'Solo podés actualizar el estado de un compromiso asignado a vos';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_edicion_compromiso
BEFORE UPDATE ON compromisos
FOR EACH ROW EXECUTE FUNCTION fn_validar_edicion_compromiso();

-- No se puede reusar fn_auditoria_publicaciones acá: usa COALESCE(NEW.id,
-- OLD.id), y reunion_actas no tiene columna "id" -- su PK es evento_id.
CREATE OR REPLACE FUNCTION fn_auditoria_reunion_actas() RETURNS trigger AS $$
BEGIN
  INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, datos_anteriores, datos_nuevos)
  VALUES (
    NULLIF(current_setting('app.current_user_id', true), '')::uuid,
    TG_TABLE_NAME,
    COALESCE(NEW.evento_id, OLD.evento_id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_reunion_actas
AFTER INSERT OR UPDATE ON reunion_actas
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_reunion_actas();

CREATE TRIGGER trg_auditoria_compromisos
AFTER INSERT OR UPDATE OR DELETE ON compromisos
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_publicaciones();

-- Tiempo real solo para compromisos (son accionables, como tareas). El acta
-- es un documento largo que se edita de a ratos, no necesita esto.
CREATE OR REPLACE FUNCTION fn_notify_compromisos() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'compromisos_cambios',
    json_build_object('id', COALESCE(NEW.id, OLD.id), 'accion', TG_OP)::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_compromisos
AFTER INSERT OR UPDATE OR DELETE ON compromisos
FOR EACH ROW EXECUTE FUNCTION fn_notify_compromisos();
