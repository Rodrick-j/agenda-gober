-- Publicaciones lote 1: que la cadena de aprobación avise sola.
--
-- Hoy pasar de estado es un UPDATE pelado: el que tiene que revisar, aprobar
-- o publicar no se entera de que hay algo esperándolo, y un rechazo vuelve la
-- publicación a 'borrador' sin decir por qué. Esto agrega, con el mismo patrón
-- que Despacho (015):
--   1. columnas de sello: quién/cuándo en cada transición + motivo de rechazo
--   2. trigger BEFORE que las llena solo desde app.current_user_id
--   3. trigger AFTER que inserta en notificaciones a los destinatarios reales
--
-- El GRANT de 001 (SELECT/INSERT/UPDATE ON publicaciones, sin lista de
-- columnas) ya cubre las columnas nuevas. La política RLS de publicaciones no
-- cambia: sigue siendo la única barrera de acceso.

ALTER TABLE publicaciones
  ADD COLUMN enviado_revision_at timestamptz,
  ADD COLUMN aprobado_por        uuid REFERENCES usuarios(id),
  ADD COLUMN aprobado_at         timestamptz,
  ADD COLUMN publicado_por       uuid REFERENCES usuarios(id),
  ADD COLUMN publicado_at        timestamptz,
  ADD COLUMN motivo_rechazo      text;

-- ---------------------------------------------------------------------------
-- 1. Sello de transición (BEFORE UPDATE, corre en el contexto del que edita)
-- ---------------------------------------------------------------------------
-- Se dispara antes que trg_validar_transicion_publicacion (orden alfabético:
-- "s" < "v") pero da igual: sólo escribe columnas de sello, no toca estado.
CREATE OR REPLACE FUNCTION fn_publicaciones_sello_transicion() RETURNS trigger AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW; -- edición de contenido sin cambio de estado
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
    -- Rechazo o reinicio: NEW.motivo_rechazo viene del UPDATE. Se limpian los
    -- sellos previos para que un segundo recorrido empiece en cero.
    NEW.enviado_revision_at := NULL;
    NEW.aprobado_por := NULL;
    NEW.aprobado_at := NULL;
    NEW.publicado_por := NULL;
    NEW.publicado_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_publicaciones_sello_transicion
BEFORE UPDATE ON publicaciones
FOR EACH ROW EXECUTE FUNCTION fn_publicaciones_sello_transicion();

-- ---------------------------------------------------------------------------
-- 2. Notificaciones (AFTER UPDATE). SECURITY DEFINER para escribir en
--    notificaciones de OTROS usuarios (mismo mecanismo que Despacho 015).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_publicaciones_notify_estado()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  IF NEW.estado = 'revision' THEN
    -- Avisar a quien puede aprobar en la secretaría dueña (no al propio autor
    -- si además fuera director).
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT u.id, 'publicacion_revision', 'Publicación esperando revisión',
           NEW.titulo, '/dashboard#publicaciones', 'publicacion', NEW.id
    FROM usuarios u
    JOIN usuario_roles ur ON ur.usuario_id = u.id
    JOIN roles r          ON r.id = ur.rol_id
    WHERE ur.secretaria_id = NEW.secretaria_id
      AND r.nombre IN ('director', 'secretario')
      AND u.activo = true
      AND u.id IS DISTINCT FROM v_actor;

  ELSIF NEW.estado = 'aprobado' THEN
    -- Sólo el secretario publica: es a quien le toca el siguiente paso.
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT u.id, 'publicacion_aprobada', 'Publicación lista para publicar',
           NEW.titulo, '/dashboard#publicaciones', 'publicacion', NEW.id
    FROM usuarios u
    JOIN usuario_roles ur ON ur.usuario_id = u.id
    JOIN roles r          ON r.id = ur.rol_id
    WHERE ur.secretaria_id = NEW.secretaria_id
      AND r.nombre = 'secretario'
      AND u.activo = true;

  ELSIF NEW.estado = 'publicado' THEN
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT NEW.autor_id, 'publicacion_publicada', 'Tu publicación se publicó',
           NEW.titulo, '/dashboard#publicaciones', 'publicacion', NEW.id
    WHERE NEW.autor_id IS NOT NULL;

  ELSIF NEW.estado = 'borrador' AND OLD.estado IN ('revision', 'aprobado') THEN
    INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, enlace, origen_tipo, origen_id)
    SELECT NEW.autor_id, 'publicacion_rechazada', 'Publicación devuelta a borrador',
           COALESCE(NEW.motivo_rechazo, 'Sin motivo indicado'),
           '/dashboard#publicaciones', 'publicacion', NEW.id
    WHERE NEW.autor_id IS NOT NULL
      AND NEW.autor_id IS DISTINCT FROM v_actor;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_publicaciones_notify_estado
AFTER UPDATE ON publicaciones
FOR EACH ROW EXECUTE FUNCTION fn_publicaciones_notify_estado();
