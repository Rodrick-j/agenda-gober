-- Mantiene una unica version optimista del evento aunque el cambio ocurra
-- en una relacion derivada (participantes, colaboradores o indicaciones).
-- La actualizacion del padre reutiliza su trigger eventos_cambios existente;
-- asi la mesa se refresca y un formulario con ifUpdatedAt viejo obtiene 409.

BEGIN;

CREATE OR REPLACE FUNCTION fn_notify_evento_relacion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_evento_id uuid;
BEGIN
  v_evento_id := COALESCE(NEW.evento_id, OLD.evento_id);

  UPDATE eventos_agenda
  SET updated_at = clock_timestamp()
  WHERE id = v_evento_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMIT;
