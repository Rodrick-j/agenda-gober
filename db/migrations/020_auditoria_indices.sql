-- La pantalla de Auditoría pasa de "traer las últimas N filas" a filtrar por
-- fecha, módulo, acción, actor y secretaría, y a calcular métricas sobre el
-- total filtrado. Sin índices, cada una de esas consultas es un seq scan de
-- toda la tabla.
--
-- No cambia el esquema ni los permisos: `auditoria` ya tiene GRANT SELECT a
-- app_user (001) y su política RLS auditoria_select sigue siendo la única
-- barrera de acceso. Esto es puro rendimiento de lectura.

-- created_at es el filtro por defecto (rango del período) y además el orden
-- de la lista (ORDER BY created_at DESC, id DESC): índice descendente.
CREATE INDEX IF NOT EXISTS idx_auditoria_created_at ON auditoria (created_at DESC);

-- Filtros de igualdad / IN sobre columnas de baja cardinalidad.
CREATE INDEX IF NOT EXISTS idx_auditoria_tabla   ON auditoria (tabla);
CREATE INDEX IF NOT EXISTS idx_auditoria_accion  ON auditoria (accion);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria (usuario_id);

-- El filtro "por secretaría" no tiene columna: se deriva de
-- datos_nuevos->>'secretaria_id' o datos_anteriores->>'secretaria_id' (las
-- tablas que la tienen: publicaciones, eventos_agenda, tareas, proyectos,
-- instruccion_items, usuarios). Un índice por expresión sobre esa clave deja
-- el filtro indexado sin tocar el esquema.
CREATE INDEX IF NOT EXISTS idx_auditoria_secretaria_nuevos
  ON auditoria ((datos_nuevos->>'secretaria_id'));
CREATE INDEX IF NOT EXISTS idx_auditoria_secretaria_anteriores
  ON auditoria ((datos_anteriores->>'secretaria_id'));
