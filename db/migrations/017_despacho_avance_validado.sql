-- Un ítem 'validado' cuenta como 100% de avance aunque su tarea siga marcada
-- como pendiente (Gabinete puede validar directo). Sin esto quedaba el caso
-- raro "instrucción cumplida / 0% de avance".
CREATE OR REPLACE FUNCTION fn_despacho_recalcular(p_instruccion_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_total       int;
  v_avance      int;
  v_riesgo      boolean;
  v_todos_ok    boolean;
  v_estado_new  instruccion_estado;
  v_estado_old  instruccion_estado;
  v_riesgo_old  boolean;
BEGIN
  SELECT estado, en_riesgo INTO v_estado_old, v_riesgo_old
  FROM instrucciones WHERE id = p_instruccion_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO v_total
  FROM instruccion_items WHERE instruccion_id = p_instruccion_id;

  SELECT COALESCE(ROUND(SUM(progreso * peso)::numeric / NULLIF(SUM(peso), 0))::int, 0)
    INTO v_avance
  FROM (
    SELECT ii.peso,
      CASE
        WHEN ii.estado_validacion = 'validado' THEN 100
        ELSE CASE ii.tipo
          WHEN 'tarea' THEN CASE t.estado
            WHEN 'completada'  THEN 100
            WHEN 'en_progreso' THEN 50
            WHEN 'cancelada'   THEN NULL
            ELSE 0 END
          WHEN 'proyecto' THEN p.avance_porcentaje
          WHEN 'evento'   THEN CASE WHEN e.fecha_fin < now() THEN 100 ELSE 0 END
          WHEN 'reunion'  THEN CASE WHEN e.fecha_fin < now() THEN 100 ELSE 0 END
        END
      END AS progreso
    FROM instruccion_items ii
    LEFT JOIN tareas         t ON ii.tipo = 'tarea'    AND t.id = ii.ref_id
    LEFT JOIN proyectos      p ON ii.tipo = 'proyecto' AND p.id = ii.ref_id
    LEFT JOIN eventos_agenda e ON ii.tipo IN ('evento','reunion') AND e.id = ii.ref_id
    WHERE ii.instruccion_id = p_instruccion_id
  ) x
  WHERE progreso IS NOT NULL;

  SELECT EXISTS (
    SELECT 1
    FROM instruccion_items ii
    LEFT JOIN tareas    t ON ii.tipo = 'tarea'    AND t.id = ii.ref_id
    LEFT JOIN proyectos p ON ii.tipo = 'proyecto' AND p.id = ii.ref_id
    WHERE ii.instruccion_id = p_instruccion_id
      AND ii.estado_validacion <> 'validado'
      AND (
        (ii.tipo = 'tarea'    AND t.fecha_vencimiento  < now()          AND t.estado NOT IN ('completada','cancelada'))
        OR (ii.tipo = 'proyecto' AND p.fecha_fin_estimada < current_date AND p.estado NOT IN ('finalizado','cancelado'))
      )
  ) OR EXISTS (
    SELECT 1 FROM instrucciones i
    WHERE i.id = p_instruccion_id
      AND i.fecha_limite < now()
      AND i.estado NOT IN ('cumplida','observada','cancelada')
  ) INTO v_riesgo;

  IF v_total = 0 THEN
    v_estado_new := v_estado_old;
  ELSE
    SELECT bool_and(
      ii.estado_validacion = 'validado'
      OR (ii.tipo = 'tarea' AND t.estado = 'cancelada')
    ) INTO v_todos_ok
    FROM instruccion_items ii
    LEFT JOIN tareas t ON ii.tipo = 'tarea' AND t.id = ii.ref_id
    WHERE ii.instruccion_id = p_instruccion_id;

    IF v_estado_old IN ('observada','cancelada') THEN
      v_estado_new := v_estado_old;
    ELSIF COALESCE(v_todos_ok, false) THEN
      v_estado_new := 'cumplida';
    ELSE
      v_estado_new := 'en_ejecucion';
    END IF;
  END IF;

  UPDATE instrucciones SET
    avance_porcentaje = v_avance,
    en_riesgo         = v_riesgo,
    estado            = v_estado_new,
    updated_at        = now()
  WHERE id = p_instruccion_id
    AND (avance_porcentaje IS DISTINCT FROM v_avance
      OR en_riesgo         IS DISTINCT FROM v_riesgo
      OR estado            IS DISTINCT FROM v_estado_new);

  IF v_estado_new = 'cumplida' AND v_estado_old <> 'cumplida' THEN
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT emitida_por, 'instruccion_cumplida', 'Instrucción cumplida',
           titulo, '/despacho/' || id, 'instruccion', id
    FROM instrucciones WHERE id = p_instruccion_id AND emitida_por IS NOT NULL;
    INSERT INTO instruccion_bitacora (instruccion_id, actor_id, accion)
    VALUES (p_instruccion_id, NULL, 'cumplida');
  ELSIF v_riesgo AND NOT v_riesgo_old THEN
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT emitida_por, 'instruccion_en_riesgo', 'Una instrucción entró en riesgo',
           titulo, '/despacho/' || id, 'instruccion', id
    FROM instrucciones WHERE id = p_instruccion_id AND emitida_por IS NOT NULL;
  END IF;
END;
$$;
