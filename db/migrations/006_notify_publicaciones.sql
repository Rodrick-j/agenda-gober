-- Avisa (id + accion, nada de contenido) cada vez que cambia una fila de
-- publicaciones. NOTIFY/LISTEN no pasa por RLS -- solo el backend escucha
-- este canal (nunca un cliente final), y por cada evento vuelve a consultar
-- la fila con el contexto de sesion de cada usuario conectado, para que la
-- misma politica RLS decida que le llega a cada quien. Ver
-- apps/api/src/realtime/pg-listener.service.ts.
CREATE OR REPLACE FUNCTION fn_notify_publicaciones() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'publicaciones_cambios',
    json_build_object('id', COALESCE(NEW.id, OLD.id), 'accion', TG_OP)::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_publicaciones
AFTER INSERT OR UPDATE ON publicaciones
FOR EACH ROW EXECUTE FUNCTION fn_notify_publicaciones();
