-- Tareas: que avisen igual que Publicaciones (021) y compromisos (022).
--
-- Hoy asignar una tarea sólo dispara pg_notify (realtime del tablero). El
-- asignado no recibe ninguna notificación persistente. Esto agrega:
--   1. completada_at, para medir tiempo de ciclo
--   2. trigger BEFORE que la sella / limpia según el estado
--   3. trigger AFTER en tarea_asignados que notifica al recién asignado
--
-- El servicio pasa a hacer un diff de asignados (ver reemplazarAsignados) en
-- vez de borrar-y-recrear, así este trigger sólo se dispara por gente
-- realmente nueva, no por los que ya estaban.

ALTER TABLE tareas ADD COLUMN completada_at timestamptz;

-- Sella completada_at al cerrar, lo limpia al reabrir. Corre antes que
-- trg_validar_edicion_tarea (009) por orden alfabético ("s" < "v") y sólo
-- toca completada_at -- columna que fn_validar_edicion_tarea NO controla, así
-- que el asignado puede seguir marcando completada la suya.
CREATE OR REPLACE FUNCTION fn_tarea_sello_completada() RETURNS trigger AS $$
BEGIN
  IF NEW.estado = 'completada' AND OLD.estado <> 'completada' THEN
    NEW.completada_at := now();
  ELSIF NEW.estado <> 'completada' AND OLD.estado = 'completada' THEN
    NEW.completada_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tarea_sello_completada
BEFORE UPDATE ON tareas
FOR EACH ROW EXECUTE FUNCTION fn_tarea_sello_completada();

-- Aviso al asignado. SECURITY DEFINER para escribir en notificaciones de otro
-- usuario (mismo mecanismo que Despacho 015). No se avisa a quien se asigna
-- a sí mismo.
CREATE OR REPLACE FUNCTION fn_tarea_asignado_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor  uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  v_tarea  record;
BEGIN
  IF NEW.usuario_id = v_actor THEN
    RETURN NEW;
  END IF;

  SELECT titulo, fecha_vencimiento INTO v_tarea FROM tareas WHERE id = NEW.tarea_id;

  INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
  VALUES (
    NEW.usuario_id,
    'tarea_asignada',
    'Te asignaron una tarea',
    v_tarea.titulo || CASE
      WHEN v_tarea.fecha_vencimiento IS NOT NULL
      THEN ' — vence ' || to_char(v_tarea.fecha_vencimiento AT TIME ZONE 'America/La_Paz', 'DD/MM')
      ELSE ''
    END,
    '/tareas',
    'tarea',
    NEW.tarea_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tarea_asignado_notify
AFTER INSERT ON tarea_asignados
FOR EACH ROW EXECUTE FUNCTION fn_tarea_asignado_notify();
