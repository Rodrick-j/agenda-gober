-- Adjuntos de una publicación. El contenido del archivo se guarda como bytea
-- DENTRO de la fila, a propósito: así el documento hereda la RLS de su
-- publicación (ver políticas abajo) y no hay forma de bajarlo por una URL
-- estática saltándose los permisos. Para archivos grandes, migrar a object
-- storage (Cloudflare R2): metadata acá, bytes allá, con descarga siempre
-- validada contra la visibilidad de la publicación padre.
CREATE TABLE documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publicacion_id uuid NOT NULL REFERENCES publicaciones(id) ON DELETE CASCADE,
  nombre_archivo text NOT NULL,
  mime text NOT NULL,
  tamano_bytes bigint NOT NULL,
  contenido bytea NOT NULL,
  subido_por uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_documentos_publicacion ON documentos(publicacion_id);

GRANT SELECT, INSERT, DELETE ON documentos TO :"app_user_name";

ALTER TABLE documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos FORCE ROW LEVEL SECURITY;

-- La visibilidad de un documento = la visibilidad de su publicación. Como
-- publicaciones tiene RLS, este EXISTS solo encuentra la fila si la política
-- publicaciones_select la deja ver para el contexto actual (secretaría +
-- rango vs. nivel de confidencialidad). No hay que repetir esa lógica acá.
CREATE POLICY documentos_select ON documentos
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM publicaciones p WHERE p.id = documentos.publicacion_id));

-- Para adjuntar, tenés que poder ver la publicación padre.
CREATE POLICY documentos_insert ON documentos
  FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM publicaciones p WHERE p.id = documentos.publicacion_id));

CREATE POLICY documentos_delete ON documentos
  FOR DELETE
  USING (EXISTS (SELECT 1 FROM publicaciones p WHERE p.id = documentos.publicacion_id));

-- Auditoría de documentos: se registra metadata, NUNCA el contenido binario
-- (se excluye 'contenido' del jsonb para no inflar la tabla de auditoría).
CREATE OR REPLACE FUNCTION fn_auditoria_documentos() RETURNS trigger AS $$
BEGIN
  INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, datos_anteriores, datos_nuevos)
  VALUES (
    NULLIF(current_setting('app.current_user_id', true), '')::uuid,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) - 'contenido' END,
    CASE WHEN TG_OP = 'INSERT' THEN to_jsonb(NEW) - 'contenido' END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_documentos
AFTER INSERT OR DELETE ON documentos
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_documentos();

-- Aviso en tiempo real: al adjuntar/borrar, notifica sobre la publicación
-- padre para que la UI pueda refrescar. Igual que publicaciones, el payload
-- es minimo y solo lo consume el backend.
CREATE OR REPLACE FUNCTION fn_notify_documentos() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'publicaciones_cambios',
    json_build_object('id', COALESCE(NEW.publicacion_id, OLD.publicacion_id), 'accion', 'DOC_' || TG_OP)::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_documentos
AFTER INSERT OR DELETE ON documentos
FOR EACH ROW EXECUTE FUNCTION fn_notify_documentos();
