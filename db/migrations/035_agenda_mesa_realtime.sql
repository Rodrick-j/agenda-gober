-- La mesa de trabajo muestra datos derivados de tres relaciones del evento:
-- participantes (Gobernador), colaboradores (apoyo responsable) e
-- indicaciones pendientes. Antes, solo un UPDATE de eventos_agenda emitía
-- eventos_cambios; modificar cualquiera de estas relaciones dejaba la tabla
-- abierta con datos viejos hasta un refresco manual.

BEGIN;

CREATE OR REPLACE FUNCTION fn_notify_evento_relacion() RETURNS trigger AS $$
DECLARE
  evento_id_afectado uuid;
BEGIN
  evento_id_afectado := COALESCE(NEW.evento_id, OLD.evento_id);
  PERFORM pg_notify(
    'eventos_cambios',
    json_build_object('id', evento_id_afectado, 'accion', 'UPDATE')::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_evento_responsables
AFTER INSERT OR UPDATE OR DELETE ON evento_responsables
FOR EACH ROW EXECUTE FUNCTION fn_notify_evento_relacion();

CREATE TRIGGER trg_notify_evento_colaboradores
AFTER INSERT OR UPDATE OR DELETE ON evento_colaboradores
FOR EACH ROW EXECUTE FUNCTION fn_notify_evento_relacion();

CREATE TRIGGER trg_notify_evento_indicaciones
AFTER INSERT OR UPDATE OR DELETE ON evento_indicaciones
FOR EACH ROW EXECUTE FUNCTION fn_notify_evento_relacion();

COMMIT;
