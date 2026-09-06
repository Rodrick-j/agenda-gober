-- Modulo Despacho: el Gobernador emite una INSTRUCCION; llega a Gabinete como
-- notificacion (bandeja + tiempo real); Gabinete la desglosa en items
-- (eventos/tareas/proyectos ya existentes) y el avance de esos hijos
-- recalcula SOLO el % y el estado de la instruccion.
--
-- Todo lo automatico son triggers en Postgres (corre venga la accion de la
-- API o de un cliente SQL). Las funciones que cruzan la RLS son
-- SECURITY DEFINER, mismo patron que fn_tarea_visible_para_actual (009).

CREATE TYPE instruccion_prioridad AS ENUM ('baja', 'media', 'alta', 'urgente');
CREATE TYPE instruccion_estado AS ENUM (
  'emitida', 'en_organizacion', 'en_ejecucion', 'cumplida', 'observada', 'cancelada'
);
CREATE TYPE instruccion_item_tipo AS ENUM ('evento', 'tarea', 'proyecto', 'reunion');
CREATE TYPE visto_tipo AS ENUM ('visto', 'acuse');

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

CREATE TABLE instrucciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  objetivo text NOT NULL,
  prioridad instruccion_prioridad NOT NULL DEFAULT 'media',
  fecha_limite timestamptz,
  estado instruccion_estado NOT NULL DEFAULT 'emitida',
  emitida_por uuid REFERENCES usuarios(id),
  organiza_id uuid REFERENCES usuarios(id),
  -- Calculadas por fn_despacho_recalcular, NUNCA se editan a mano.
  avance_porcentaje int NOT NULL DEFAULT 0 CHECK (avance_porcentaje BETWEEN 0 AND 100),
  en_riesgo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_instrucciones_estado ON instrucciones(estado);

CREATE TABLE instruccion_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instruccion_id uuid NOT NULL REFERENCES instrucciones(id) ON DELETE CASCADE,
  tipo instruccion_item_tipo NOT NULL,
  ref_id uuid NOT NULL,               -- fila real en eventos_agenda / tareas / proyectos
  secretaria_id uuid REFERENCES secretarias(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instruccion_id, tipo, ref_id)
);
CREATE INDEX idx_instruccion_items_instruccion ON instruccion_items(instruccion_id);
CREATE INDEX idx_instruccion_items_ref ON instruccion_items(tipo, ref_id);

-- Acuse de recibo generico: hoy 'instruccion', manana 'publicacion' sin
-- migracion nueva.
CREATE TABLE vistos (
  entidad_tipo text NOT NULL,
  entidad_id uuid NOT NULL,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo visto_tipo NOT NULL DEFAULT 'visto',
  visto_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entidad_tipo, entidad_id, usuario_id)
);

-- Bandeja por usuario. La insertan SOLO los triggers (SECURITY DEFINER); el
-- usuario unicamente marca leidas las suyas.
CREATE TABLE notificaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  titulo text NOT NULL,
  cuerpo text,
  enlace text,
  origen_tipo text,
  origen_id uuid,
  leida boolean NOT NULL DEFAULT false,
  leida_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notificaciones_bandeja ON notificaciones(usuario_id, leida, created_at DESC);

-- ---------------------------------------------------------------------------
-- Permisos del rol de aplicacion (nunca superusuario, nunca BYPASSRLS)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON instrucciones TO :"app_user_name";
GRANT SELECT, INSERT, UPDATE, DELETE ON instruccion_items TO :"app_user_name";
-- UPDATE en vistos: subir un registro 'visto' (abrió el detalle) a 'acuse'
-- (botón "Enterado").
GRANT SELECT, INSERT, UPDATE ON vistos TO :"app_user_name";
GRANT SELECT, UPDATE ON notificaciones TO :"app_user_name";

ALTER TABLE instrucciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE instrucciones      FORCE  ROW LEVEL SECURITY;
ALTER TABLE instruccion_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE instruccion_items  FORCE  ROW LEVEL SECURITY;
ALTER TABLE vistos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE vistos             FORCE  ROW LEVEL SECURITY;
ALTER TABLE notificaciones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones     FORCE  ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- Instrucciones: solo transversales. Emitir: solo el Gobernador.
CREATE POLICY instrucciones_select ON instrucciones
  FOR SELECT
  USING (current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin'));

CREATE POLICY instrucciones_insert ON instrucciones
  FOR INSERT
  WITH CHECK (current_setting('app.current_rol', true) = 'gobernador');

-- Estado / organiza_id los cambia el Gobernador o el Jefe de Gabinete; el
-- control fino de que columna toca cada uno queda en la API (unico escritor
-- del camino no-trigger). Las columnas calculadas las pisa fn_despacho_recalcular
-- via SECURITY DEFINER (bypassa RLS por ser superusuario el owner).
CREATE POLICY instrucciones_update ON instrucciones
  FOR UPDATE
  USING (current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin'))
  WITH CHECK (current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin'));

CREATE POLICY instruccion_items_select ON instruccion_items
  FOR SELECT
  USING (current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin'));

CREATE POLICY instruccion_items_insert ON instruccion_items
  FOR INSERT
  WITH CHECK (current_setting('app.current_rol', true) IN ('jefe_gabinete', 'admin'));

CREATE POLICY instruccion_items_delete ON instruccion_items
  FOR DELETE
  USING (current_setting('app.current_rol', true) IN ('jefe_gabinete', 'admin'));

-- Vistos: cada quien inserta/lee los propios; los transversales leen todos.
CREATE POLICY vistos_select ON vistos
  FOR SELECT
  USING (
    usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
  );

CREATE POLICY vistos_insert ON vistos
  FOR INSERT
  WITH CHECK (usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY vistos_update ON vistos
  FOR UPDATE
  USING (usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Notificaciones: cada usuario ve y marca leidas SOLO las suyas. Primera
-- tabla del sistema cuya RLS es por usuario y no por secretaria.
CREATE POLICY notificaciones_select ON notificaciones
  FOR SELECT
  USING (usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY notificaciones_update ON notificaciones
  FOR UPDATE
  USING (usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Recalculo del avance / estado / riesgo de una instruccion
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: la disparan UPDATEs sobre tareas/proyectos hechos por
-- usuarios de secretaria que NO pueden ver 'instrucciones'. El owner de esta
-- funcion (rol que corre la migracion) es superusuario en este entorno, asi
-- que corre bypaseando RLS. search_path fijo para que no se pueda inyectar.
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
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_total
  FROM instruccion_items WHERE instruccion_id = p_instruccion_id;

  -- Promedio de progreso de los items (tarea cancelada se excluye del promedio).
  SELECT COALESCE(ROUND(AVG(peso))::int, 0) INTO v_avance
  FROM (
    SELECT CASE ii.tipo
      WHEN 'tarea' THEN CASE t.estado
        WHEN 'completada'  THEN 100
        WHEN 'en_progreso' THEN 50
        WHEN 'cancelada'   THEN NULL
        ELSE 0 END
      WHEN 'proyecto' THEN p.avance_porcentaje
      WHEN 'evento'   THEN CASE WHEN e.fecha_fin < now() THEN 100 ELSE 0 END
      WHEN 'reunion'  THEN CASE WHEN e.fecha_fin < now() THEN 100 ELSE 0 END
    END AS peso
    FROM instruccion_items ii
    LEFT JOIN tareas          t ON ii.tipo = 'tarea'    AND t.id = ii.ref_id
    LEFT JOIN proyectos       p ON ii.tipo = 'proyecto' AND p.id = ii.ref_id
    LEFT JOIN eventos_agenda  e ON ii.tipo IN ('evento','reunion') AND e.id = ii.ref_id
    WHERE ii.instruccion_id = p_instruccion_id
  ) x
  WHERE peso IS NOT NULL;

  -- En riesgo si algun hijo esta vencido y sin cerrar, o si vencio la propia
  -- instruccion.
  SELECT EXISTS (
    SELECT 1
    FROM instruccion_items ii
    LEFT JOIN tareas    t ON ii.tipo = 'tarea'    AND t.id = ii.ref_id
    LEFT JOIN proyectos p ON ii.tipo = 'proyecto' AND p.id = ii.ref_id
    WHERE ii.instruccion_id = p_instruccion_id
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

  -- Estado derivado (nunca pisa una salida manual).
  IF v_total = 0 THEN
    v_estado_new := v_estado_old;
  ELSE
    SELECT bool_and(cerrado) INTO v_todos_ok
    FROM (
      SELECT CASE ii.tipo
        WHEN 'tarea'    THEN t.estado IN ('completada','cancelada')
        WHEN 'proyecto' THEN p.estado IN ('finalizado','cancelado')
        WHEN 'evento'   THEN e.fecha_fin < now()
        WHEN 'reunion'  THEN e.fecha_fin < now()
      END AS cerrado
      FROM instruccion_items ii
      LEFT JOIN tareas         t ON ii.tipo = 'tarea'    AND t.id = ii.ref_id
      LEFT JOIN proyectos      p ON ii.tipo = 'proyecto' AND p.id = ii.ref_id
      LEFT JOIN eventos_agenda e ON ii.tipo IN ('evento','reunion') AND e.id = ii.ref_id
      WHERE ii.instruccion_id = p_instruccion_id
    ) z;

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

  -- Avisos al Gobernador en las transiciones que le importan.
  IF v_estado_new = 'cumplida' AND v_estado_old <> 'cumplida' THEN
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT emitida_por, 'instruccion_cumplida', 'Instrucción cumplida',
           titulo, '/despacho/' || id, 'instruccion', id
    FROM instrucciones WHERE id = p_instruccion_id AND emitida_por IS NOT NULL;
  ELSIF v_riesgo AND NOT v_riesgo_old THEN
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT emitida_por, 'instruccion_en_riesgo', 'Una instrucción entró en riesgo',
           titulo, '/despacho/' || id, 'instruccion', id
    FROM instrucciones WHERE id = p_instruccion_id AND emitida_por IS NOT NULL;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Triggers de automatizacion
-- ---------------------------------------------------------------------------

-- Al EMITIR: notifica a cada Jefe de Gabinete activo. (SECURITY DEFINER para
-- poder escribir en notificaciones de OTRO usuario.)
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_despacho_instruccion_emitida
AFTER INSERT ON instrucciones
FOR EACH ROW EXECUTE FUNCTION fn_despacho_instruccion_emitida();

-- Al agregar/quitar un item: recalcula, y si es alta, avisa a la secretaria.
CREATE OR REPLACE FUNCTION fn_despacho_sync_items()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM fn_despacho_recalcular(COALESCE(NEW.instruccion_id, OLD.instruccion_id));

  IF TG_OP = 'INSERT' AND NEW.secretaria_id IS NOT NULL THEN
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT DISTINCT u.id, 'item_asignado',
           'El Despacho encomendó una tarea a tu secretaría',
           (SELECT titulo FROM instrucciones WHERE id = NEW.instruccion_id),
           '/tareas', 'instruccion', NEW.instruccion_id
    FROM usuarios u
    JOIN usuario_roles ur ON ur.usuario_id = u.id
    JOIN roles r          ON r.id = ur.rol_id
    WHERE ur.secretaria_id = NEW.secretaria_id
      AND r.nombre IN ('secretario','director')
      AND u.activo = true;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_despacho_sync_items
AFTER INSERT OR UPDATE OR DELETE ON instruccion_items
FOR EACH ROW EXECUTE FUNCTION fn_despacho_sync_items();

-- Cuando cambia una fila hija (tarea/proyecto/evento), si esta vinculada a
-- alguna instruccion, recalcula esa(s) instruccion(es).
CREATE OR REPLACE FUNCTION fn_despacho_sync_desde_hijo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_ref   uuid := COALESCE(NEW.id, OLD.id);
  v_tipo  instruccion_item_tipo := CASE TG_TABLE_NAME
    WHEN 'tareas'         THEN 'tarea'
    WHEN 'proyectos'      THEN 'proyecto'
    WHEN 'eventos_agenda' THEN 'evento'
  END;
  v_instruccion uuid;
BEGIN
  FOR v_instruccion IN
    SELECT DISTINCT instruccion_id FROM instruccion_items
    WHERE ref_id = v_ref
      AND (tipo = v_tipo OR (v_tipo = 'evento' AND tipo = 'reunion'))
  LOOP
    PERFORM fn_despacho_recalcular(v_instruccion);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_despacho_sync_tareas
AFTER INSERT OR UPDATE OR DELETE ON tareas
FOR EACH ROW EXECUTE FUNCTION fn_despacho_sync_desde_hijo();

CREATE TRIGGER trg_despacho_sync_proyectos
AFTER INSERT OR UPDATE OR DELETE ON proyectos
FOR EACH ROW EXECUTE FUNCTION fn_despacho_sync_desde_hijo();

CREATE TRIGGER trg_despacho_sync_eventos
AFTER INSERT OR UPDATE OR DELETE ON eventos_agenda
FOR EACH ROW EXECUTE FUNCTION fn_despacho_sync_desde_hijo();

-- ---------------------------------------------------------------------------
-- updated_at automatico
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_touch_instrucciones
BEFORE UPDATE ON instrucciones
FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Auditoria (fn_auditoria_publicaciones de 001 es generica: usa
-- TG_TABLE_NAME / NEW.id / OLD.id / to_jsonb). No se pone en 'vistos'
-- (no tiene columna id -> reventaria, mismo caso que reunion_actas en 011).
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_auditoria_instrucciones
AFTER INSERT OR UPDATE OR DELETE ON instrucciones
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_publicaciones();

CREATE TRIGGER trg_auditoria_instruccion_items
AFTER INSERT OR UPDATE OR DELETE ON instruccion_items
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_publicaciones();

-- ---------------------------------------------------------------------------
-- Tiempo real: canales propios, mismo patron que publicaciones (006).
-- pg-listener.service.ts los engancha en el lote 2 (API).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_notify_instrucciones() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'instrucciones_cambios',
    json_build_object('id', COALESCE(NEW.id, OLD.id), 'accion', TG_OP)::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_instrucciones
AFTER INSERT OR UPDATE OR DELETE ON instrucciones
FOR EACH ROW EXECUTE FUNCTION fn_notify_instrucciones();

CREATE OR REPLACE FUNCTION fn_notify_notificaciones() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'notificaciones_cambios',
    json_build_object('id', NEW.id, 'accion', TG_OP, 'usuario_id', NEW.usuario_id)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_notificaciones
AFTER INSERT ON notificaciones
FOR EACH ROW EXECUTE FUNCTION fn_notify_notificaciones();
