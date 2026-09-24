-- Barrido de vencimientos: avisa "vence pronto" (dentro de 24 h) y
-- "vencida/o" para tareas y compromisos abiertos. Mismo mecanismo que
-- fn_despacho_sweep (018): SECURITY DEFINER (salta RLS y escribe en
-- notificaciones) + marcadores de idempotencia para que cada aviso salga una
-- sola vez. Lo agenda VencimientosSweepService cada hora.

ALTER TABLE tareas
  ADD COLUMN venc_recordado_at timestamptz,
  ADD COLUMN venc_vencida_at   timestamptz;

ALTER TABLE compromisos
  ADD COLUMN venc_recordado_at timestamptz,
  ADD COLUMN venc_vencida_at   timestamptz;

-- Se re-arman los avisos si se reprograma la fecha o se reabre el ítem: un
-- deadline nuevo merece un recordatorio nuevo. Estas versiones REEMPLAZAN las
-- de 022/023 (que sólo sellaban cumplido_at / completada_at).
CREATE OR REPLACE FUNCTION fn_tarea_sello_completada() RETURNS trigger AS $$
BEGIN
  IF NEW.estado = 'completada' AND OLD.estado <> 'completada' THEN
    NEW.completada_at := now();
  ELSIF NEW.estado <> 'completada' AND OLD.estado = 'completada' THEN
    NEW.completada_at := NULL;
  END IF;

  IF NEW.fecha_vencimiento IS DISTINCT FROM OLD.fecha_vencimiento
     OR (NEW.estado <> 'completada' AND OLD.estado = 'completada') THEN
    NEW.venc_recordado_at := NULL;
    NEW.venc_vencida_at   := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_compromiso_sello_cumplido() RETURNS trigger AS $$
BEGIN
  IF NEW.estado = 'cumplido' AND OLD.estado <> 'cumplido' THEN
    NEW.cumplido_at := now();
  ELSIF NEW.estado <> 'cumplido' AND OLD.estado = 'cumplido' THEN
    NEW.cumplido_at := NULL;
  END IF;

  IF NEW.fecha_limite IS DISTINCT FROM OLD.fecha_limite
     OR (NEW.estado <> 'cumplido' AND OLD.estado = 'cumplido') THEN
    NEW.venc_recordado_at := NULL;
    NEW.venc_vencida_at   := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_vencimientos_sweep() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_avisos int := 0;
  r        record;
BEGIN
  -- ============================ TAREAS ============================
  FOR r IN
    SELECT id, titulo, creado_por, (fecha_vencimiento < now()) AS vencida
    FROM tareas
    WHERE estado IN ('pendiente', 'en_progreso')
      AND fecha_vencimiento IS NOT NULL
      AND (
        (fecha_vencimiento <  now() AND venc_vencida_at   IS NULL)
        OR (fecha_vencimiento >= now()
            AND fecha_vencimiento < now() + interval '24 hours'
            AND venc_recordado_at IS NULL)
      )
  LOOP
    IF r.vencida THEN
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT ta.usuario_id, 'tarea_vencida', 'Tarea vencida',
             r.titulo, '/tareas', 'tarea', r.id
      FROM tarea_asignados ta WHERE ta.tarea_id = r.id;

      -- Escala al creador si no es también asignado.
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT r.creado_por, 'tarea_vencida', 'Una tarea que creaste venció',
             r.titulo, '/tareas', 'tarea', r.id
      WHERE r.creado_por IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM tarea_asignados ta
          WHERE ta.tarea_id = r.id AND ta.usuario_id = r.creado_por
        );

      UPDATE tareas SET venc_vencida_at = now() WHERE id = r.id;
      v_avisos := v_avisos + 1;
    ELSE
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT ta.usuario_id, 'tarea_por_vencer', 'Tu tarea vence pronto',
             r.titulo, '/tareas', 'tarea', r.id
      FROM tarea_asignados ta WHERE ta.tarea_id = r.id;

      UPDATE tareas SET venc_recordado_at = now() WHERE id = r.id;
      v_avisos := v_avisos + 1;
    END IF;
  END LOOP;

  -- ========================= COMPROMISOS =========================
  FOR r IN
    SELECT c.id, c.descripcion, c.responsable_id,
           e.titulo AS reunion, e.creado_por AS organiza,
           (c.fecha_limite < now()) AS vencido
    FROM compromisos c
    JOIN eventos_agenda e ON e.id = c.evento_id
    WHERE c.estado = 'pendiente'
      AND c.fecha_limite IS NOT NULL
      AND (
        (c.fecha_limite <  now() AND c.venc_vencida_at   IS NULL)
        OR (c.fecha_limite >= now()
            AND c.fecha_limite < now() + interval '24 hours'
            AND c.venc_recordado_at IS NULL)
      )
  LOOP
    IF r.vencido THEN
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT r.responsable_id, 'compromiso_vencido', 'Compromiso vencido',
             r.reunion || ' — ' || r.descripcion, '/reuniones', 'compromiso', r.id
      WHERE r.responsable_id IS NOT NULL;

      -- Escala al organizador de la reunión.
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT r.organiza, 'compromiso_vencido', 'Un compromiso de tu reunión venció',
             r.reunion || ' — ' || r.descripcion, '/reuniones', 'compromiso', r.id
      WHERE r.organiza IS NOT NULL AND r.organiza IS DISTINCT FROM r.responsable_id;

      UPDATE compromisos SET venc_vencida_at = now() WHERE id = r.id;
      v_avisos := v_avisos + 1;
    ELSIF r.responsable_id IS NOT NULL THEN
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      VALUES (r.responsable_id, 'compromiso_por_vencer', 'Tu compromiso vence pronto',
              r.reunion || ' — ' || r.descripcion, '/reuniones', 'compromiso', r.id);
      UPDATE compromisos SET venc_recordado_at = now() WHERE id = r.id;
      v_avisos := v_avisos + 1;
    ELSE
      -- Por vencer y sin responsable: nada que avisar, se marca para no revisitarlo.
      UPDATE compromisos SET venc_recordado_at = now() WHERE id = r.id;
    END IF;
  END LOOP;

  RETURN v_avisos;
END;
$$;
