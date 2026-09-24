-- Reuniones lote A1: que los compromisos avisen.
--
-- Hoy crear un compromiso con responsable sólo dispara pg_notify (realtime si
-- justo tenés la página abierta). Si no, el responsable no se entera de que le
-- encomendaron algo en una reunión. Mismo patrón que Publicaciones (021) y
-- Despacho (015): trigger AFTER SECURITY DEFINER que escribe en notificaciones.
-- Además se agrega cumplido_at para poder medir "cerrado en N días".

ALTER TABLE compromisos ADD COLUMN cumplido_at timestamptz;

-- Sella cumplido_at al cerrar, lo limpia al reabrir. BEFORE, en el contexto
-- del que edita. Convive con trg_validar_edicion_compromiso (011): por orden
-- alfabético "compromiso" < "validar" corre primero, y sólo escribe
-- cumplido_at -- una columna que fn_validar_edicion_compromiso no controla,
-- así que el responsable puede seguir marcando cumplido el suyo.
CREATE OR REPLACE FUNCTION fn_compromiso_sello_cumplido() RETURNS trigger AS $$
BEGIN
  IF NEW.estado = 'cumplido' AND OLD.estado <> 'cumplido' THEN
    NEW.cumplido_at := now();
  ELSIF NEW.estado <> 'cumplido' AND OLD.estado = 'cumplido' THEN
    NEW.cumplido_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_compromiso_sello_cumplido
BEFORE UPDATE ON compromisos
FOR EACH ROW EXECUTE FUNCTION fn_compromiso_sello_cumplido();

-- Aviso al responsable cuando se le asigna un compromiso (al crearlo, o al
-- cambiarle el responsable). No se avisa al que hace la acción sobre sí mismo.
CREATE OR REPLACE FUNCTION fn_compromiso_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor         uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  v_titulo_reunion text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.responsable_id IS NULL OR NEW.responsable_id = v_actor THEN
      RETURN NEW;
    END IF;
  ELSE -- UPDATE
    IF NEW.responsable_id IS NULL
       OR NEW.responsable_id IS NOT DISTINCT FROM OLD.responsable_id
       OR NEW.responsable_id = v_actor THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT titulo INTO v_titulo_reunion FROM eventos_agenda WHERE id = NEW.evento_id;

  INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
  VALUES (
    NEW.responsable_id,
    'compromiso_asignado',
    'Te asignaron un compromiso',
    COALESCE(v_titulo_reunion, 'Reunión') || ' — ' || NEW.descripcion,
    '/reuniones',
    'compromiso',
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_compromiso_notify
AFTER INSERT OR UPDATE ON compromisos
FOR EACH ROW EXECUTE FUNCTION fn_compromiso_notify();
