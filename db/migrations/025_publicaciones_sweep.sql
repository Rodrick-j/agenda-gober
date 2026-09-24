-- Publicaciones lote 2: SLA del flujo de aprobación. Cierra el "nadie empuja"
-- que quedó del lote 1 (021) -- ahora una publicación no se queda semanas en
-- 'revisión' o 'aprobado' sin que nadie se entere. Mismo mecanismo que
-- fn_despacho_sweep (018): SECURITY DEFINER + marcadores de idempotencia.
-- Lo agenda PublicacionesSweepService cada hora.

ALTER TABLE publicaciones
  ADD COLUMN revision_recordada_at timestamptz,
  ADD COLUMN revision_escalada_at  timestamptz,
  ADD COLUMN publicado_recordado_at timestamptz;

-- La versión de 021 sólo sellaba quién/cuándo. Ésta además LIMPIA los
-- marcadores de SLA en cada cambio de estado: si una publicación rebota a
-- borrador y vuelve a revisión, arranca con los recordatorios en cero.
CREATE OR REPLACE FUNCTION fn_publicaciones_sello_transicion() RETURNS trigger AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  IF NEW.estado = 'revision' THEN
    NEW.enviado_revision_at := now();
    NEW.motivo_rechazo := NULL;
  ELSIF NEW.estado = 'aprobado' THEN
    NEW.aprobado_por := v_actor;
    NEW.aprobado_at := now();
    NEW.motivo_rechazo := NULL;
  ELSIF NEW.estado = 'publicado' THEN
    NEW.publicado_por := v_actor;
    NEW.publicado_at := now();
  ELSIF NEW.estado = 'borrador' THEN
    NEW.enviado_revision_at := NULL;
    NEW.aprobado_por := NULL;
    NEW.aprobado_at := NULL;
    NEW.publicado_por := NULL;
    NEW.publicado_at := NULL;
  END IF;

  -- Cualquier transición re-arma los SLA.
  NEW.revision_recordada_at  := NULL;
  NEW.revision_escalada_at   := NULL;
  NEW.publicado_recordado_at := NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_publicaciones_sweep() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_avisos int := 0;
  r        record;
BEGIN
  -- ===== 'revisión' estancada: recordatorio 48 h, escala 96 h =====
  FOR r IN
    SELECT id, titulo, secretaria_id, autor_id, enviado_revision_at,
           revision_recordada_at, revision_escalada_at
    FROM publicaciones
    WHERE estado = 'revision' AND enviado_revision_at IS NOT NULL
  LOOP
    IF now() - r.enviado_revision_at > interval '96 hours' AND r.revision_escalada_at IS NULL THEN
      -- Escala: al secretario de la secretaría + aviso al autor de que sigue trabado.
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT u.id, 'publicacion_revision_escalada', 'Publicación trabada en revisión (4+ días)',
             r.titulo, '/dashboard#publicaciones', 'publicacion', r.id
      FROM usuarios u
      JOIN usuario_roles ur ON ur.usuario_id = u.id
      JOIN roles rr          ON rr.id = ur.rol_id
      WHERE ur.secretaria_id = r.secretaria_id AND rr.nombre = 'secretario' AND u.activo = true;

      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT r.autor_id, 'publicacion_revision_escalada', 'Tu publicación sigue sin revisar',
             r.titulo, '/dashboard#publicaciones', 'publicacion', r.id
      WHERE r.autor_id IS NOT NULL;

      -- Marca también el recordatorio como cursado: ya escalamos, no tiene
      -- sentido mandar después el aviso más suave.
      UPDATE publicaciones
        SET revision_escalada_at = now(),
            revision_recordada_at = COALESCE(revision_recordada_at, now())
      WHERE id = r.id;
      v_avisos := v_avisos + 1;

    ELSIF now() - r.enviado_revision_at > interval '48 hours'
          AND r.revision_recordada_at IS NULL
          AND r.revision_escalada_at IS NULL THEN
      INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
      SELECT u.id, 'publicacion_revision_recordatorio', 'Publicación esperando tu revisión (2+ días)',
             r.titulo, '/dashboard#publicaciones', 'publicacion', r.id
      FROM usuarios u
      JOIN usuario_roles ur ON ur.usuario_id = u.id
      JOIN roles rr          ON rr.id = ur.rol_id
      WHERE ur.secretaria_id = r.secretaria_id
        AND rr.nombre IN ('director', 'secretario') AND u.activo = true;

      UPDATE publicaciones SET revision_recordada_at = now() WHERE id = r.id;
      v_avisos := v_avisos + 1;
    END IF;
  END LOOP;

  -- ===== 'aprobado' sin publicar: un solo recordatorio al secretario a las 48 h =====
  FOR r IN
    SELECT id, titulo, secretaria_id, aprobado_at
    FROM publicaciones
    WHERE estado = 'aprobado' AND aprobado_at IS NOT NULL
      AND publicado_recordado_at IS NULL
      AND now() - aprobado_at > interval '48 hours'
  LOOP
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT u.id, 'publicacion_sin_publicar', 'Publicación aprobada sin publicar (2+ días)',
           r.titulo, '/dashboard#publicaciones', 'publicacion', r.id
    FROM usuarios u
    JOIN usuario_roles ur ON ur.usuario_id = u.id
    JOIN roles rr          ON rr.id = ur.rol_id
    WHERE ur.secretaria_id = r.secretaria_id AND rr.nombre = 'secretario' AND u.activo = true;

    UPDATE publicaciones SET publicado_recordado_at = now() WHERE id = r.id;
    v_avisos := v_avisos + 1;
  END LOOP;

  RETURN v_avisos;
END;
$$;
