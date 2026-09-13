-- Indicaciones del Gobernador: la pieza que quedó pendiente del diseño
-- original (docs/arquitectura/06-propuesta-agenda-prioritaria.md, decisión
-- #1) y que el usuario confirmó que SÍ entra en este alcance. El Gobernador
-- no edita el evento directamente (eso lo hace la jefa, ver
-- 033_eventos_agenda_gobernador_no_escribe.sql, aplicada junto con esta) --
-- en cambio, dirige una acción escrita: pedir reprogramación, cancelación o
-- aclaración sobre un evento puntual. La jefa la recibe, la atiende (aplica
-- el cambio con el mecanismo normal de PATCH /eventos/:id) y la marca
-- aplicada/descartada con una nota. Mientras está pendiente, la
-- programación vigente del evento no cambia sola -- la indicación es un
-- registro de pedido, no un mecanismo de auto-aplicación (evita que un
-- texto libre como "reprogramar para el jueves" se intente parsear e
-- interpretar mal).

BEGIN;

CREATE TYPE indicacion_tipo AS ENUM ('reprogramar', 'cancelar', 'aclaracion', 'otro');
CREATE TYPE indicacion_estado AS ENUM ('pendiente', 'aplicada', 'descartada');

CREATE TABLE evento_indicaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL REFERENCES eventos_agenda(id) ON DELETE CASCADE,
  autor_id uuid NOT NULL REFERENCES usuarios(id),
  tipo indicacion_tipo NOT NULL,
  texto text NOT NULL,
  estado indicacion_estado NOT NULL DEFAULT 'pendiente',
  atendida_por uuid REFERENCES usuarios(id),
  atendida_at timestamptz,
  resultado_nota text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- "Mostrar si está pendiente o atendida" de forma consistente a nivel de
-- base, no solo de convención de aplicación: pendiente <=> sin atender.
ALTER TABLE evento_indicaciones ADD CONSTRAINT indicacion_atencion_consistente CHECK (
  (estado = 'pendiente' AND atendida_por IS NULL AND atendida_at IS NULL)
  OR (estado IN ('aplicada', 'descartada') AND atendida_por IS NOT NULL AND atendida_at IS NOT NULL)
);

CREATE INDEX idx_evento_indicaciones_evento ON evento_indicaciones(evento_id);

GRANT SELECT, INSERT, UPDATE ON evento_indicaciones TO :"app_user_name";

ALTER TABLE evento_indicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE evento_indicaciones FORCE ROW LEVEL SECURITY;

-- Visible para su autor (el Gobernador que la escribió) y para quien
-- coordina la agenda del Gabinete (jefe_gabinete/admin) -- mismo criterio
-- acotado que ya se usó para fn_disponibilidad_gobernador: no cualquier
-- autenticado, solo los roles de este recorrido.
CREATE POLICY evento_indicaciones_select ON evento_indicaciones
  FOR SELECT
  USING (
    autor_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.current_rol', true) IN ('jefe_gabinete', 'admin')
  );

-- Solo el Gobernador emite indicaciones, siempre como autor de sí mismo,
-- siempre nace pendiente (no se puede insertar ya "resuelta").
CREATE POLICY evento_indicaciones_insert ON evento_indicaciones
  FOR INSERT
  WITH CHECK (
    current_setting('app.current_rol', true) = 'gobernador'
    AND autor_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    AND estado = 'pendiente'
  );

-- Solo jefe_gabinete/admin marcan una indicación como atendida/descartada.
-- El Gobernador NO puede editar su propia indicación después de creada
-- (ni siquiera retractarla) -- si se equivocó, el flujo institucional es
-- que hable con la jefa, no que reescriba en silencio un pedido que ya
-- pudo haber sido leído.
CREATE POLICY evento_indicaciones_update ON evento_indicaciones
  FOR UPDATE
  USING (current_setting('app.current_rol', true) IN ('jefe_gabinete', 'admin'))
  WITH CHECK (current_setting('app.current_rol', true) IN ('jefe_gabinete', 'admin'));

-- "Conservar autor y fecha": inmutables a nivel de trigger, no solo de
-- convención -- ni siquiera jefe_gabinete/admin (autorizados a hacer
-- UPDATE por la política de arriba) pueden reescribir qué se pidió, quién
-- lo pidió o cuándo. Solo estado/atendida_por/atendida_at/resultado_nota
-- pueden cambiar.
CREATE OR REPLACE FUNCTION fn_evento_indicacion_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.evento_id <> OLD.evento_id OR NEW.autor_id <> OLD.autor_id
     OR NEW.tipo <> OLD.tipo OR NEW.texto <> OLD.texto
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'No se puede modificar el contenido original de la indicación, solo su atención';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evento_indicacion_inmutable
BEFORE UPDATE ON evento_indicaciones
FOR EACH ROW EXECUTE FUNCTION fn_evento_indicacion_inmutable();

-- "Debe llegar a la jefa": mismo patrón sello+trigger AFTER que el resto
-- del sistema (fn_notify_evento_estado, 029). SECURITY DEFINER porque
-- necesita leer eventos_agenda.titulo sin depender de la RLS de quien
-- dispara el trigger (que aquí siempre es gobernador, que sí puede leer
-- cualquier evento -- pero se fija el patrón igual, por consistencia con el
-- resto de triggers de notificación de este módulo).
CREATE OR REPLACE FUNCTION fn_notify_indicacion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_titulo text;
BEGIN
  SELECT titulo INTO v_titulo FROM public.eventos_agenda WHERE id = NEW.evento_id;
  INSERT INTO public.notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
  SELECT u.id, 'indicacion_gobernador', 'Indicación del Gobernador',
         COALESCE(v_titulo, '(evento)') || ' · ' || NEW.tipo::text,
         '/agenda?evento=' || NEW.evento_id, 'evento_indicacion', NEW.id
  FROM public.usuario_roles ur
  JOIN public.usuarios u ON u.id = ur.usuario_id
  JOIN public.roles r ON r.id = ur.rol_id
  WHERE r.nombre = 'jefe_gabinete' AND u.activo = true;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_indicacion
AFTER INSERT ON evento_indicaciones
FOR EACH ROW EXECUTE FUNCTION fn_notify_indicacion();

-- Trazabilidad: mismo trigger de auditoría genérico que usa el resto del
-- sistema (fn_auditoria_publicaciones, 001 -- pese al nombre, genérica).
CREATE TRIGGER trg_auditoria_evento_indicaciones
AFTER INSERT OR UPDATE OR DELETE ON evento_indicaciones
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_publicaciones();

COMMIT;
