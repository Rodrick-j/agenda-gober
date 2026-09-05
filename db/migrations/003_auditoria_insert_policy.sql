-- RLS deniega por comando, no solo por SELECT: al activar RLS en auditoria
-- (001) solo se agrego politica de SELECT, asi que el propio trigger
-- fn_auditoria_publicaciones (que hace INSERT como app_user) quedaba
-- bloqueado por default-deny. El unico codigo que inserta en auditoria es
-- ese trigger -- nunca un endpoint directo -- asi que WITH CHECK (true) es
-- correcto aqui; la atribucion real (usuario_id) ya la fija el trigger a
-- partir de app.current_user_id, no algo que el cliente controle.
CREATE POLICY auditoria_insert ON auditoria
  FOR INSERT
  WITH CHECK (true);
