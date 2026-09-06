-- Despacho v2: cierre en tres pasos, evidencia, pesos y bitácora.
--
--  1. La secretaría marca su tarea -> el ítem NO cierra: pasa a
--     'pendiente_validacion' (exige >=1 evidencia adjunta).
--  2. Gabinete revisa y 'valida' o 'devuelve' (con motivo).
--  3. La instrucción llega a 'cumplida' solo cuando TODOS los ítems están
--     'validado'.
--
-- Además: peso por ítem (promedio ponderado), bitácora legible con motivo
-- obligatorio en las acciones sensibles, y client_token para des-duplicar
-- el "Emitir".

-- ---------------------------------------------------------------------------
-- Estado de validación + peso + datos de devolución en cada ítem
-- ---------------------------------------------------------------------------
CREATE TYPE item_estado_validacion AS ENUM (
  'en_curso', 'pendiente_validacion', 'validado', 'devuelto'
);

ALTER TABLE instruccion_items
  ADD COLUMN estado_validacion item_estado_validacion NOT NULL DEFAULT 'en_curso',
  ADD COLUMN peso smallint NOT NULL DEFAULT 1 CHECK (peso BETWEEN 1 AND 5),
  ADD COLUMN motivo_devolucion text,
  ADD COLUMN validado_por uuid REFERENCES usuarios(id),
  ADD COLUMN validado_at timestamptz;

-- ---------------------------------------------------------------------------
-- Evidencias del ítem (bytea dentro de la fila, como documentos/007).
-- ---------------------------------------------------------------------------
CREATE TYPE evidencia_tipo AS ENUM ('informe', 'foto', 'documento');

CREATE TABLE item_evidencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES instruccion_items(id) ON DELETE CASCADE,
  tipo evidencia_tipo NOT NULL DEFAULT 'documento',
  nombre_archivo text NOT NULL,
  mime text NOT NULL,
  tamano_bytes bigint NOT NULL,
  contenido bytea NOT NULL,
  nota text,
  subido_por uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_item_evidencias_item ON item_evidencias(item_id);

-- ---------------------------------------------------------------------------
-- Bitácora legible (además del diff que ya guarda 'auditoria').
-- ---------------------------------------------------------------------------
CREATE TABLE instruccion_bitacora (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instruccion_id uuid NOT NULL REFERENCES instrucciones(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES usuarios(id),
  accion text NOT NULL,
  motivo text,
  datos jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_instruccion_bitacora_instruccion ON instruccion_bitacora(instruccion_id, created_at);

-- ---------------------------------------------------------------------------
-- Concurrencia: token del cliente para des-duplicar "Emitir", y las tres
-- marcas de tiempo de recepción separadas.
-- ---------------------------------------------------------------------------
ALTER TABLE instrucciones ADD COLUMN client_token uuid;
CREATE UNIQUE INDEX uq_instrucciones_client_token
  ON instrucciones(client_token) WHERE client_token IS NOT NULL;

ALTER TABLE vistos
  ADD COLUMN notificado_at timestamptz,
  ADD COLUMN abierto_at timestamptz,
  ADD COLUMN acuse_at timestamptz;
-- Backfill: visto_at representaba "abrió" (y "acusó" si tipo='acuse').
UPDATE vistos SET abierto_at = visto_at;
UPDATE vistos SET acuse_at = visto_at WHERE tipo = 'acuse';

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON item_evidencias TO :"app_user_name";
GRANT SELECT, INSERT ON instruccion_bitacora TO :"app_user_name";

ALTER TABLE item_evidencias      ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_evidencias      FORCE  ROW LEVEL SECURITY;
ALTER TABLE instruccion_bitacora ENABLE ROW LEVEL SECURITY;
ALTER TABLE instruccion_bitacora FORCE  ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Visibilidad de un ítem para el actual: transversal, o responsable de la
-- tarea que ese ítem representa. SECURITY DEFINER para romper la recursión
-- (instruccion_items solo lo ven transversales), igual que
-- fn_tarea_visible_para_actual (009).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_item_accesible_para_actual(p_item_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM instruccion_items ii
    WHERE ii.id = p_item_id
      AND (
        current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
        OR (ii.tipo = 'tarea' AND EXISTS (
          SELECT 1 FROM tarea_asignados ta
          WHERE ta.tarea_id = ii.ref_id
            AND ta.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        ))
      )
  );
$$;

CREATE POLICY item_evidencias_select ON item_evidencias
  FOR SELECT USING (fn_item_accesible_para_actual(item_id));
CREATE POLICY item_evidencias_insert ON item_evidencias
  FOR INSERT WITH CHECK (fn_item_accesible_para_actual(item_id));
CREATE POLICY item_evidencias_delete ON item_evidencias
  FOR DELETE USING (fn_item_accesible_para_actual(item_id));

-- La bitácora la leen los transversales; la escriben triggers (SECURITY
-- DEFINER) y la API en contexto transversal. Mismo criterio que auditoria_insert (003).
CREATE POLICY instruccion_bitacora_select ON instruccion_bitacora
  FOR SELECT USING (current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin'));
CREATE POLICY instruccion_bitacora_insert ON instruccion_bitacora
  FOR INSERT WITH CHECK (true);

-- El responsable de la tarea ahora también VE su propio ítem (no el título de
-- la instrucción, que sigue en 'instrucciones' solo-transversal). Postgres
-- exige la política de SELECT para poder hacer UPDATE de esa fila.
DROP POLICY instruccion_items_select ON instruccion_items;
CREATE POLICY instruccion_items_select ON instruccion_items
  FOR SELECT
  USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR fn_item_accesible_para_actual(id)
  );

-- Y puede UPDATE su ítem (solo para pedir la validación -- el trigger
-- fn_validar_edicion_item limita qué columnas toca).
CREATE POLICY instruccion_items_update ON instruccion_items
  FOR UPDATE
  USING (
    current_setting('app.current_rol', true) IN ('jefe_gabinete', 'admin')
    OR fn_item_accesible_para_actual(id)
  )
  WITH CHECK (
    current_setting('app.current_rol', true) IN ('jefe_gabinete', 'admin')
    OR fn_item_accesible_para_actual(id)
  );

-- ---------------------------------------------------------------------------
-- Reglas de la máquina de validación del ítem (BEFORE UPDATE).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validar_edicion_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_rol text := current_setting('app.current_rol', true);
BEGIN
  -- Pedir la validación siempre exige al menos una evidencia (para todos).
  IF NEW.estado_validacion = 'pendiente_validacion'
     AND OLD.estado_validacion IS DISTINCT FROM 'pendiente_validacion'
     AND NOT EXISTS (SELECT 1 FROM item_evidencias WHERE item_id = NEW.id)
  THEN
    RAISE EXCEPTION 'Adjuntá al menos una evidencia antes de pedir la validación';
  END IF;

  -- Devolver exige motivo.
  IF NEW.estado_validacion = 'devuelto'
     AND OLD.estado_validacion IS DISTINCT FROM 'devuelto'
     AND (NEW.motivo_devolucion IS NULL OR btrim(NEW.motivo_devolucion) = '')
  THEN
    RAISE EXCEPTION 'Para devolver un ítem hay que indicar el motivo';
  END IF;

  IF v_rol IN ('gobernador', 'jefe_gabinete', 'admin') THEN
    RETURN NEW; -- Gabinete/autoridades: edición completa (valida, devuelve, repesa)
  END IF;

  -- Responsable de la tarea: solo puede mover en_curso/devuelto -> pendiente_validacion.
  IF NEW.instruccion_id IS DISTINCT FROM OLD.instruccion_id
     OR NEW.tipo         IS DISTINCT FROM OLD.tipo
     OR NEW.ref_id       IS DISTINCT FROM OLD.ref_id
     OR NEW.secretaria_id IS DISTINCT FROM OLD.secretaria_id
     OR NEW.peso         IS DISTINCT FROM OLD.peso
  THEN
    RAISE EXCEPTION 'Solo podés solicitar la validación de tu ítem';
  END IF;

  IF NOT (OLD.estado_validacion IN ('en_curso', 'devuelto')
          AND NEW.estado_validacion = 'pendiente_validacion') THEN
    RAISE EXCEPTION 'Transición de validación no permitida: % -> %',
      OLD.estado_validacion, NEW.estado_validacion;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_edicion_item
BEFORE UPDATE ON instruccion_items
FOR EACH ROW EXECUTE FUNCTION fn_validar_edicion_item();

-- ---------------------------------------------------------------------------
-- Recálculo v2: promedio PONDERADO por peso, y "cerrado" = 'validado'.
-- ---------------------------------------------------------------------------
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

  -- Avance = Σ(progreso·peso) / Σ(peso). Un ítem cancelado (tarea cancelada)
  -- no entra en el promedio.
  SELECT COALESCE(ROUND(SUM(progreso * peso)::numeric / NULLIF(SUM(peso), 0))::int, 0)
    INTO v_avance
  FROM (
    SELECT ii.peso,
      CASE ii.tipo
        WHEN 'tarea' THEN CASE t.estado
          WHEN 'completada'  THEN 100
          WHEN 'en_progreso' THEN 50
          WHEN 'cancelada'   THEN NULL
          ELSE 0 END
        WHEN 'proyecto' THEN p.avance_porcentaje
        WHEN 'evento'   THEN CASE WHEN e.fecha_fin < now() THEN 100 ELSE 0 END
        WHEN 'reunion'  THEN CASE WHEN e.fecha_fin < now() THEN 100 ELSE 0 END
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
    -- Cerrado = 'validado' (o una tarea cancelada, que se da por saldada).
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

-- ---------------------------------------------------------------------------
-- Bitácora automática de la emisión.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_despacho_instruccion_emitida()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
  SELECT u.id, 'instruccion_emitida', 'Nueva instrucción del Despacho',
         NEW.titulo, '/despacho/' || NEW.id, 'instruccion', NEW.id
  FROM usuarios u
  JOIN usuario_roles ur ON ur.usuario_id = u.id
  JOIN roles r          ON r.id = ur.rol_id
  WHERE r.nombre = 'jefe_gabinete' AND u.activo = true;

  INSERT INTO instruccion_bitacora (instruccion_id, actor_id, accion)
  VALUES (NEW.id, NEW.emitida_por, 'emitida');
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Al cambiar un ítem: recalcula, registra la transición de validación en la
-- bitácora, y notifica de forma AFINADA (Q6): al que corresponde, no a todos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_despacho_sync_items()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  v_titulo text;
BEGIN
  PERFORM fn_despacho_recalcular(COALESCE(NEW.instruccion_id, OLD.instruccion_id));

  IF TG_OP = 'INSERT' THEN
    SELECT titulo INTO v_titulo FROM instrucciones WHERE id = NEW.instruccion_id;
    INSERT INTO instruccion_bitacora (instruccion_id, actor_id, accion, datos)
    VALUES (NEW.instruccion_id, v_actor, 'item_agregado',
            jsonb_build_object('item_id', NEW.id, 'tipo', NEW.tipo, 'secretaria_id', NEW.secretaria_id));

    -- Aviso al responsable de la tarea; si el desglose no nombró a nadie, al
    -- secretario de la secretaría (uno), nunca a toda el área.
    IF NEW.tipo = 'tarea' THEN
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT ta.usuario_id, 'item_asignado', 'El Despacho te encomendó una tarea',
             v_titulo, '/tareas', 'instruccion', NEW.instruccion_id
      FROM tarea_asignados ta WHERE ta.tarea_id = NEW.ref_id;
    END IF;
    IF NEW.tipo = 'tarea'
       AND NEW.secretaria_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM tarea_asignados WHERE tarea_id = NEW.ref_id)
    THEN
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT DISTINCT u.id, 'item_asignado', 'El Despacho encomendó una tarea a tu secretaría',
             v_titulo, '/tareas', 'instruccion', NEW.instruccion_id
      FROM usuarios u
      JOIN usuario_roles ur ON ur.usuario_id = u.id
      JOIN roles r          ON r.id = ur.rol_id
      WHERE ur.secretaria_id = NEW.secretaria_id AND r.nombre = 'secretario' AND u.activo = true;
    END IF;

  ELSIF TG_OP = 'UPDATE' AND NEW.estado_validacion IS DISTINCT FROM OLD.estado_validacion THEN
    INSERT INTO instruccion_bitacora (instruccion_id, actor_id, accion, motivo, datos)
    VALUES (
      NEW.instruccion_id, v_actor,
      CASE NEW.estado_validacion
        WHEN 'pendiente_validacion' THEN 'validacion_solicitada'
        WHEN 'validado'             THEN 'validado'
        WHEN 'devuelto'             THEN 'devuelto'
        ELSE 'item_actualizado' END,
      NEW.motivo_devolucion,
      jsonb_build_object('item_id', NEW.id, 'tipo', NEW.tipo)
    );

    IF NEW.estado_validacion = 'pendiente_validacion' THEN
      -- al jefe que organiza; si no hay, a todos los jefe_gabinete
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT i.organiza_id, 'item_pendiente_validacion',
             'Un ítem espera tu validación', i.titulo,
             '/despacho/' || i.id, 'instruccion', i.id
      FROM instrucciones i WHERE i.id = NEW.instruccion_id AND i.organiza_id IS NOT NULL;
      IF NOT EXISTS (SELECT 1 FROM instrucciones WHERE id = NEW.instruccion_id AND organiza_id IS NOT NULL) THEN
        INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
        SELECT u.id, 'item_pendiente_validacion', 'Un ítem espera validación',
               (SELECT titulo FROM instrucciones WHERE id = NEW.instruccion_id),
               '/despacho/' || NEW.instruccion_id, 'instruccion', NEW.instruccion_id
        FROM usuarios u
        JOIN usuario_roles ur ON ur.usuario_id = u.id
        JOIN roles r          ON r.id = ur.rol_id
        WHERE r.nombre = 'jefe_gabinete' AND u.activo = true;
      END IF;
    ELSIF NEW.estado_validacion = 'devuelto' THEN
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT ta.usuario_id, 'item_devuelto', 'Te devolvieron un ítem del Despacho',
             NEW.motivo_devolucion, '/tareas', 'instruccion', NEW.instruccion_id
      FROM tarea_asignados ta WHERE ta.tarea_id = NEW.ref_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Auditoría genérica también sobre evidencias (tiene 'id'), sin el binario
-- no hace falta acá porque fn_auditoria_publicaciones no excluye 'contenido';
-- se usa una dedicada como en 007.
CREATE OR REPLACE FUNCTION fn_auditoria_item_evidencias() RETURNS trigger AS $$
BEGIN
  INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, datos_anteriores, datos_nuevos)
  VALUES (
    NULLIF(current_setting('app.current_user_id', true), '')::uuid,
    TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), TG_OP,
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) - 'contenido' END,
    CASE WHEN TG_OP = 'INSERT' THEN to_jsonb(NEW) - 'contenido' END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_item_evidencias
AFTER INSERT OR DELETE ON item_evidencias
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_item_evidencias();
