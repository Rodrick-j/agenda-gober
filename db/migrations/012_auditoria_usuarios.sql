-- Auditoria de usuarios para el panel de Super Administrador: quien creo,
-- desactivo o le cambio el rol/secretaria a una cuenta queda registrado,
-- igual que cualquier otro cambio en el sistema.
--
-- No se puede reusar fn_auditoria_publicaciones tal cual: esa función audita
-- la fila COMPLETA con to_jsonb(NEW)/to_jsonb(OLD), y usuarios tiene
-- password_hash -- aunque sea un hash bcrypt (no la contraseña en texto
-- plano), no tiene sentido dejarlo copiado en una tabla que gobernador/
-- jefe_gabinete/admin pueden leer sin necesidad. Mismo criterio que
-- documentos (007), que excluye la columna "contenido" del registro.
CREATE OR REPLACE FUNCTION fn_auditoria_usuarios() RETURNS trigger AS $$
BEGIN
  INSERT INTO auditoria (usuario_id, tabla, registro_id, accion, datos_anteriores, datos_nuevos)
  VALUES (
    NULLIF(current_setting('app.current_user_id', true), '')::uuid,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) - 'password_hash' END,
    CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN to_jsonb(NEW) - 'password_hash' END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Sin DELETE a propósito: las cuentas se desactivan (usuarios.activo = false),
-- nunca se borran -- borrar rompería las referencias de todo lo que esa
-- persona creó (publicaciones.autor_id, tareas.creado_por, etc.).
CREATE TRIGGER trg_auditoria_usuarios
AFTER INSERT OR UPDATE ON usuarios
FOR EACH ROW EXECUTE FUNCTION fn_auditoria_usuarios();
