-- Recorrido mínimo: apoyo registra una solicitud (incluso sin horario) ->
-- la jefa la revisa y propone/confirma horario -> el Gobernador la ve en
-- "Mi jornada". Solo lo necesario para ESE recorrido -- no incluye
-- indicaciones del Gobernador, organizaciones/contactos, ni las demás
-- piezas de la propuesta original (quedan para entregas siguientes).
--
-- El Gobernador sigue el modelo ya acordado: no escribe directo en la
-- agenda en este lote (no se le da ninguna pantalla ni endpoint de
-- edición) -- "Mi jornada" es de solo lectura. No se toca eventos_update/
-- insert/delete para restringir a `gobernador` (eso es la pieza de
-- "indicaciones", que sigue pendiente y fuera de este recorrido); por
-- ahora alcanza con no exponerle ninguna acción de escritura en la UI.

BEGIN;

-- 1) Estado del evento ----------------------------------------------------
--
-- DEFAULT 'confirmado' preserva el comportamiento actual para toda fila
-- existente y para cualquier flujo que no sepa de este estado -- no se
-- ejecuta ningún UPDATE sobre filas existentes (ALTER TABLE ADD COLUMN con
-- DEFAULT no dispara triggers ni reescribe fecha_inicio/recordatorios, así
-- que fn_evento_reset_recordatorios de 027 no se activa por esto).
CREATE TYPE evento_estado AS ENUM (
  'solicitud', 'tentativo', 'confirmado', 'cancelado', 'realizado', 'no_realizado'
);

ALTER TABLE eventos_agenda
  ADD COLUMN estado evento_estado NOT NULL DEFAULT 'confirmado';

-- Fecha opcional SOLO en 'solicitud' -- "registro corto, incluso sin
-- horario". Cualquier otro estado exige fecha_inicio/fecha_fin (no tendría
-- sentido un 'tentativo' o 'confirmado' sin horario).
ALTER TABLE eventos_agenda ALTER COLUMN fecha_inicio DROP NOT NULL;
ALTER TABLE eventos_agenda ALTER COLUMN fecha_fin DROP NOT NULL;
ALTER TABLE eventos_agenda DROP CONSTRAINT fechas_validas;
ALTER TABLE eventos_agenda ADD CONSTRAINT fechas_validas CHECK (
  (fecha_inicio IS NULL AND fecha_fin IS NULL)
  OR (fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL AND fecha_fin >= fecha_inicio)
);
ALTER TABLE eventos_agenda ADD CONSTRAINT estado_requiere_fecha CHECK (
  estado = 'solicitud' OR (fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL)
);

-- 2) Rol apoyo --------------------------------------------------------------
--
-- Transversal en el sentido de "sin secretaria_id" (ambito_secretaria=false,
-- mismo precedente que unicom, 026_comunicacion.sql), pero SIN el alcance de
-- supervisión de jefe_gabinete -- nunca se agrega a las ramas "ve/edita todo"
-- de ninguna política existente. Su acceso sale exclusivamente de ser
-- colaborador de un evento puntual (ver más abajo).
INSERT INTO roles (nombre, ambito_secretaria) VALUES ('apoyo', false)
ON CONFLICT (nombre) DO NOTHING;

-- 3) Colaboración asignada -- distinta de ser invitado -----------------------
--
-- evento_responsables (008) es participación (asiste). Esta tabla es
-- trabajo delegado (puede editar mientras el evento está en etapas
-- tempranas). Estar en una NO implica estar en la otra -- ver comentario en
-- eventos_update más abajo: ningún invitado, por estar invitado, obtiene
-- permiso de edición, y eso no cambia para apoyo tampoco.
CREATE TABLE evento_colaboradores (
  evento_id uuid NOT NULL REFERENCES eventos_agenda(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  asignado_por uuid REFERENCES usuarios(id),
  asignado_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (evento_id, usuario_id)
);

GRANT SELECT, INSERT, DELETE ON evento_colaboradores TO :"app_user_name";

ALTER TABLE evento_colaboradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE evento_colaboradores FORCE ROW LEVEL SECURITY;

-- Mismo patrón que evento_responsables_select (008): cada quien ve su propia
-- fila de colaboración (para poder descubrir que lo es) o, si ya puede ver
-- el evento completo por otra vía, ve la lista entera. fn_evento_visible_para_actual
-- ya existe (008) y no consulta evento_colaboradores, así que no hay ciclo.
CREATE POLICY evento_colaboradores_select ON evento_colaboradores
  FOR SELECT
  USING (
    usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR fn_evento_visible_para_actual(evento_id)
  );

-- Asignar/retirar colaboradores es, en general, una decisión de quien puede
-- EDITAR el evento (la jefa) -- fn_evento_editable_por_actual ya existe
-- (008) y exige transversal o secretaria+rango director+. Además, apoyo
-- puede agregarse A SÍ MISMO (nunca a otra persona) en un evento que ÉL
-- MISMO creó -- así puede registrar su solicitud y de inmediato quedar con
-- acceso de trabajo sobre ella, sin depender de que la jefa actúe primero.
CREATE POLICY evento_colaboradores_insert ON evento_colaboradores
  FOR INSERT
  WITH CHECK (
    fn_evento_editable_por_actual(evento_id)
    OR (
      current_setting('app.current_rol', true) = 'apoyo'
      AND usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      AND EXISTS (
        SELECT 1 FROM eventos_agenda e
        WHERE e.id = evento_id
          AND e.creado_por = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  );

CREATE POLICY evento_colaboradores_delete ON evento_colaboradores
  FOR DELETE
  USING (fn_evento_editable_por_actual(evento_id));

-- 4) Extender eventos_select: colaborador ve el evento completo -------------
--
-- Mismo criterio que ya vale para invitados (evento_responsables): estar
-- en evento_colaboradores es una tercera vía de VISIBILIDAD (no de
-- escritura -- eso se agrega aparte, en eventos_update/insert más abajo).
-- Sin ciclo: evento_colaboradores_select usa fn_evento_visible_para_actual,
-- que no consulta esta política.
ALTER POLICY eventos_select ON eventos_agenda
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
    OR EXISTS (
      SELECT 1 FROM evento_colaboradores ec
      WHERE ec.evento_id = eventos_agenda.id
        AND ec.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

-- 5) Insertar: apoyo puede registrar una solicitud/tentativo transversal ----
--
-- Igual que gobernador/jefe_gabinete, sin secretaria_id -- pero acotado a
-- estados tempranos: apoyo nunca inserta directo en 'confirmado' (ni en
-- 'cancelado'/'realizado'/'no_realizado', que no tendría sentido al crear).
ALTER POLICY eventos_insert ON eventos_agenda
  WITH CHECK (
    (current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin') AND secretaria_id IS NULL)
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
    OR (
      current_setting('app.current_rol', true) = 'apoyo'
      AND secretaria_id IS NULL
      AND estado IN ('solicitud', 'tentativo')
    )
  );

-- 6) Editar: apoyo, solo mientras el evento sigue en etapa temprana ---------
--
-- USING se evalúa contra la fila VIEJA (¿puedo tocar esto?): apoyo puede si
-- es colaborador Y el estado actual todavía es temprano. WITH CHECK se
-- evalúa contra la fila NUEVA (¿en qué la puedo dejar?): apoyo no puede
-- dejarla en 'confirmado'/'cancelado'/'realizado'/'no_realizado' -- eso
-- exige ser transversal o secretaria+rango director+, igual que hoy. Así
-- se cumple, a nivel de base de datos y no solo de interfaz, que "el apoyo
-- no confirma ni cancela por su cuenta".
ALTER POLICY eventos_update ON eventos_agenda
  USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= rol_rango('director')
    )
    OR (
      current_setting('app.current_rol', true) = 'apoyo'
      AND estado IN ('solicitud', 'tentativo')
      AND EXISTS (
        SELECT 1 FROM evento_colaboradores ec
        WHERE ec.evento_id = eventos_agenda.id
          AND ec.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
    OR (
      current_setting('app.current_rol', true) = 'apoyo'
      AND estado IN ('solicitud', 'tentativo')
      AND EXISTS (
        SELECT 1 FROM evento_colaboradores ec
        WHERE ec.evento_id = eventos_agenda.id
          AND ec.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  );

-- 7) fn_disponibilidad_gobernador: sumar apoyo a la lista permitida ---------
--
-- "El apoyo tendrá esa capacidad cuando se implemente su rol" -- ya está.
-- A diferencia de gobernador/jefe_gabinete (transversales, para quienes esta
-- función siempre devuelve vacío porque ya ven todo por eventos_select),
-- apoyo SÍ puede tener huecos de visibilidad reales (eventos de otras
-- secretarías, o transversales donde no es colaborador) -- para apoyo esta
-- función deja de estar dormida.
CREATE OR REPLACE FUNCTION fn_disponibilidad_gobernador(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_excluir_id uuid DEFAULT NULL
) RETURNS TABLE(fecha_inicio timestamptz, fecha_fin timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT e.fecha_inicio, e.fecha_fin
  FROM public.eventos_agenda e
  WHERE current_setting('app.current_rol', true) = ANY (ARRAY['gobernador', 'jefe_gabinete', 'apoyo'])
    AND e.fecha_inicio < p_hasta
    AND e.fecha_fin > p_desde
    AND (p_excluir_id IS NULL OR e.id <> p_excluir_id)
    AND (
      EXISTS (
        SELECT 1 FROM public.usuario_roles ur
        JOIN public.roles r ON r.id = ur.rol_id
        WHERE r.nombre = 'gobernador' AND ur.usuario_id = e.creado_por
      )
      OR EXISTS (
        SELECT 1 FROM public.evento_responsables er
        JOIN public.usuario_roles ur ON ur.usuario_id = er.usuario_id
        JOIN public.roles r ON r.id = ur.rol_id
        WHERE er.evento_id = e.id AND r.nombre = 'gobernador'
      )
    )
    AND NOT (
      current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
      OR (
        e.secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
        AND public.rol_rango(current_setting('app.current_rol', true)) >= public.nivel_rango(e.nivel_confidencialidad)
      )
      OR EXISTS (
        SELECT 1 FROM public.evento_responsables er2
        WHERE er2.evento_id = e.id
          AND er2.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
      OR EXISTS (
        SELECT 1 FROM public.evento_colaboradores ec2
        WHERE ec2.evento_id = e.id
          AND ec2.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    );
$$;

-- 8) Notificaciones del recorrido (reusa notificaciones, mismo patrón de
--    sello+trigger AFTER que el resto del sistema) -------------------------
--
-- Solicitud nueva -> avisa a todo jefe_gabinete (que la revise). Pasa a
-- confirmado -> avisa a quien la creó y a quien haya quedado en
-- evento_responsables (ahí, tras confirmar, está el Gobernador si
-- corresponde -- ver EventosService.actualizar). Pasa a
-- cancelado/no_realizado -> avisa a quien la creó, con el motivo si lo hay
-- (reutiliza `descripcion`, no se agrega columna nueva para esto en este
-- lote mínimo).
CREATE OR REPLACE FUNCTION fn_notify_evento_estado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.estado = 'solicitud' THEN
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT u.id, 'solicitud_agenda', 'Nueva solicitud de agenda',
           NEW.titulo, '/agenda?evento=' || NEW.id, 'evento', NEW.id
    FROM usuario_roles ur
    JOIN usuarios u ON u.id = ur.usuario_id
    JOIN roles r ON r.id = ur.rol_id
    WHERE r.nombre = 'jefe_gabinete' AND u.activo = true;

  ELSIF TG_OP = 'UPDATE' AND NEW.estado = 'confirmado' AND OLD.estado IS DISTINCT FROM 'confirmado' THEN
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT DISTINCT d.usuario_id, 'evento_confirmado', 'Actividad confirmada',
           NEW.titulo || COALESCE(' · ' || to_char(NEW.fecha_inicio AT TIME ZONE 'America/La_Paz', 'DD/MM/YYYY HH24:MI'), ''),
           '/agenda?evento=' || NEW.id, 'evento', NEW.id
    FROM (
      SELECT NEW.creado_por AS usuario_id
      UNION
      SELECT er.usuario_id FROM evento_responsables er WHERE er.evento_id = NEW.id
    ) d
    WHERE d.usuario_id IS NOT NULL;

  ELSIF TG_OP = 'UPDATE' AND NEW.estado IN ('cancelado', 'no_realizado')
        AND OLD.estado IS DISTINCT FROM NEW.estado THEN
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT NEW.creado_por, 'evento_no_confirmado', 'Solicitud no confirmada',
           NEW.titulo, '/agenda?evento=' || NEW.id, 'evento', NEW.id
    WHERE NEW.creado_por IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_evento_estado
AFTER INSERT OR UPDATE OF estado ON eventos_agenda
FOR EACH ROW EXECUTE FUNCTION fn_notify_evento_estado();

COMMIT;
