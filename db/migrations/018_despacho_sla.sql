-- Despacho lote 5: barrido programado de SLA de acuse + recálculo de riesgo
-- cuando nadie está usando la app.
--
-- Toda la lógica vive en fn_despacho_sweep (SECURITY DEFINER, corre como
-- superusuario para saltarse RLS y escribir en notificaciones). El
-- DespachoSweepService del backend solo la llama cada N minutos, protegida
-- con pg_try_advisory_lock para que en multi-instancia la corra una sola.

ALTER TABLE instrucciones
  ADD COLUMN acuse_recordado_at timestamptz,
  ADD COLUMN acuse_escalado_at  timestamptz;

CREATE OR REPLACE FUNCTION fn_despacho_sweep() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_avisos int := 0;
  r        record;
  v_sla    interval;
BEGIN
  -- 1. Recalcular las instrucciones abiertas que todavía no están en riesgo:
  --    si venció un ítem hijo (o la propia fecha_limite) y nadie tocó nada,
  --    fn_despacho_recalcular las marca y avisa (una sola vez).
  FOR r IN
    SELECT id FROM instrucciones
    WHERE estado IN ('emitida', 'en_organizacion', 'en_ejecucion')
      AND en_riesgo = false
  LOOP
    PERFORM fn_despacho_recalcular(r.id);
  END LOOP;

  -- 2. SLA de acuse: instrucción 'emitida' donde ningún jefe_gabinete acusó
  --    recibo todavía.
  FOR r IN
    SELECT i.id, i.prioridad, i.emitida_por, i.titulo, i.created_at,
           i.acuse_recordado_at, i.acuse_escalado_at
    FROM instrucciones i
    WHERE i.estado = 'emitida'
      AND NOT EXISTS (
        SELECT 1
        FROM vistos v
        JOIN usuario_roles ur ON ur.usuario_id = v.usuario_id
        JOIN roles rr          ON rr.id = ur.rol_id
        WHERE v.entidad_tipo = 'instruccion' AND v.entidad_id = i.id
          AND v.acuse_at IS NOT NULL
          AND rr.nombre = 'jefe_gabinete'
      )
  LOOP
    v_sla := CASE r.prioridad
      WHEN 'urgente' THEN interval '2 hours'
      WHEN 'alta'    THEN interval '8 hours'
      ELSE interval '24 hours'
    END;

    IF now() - r.created_at > v_sla * 2 AND r.acuse_escalado_at IS NULL THEN
      -- Pasado 2x el SLA: se avisa al Gobernador.
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT r.emitida_por, 'acuse_sin_respuesta', 'Gabinete no acusó recibo',
             r.titulo, '/despacho/' || r.id, 'instruccion', r.id
      WHERE r.emitida_por IS NOT NULL;
      UPDATE instrucciones SET acuse_escalado_at = now() WHERE id = r.id;
      INSERT INTO instruccion_bitacora (instruccion_id, actor_id, accion)
      VALUES (r.id, NULL, 'acuse_escalado');
      v_avisos := v_avisos + 1;

    ELSIF now() - r.created_at > v_sla AND r.acuse_recordado_at IS NULL THEN
      -- Pasado 1x el SLA: recordatorio a cada jefe de gabinete (una sola vez).
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT u.id, 'acuse_recordatorio', 'Pendiente de acusar recibo',
             r.titulo, '/despacho/' || r.id, 'instruccion', r.id
      FROM usuarios u
      JOIN usuario_roles ur ON ur.usuario_id = u.id
      JOIN roles rr          ON rr.id = ur.rol_id
      WHERE rr.nombre = 'jefe_gabinete' AND u.activo = true;
      UPDATE instrucciones SET acuse_recordado_at = now() WHERE id = r.id;
      INSERT INTO instruccion_bitacora (instruccion_id, actor_id, accion)
      VALUES (r.id, NULL, 'acuse_recordado');
      v_avisos := v_avisos + 1;
    END IF;
  END LOOP;

  RETURN v_avisos;
END;
$$;
