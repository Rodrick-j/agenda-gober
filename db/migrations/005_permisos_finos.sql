-- Rango de cada rol dentro de una secretaria (los roles transversales -
-- gobernador/jefe_gabinete/admin- no usan esto, ya tienen acceso total).
CREATE OR REPLACE FUNCTION rol_rango(p_rol text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_rol
    WHEN 'operador' THEN 1
    WHEN 'director' THEN 2
    WHEN 'secretario' THEN 3
    ELSE 0
  END;
$$;

-- Rango minimo requerido para ver/asignar cada nivel de confidencialidad.
CREATE OR REPLACE FUNCTION nivel_rango(p_nivel nivel_confidencialidad) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_nivel
    WHEN 'publica' THEN 1
    WHEN 'interna' THEN 1
    WHEN 'reservada' THEN 2
    WHEN 'confidencial' THEN 3
    ELSE 1
  END;
$$;

-- Las politicas de 001 solo miraban secretaria_id. Ahora tambien exigen que
-- el rango del rol alcance el rango del nivel de confidencialidad de la fila.
DROP POLICY publicaciones_select ON publicaciones;
CREATE POLICY publicaciones_select ON publicaciones
  FOR SELECT
  USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
  );

DROP POLICY publicaciones_insert ON publicaciones;
CREATE POLICY publicaciones_insert ON publicaciones
  FOR INSERT
  WITH CHECK (
    secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
    AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
  );

DROP POLICY publicaciones_update ON publicaciones;
CREATE POLICY publicaciones_update ON publicaciones
  FOR UPDATE
  USING (
    secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
    AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
  )
  WITH CHECK (
    secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
    AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
  );

-- Maquina de estados de publicaciones.estado. RLS no puede comparar fila
-- vieja vs. nueva en una sola condicion, asi que la transicion se valida acá,
-- con un trigger (corre siempre, sin importar si la query vino de la API o
-- de un cliente SQL directo).
CREATE OR REPLACE FUNCTION fn_validar_transicion_publicacion() RETURNS trigger AS $$
DECLARE
  v_rango int := rol_rango(current_setting('app.current_rol', true));
BEGIN
  IF current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin') THEN
    RETURN NEW; -- roles transversales no tienen restriccion de transicion
  END IF;

  IF NEW.secretaria_id <> OLD.secretaria_id OR NEW.autor_id <> OLD.autor_id THEN
    RAISE EXCEPTION 'secretaria_id y autor_id no se pueden modificar';
  END IF;

  IF OLD.estado = NEW.estado THEN
    RETURN NEW; -- edicion de contenido sin cambio de estado
  END IF;

  IF OLD.estado = 'borrador' AND NEW.estado = 'revision' THEN
    RETURN NEW; -- cualquier rol de la secretaria pide revision
  ELSIF OLD.estado = 'revision' AND NEW.estado = 'aprobado' AND v_rango >= rol_rango('director') THEN
    RETURN NEW; -- director o secretario aprueban
  ELSIF OLD.estado = 'aprobado' AND NEW.estado = 'publicado' AND v_rango >= rol_rango('secretario') THEN
    RETURN NEW; -- solo secretario publica
  ELSIF NEW.estado = 'borrador' AND v_rango >= rol_rango('director') THEN
    RETURN NEW; -- director o secretario devuelven a borrador (rechazo) desde cualquier estado
  ELSE
    RAISE EXCEPTION 'Transición de estado no permitida: % -> % (rol %)',
      OLD.estado, NEW.estado, current_setting('app.current_rol', true);
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_transicion_publicacion
BEFORE UPDATE ON publicaciones
FOR EACH ROW EXECUTE FUNCTION fn_validar_transicion_publicacion();
