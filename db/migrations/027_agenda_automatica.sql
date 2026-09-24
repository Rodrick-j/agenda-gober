-- Agenda automática v1:
--   * clasificación del evento para plantillas y lectura visual;
--   * recordatorios configurables a 24 h, 2 h y 15 min;
--   * marcadores idempotentes para que cada aviso salga una sola vez.

BEGIN;

CREATE TYPE evento_tipo AS ENUM (
  'reunion', 'audiencia', 'inspeccion', 'acto', 'conferencia', 'otro'
);

ALTER TABLE eventos_agenda
  ADD COLUMN tipo evento_tipo NOT NULL DEFAULT 'reunion',
  ADD COLUMN recordatorios_activos boolean NOT NULL DEFAULT true,
  ADD COLUMN recordatorio_24h_at timestamptz,
  ADD COLUMN recordatorio_2h_at  timestamptz,
  ADD COLUMN recordatorio_15m_at timestamptz;

-- Reprogramar o volver a activar recordatorios abre un nuevo ciclo de avisos.
CREATE OR REPLACE FUNCTION fn_evento_reset_recordatorios() RETURNS trigger AS $$
BEGIN
  IF NEW.fecha_inicio IS DISTINCT FROM OLD.fecha_inicio
     OR (NEW.recordatorios_activos AND NOT OLD.recordatorios_activos) THEN
    NEW.recordatorio_24h_at := NULL;
    NEW.recordatorio_2h_at  := NULL;
    NEW.recordatorio_15m_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_evento_reset_recordatorios
BEFORE UPDATE OF fecha_inicio, recordatorios_activos ON eventos_agenda
FOR EACH ROW EXECUTE FUNCTION fn_evento_reset_recordatorios();

-- SECURITY DEFINER: el barrido corre fuera de un request y debe poder leer
-- todos los eventos y escribir en la bandeja privada de cada destinatario.
CREATE OR REPLACE FUNCTION fn_agenda_recordatorios_sweep() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r record;
  v_avisos int := 0;
  v_tipo text;
  v_titulo text;
BEGIN
  FOR r IN
    SELECT e.id, e.titulo, e.lugar, e.fecha_inicio, e.creado_por,
           e.recordatorio_24h_at, e.recordatorio_2h_at, e.recordatorio_15m_at
    FROM eventos_agenda e
    WHERE e.recordatorios_activos = true
      AND e.fecha_inicio > now()
      AND e.fecha_inicio <= now() + interval '24 hours'
      AND (
        e.recordatorio_24h_at IS NULL
        OR (e.fecha_inicio <= now() + interval '2 hours'  AND e.recordatorio_2h_at  IS NULL)
        OR (e.fecha_inicio <= now() + interval '15 min'   AND e.recordatorio_15m_at IS NULL)
      )
    ORDER BY e.fecha_inicio
  LOOP
    IF r.fecha_inicio <= now() + interval '15 min' AND r.recordatorio_15m_at IS NULL THEN
      v_tipo := 'evento_en_15m';
      v_titulo := 'Tu evento comienza en 15 minutos';
      UPDATE eventos_agenda SET
        recordatorio_15m_at = now(),
        recordatorio_2h_at  = COALESCE(recordatorio_2h_at, now()),
        recordatorio_24h_at = COALESCE(recordatorio_24h_at, now())
      WHERE id = r.id;
    ELSIF r.fecha_inicio <= now() + interval '2 hours' AND r.recordatorio_2h_at IS NULL THEN
      v_tipo := 'evento_en_2h';
      v_titulo := 'Tu evento comienza en menos de 2 horas';
      UPDATE eventos_agenda SET
        recordatorio_2h_at  = now(),
        recordatorio_24h_at = COALESCE(recordatorio_24h_at, now())
      WHERE id = r.id;
    ELSIF r.recordatorio_24h_at IS NULL THEN
      v_tipo := 'evento_en_24h';
      v_titulo := 'Evento próximo en tu agenda';
      UPDATE eventos_agenda SET recordatorio_24h_at = now() WHERE id = r.id;
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO notificaciones
      (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT DISTINCT d.usuario_id,
           v_tipo,
           v_titulo,
           r.titulo || ' · ' ||
             to_char(r.fecha_inicio AT TIME ZONE 'America/La_Paz', 'DD/MM/YYYY HH24:MI') ||
             CASE WHEN r.lugar IS NOT NULL AND r.lugar <> '' THEN ' · ' || r.lugar ELSE '' END,
           '/agenda', 'evento', r.id
    FROM (
      SELECT r.creado_por AS usuario_id
      UNION
      SELECT er.usuario_id FROM evento_responsables er WHERE er.evento_id = r.id
    ) d
    WHERE d.usuario_id IS NOT NULL;

    v_avisos := v_avisos + 1;
  END LOOP;

  RETURN v_avisos;
END;
$$;

COMMIT;
