-- Separación acordada, en servidor y en base -- no solo ocultar botones en
-- la UI (el usuario lo señaló explícitamente: "ocultar controles en Mi
-- jornada no es suficiente"). El Gobernador deja de estar en la rama
-- "transversal, siempre permitido" de INSERT/UPDATE/DELETE sobre
-- eventos_agenda -- sigue pudiendo LEER cualquier evento (eventos_select no
-- se toca) y sigue con sus atribuciones actuales en Despacho
-- (instrucciones/instruccion_items, tablas separadas, no tocadas) y en
-- Reuniones (reunion_actas/compromisos, gobernados por
-- fn_evento_editable_por_actual, una función SEPARADA de estas 3 políticas
-- -- verificado que Despacho nunca inserta/actualiza/borra eventos_agenda
-- directo: instruccion_items exige un refId de un evento YA EXISTENTE para
-- tipo='evento', solo permite crear sin refId para tipo='tarea'
-- -- despacho.service.ts, agregarItem()).
--
-- El cambio se limita a exactamente estas 3 políticas de eventos_agenda,
-- tal como se decidió en el diseño original (ver memoria de proyecto):
-- jefe_gabinete y admin quedan igual que antes.

BEGIN;

ALTER POLICY eventos_insert ON eventos_agenda
  WITH CHECK (
    (current_setting('app.current_rol', true) IN ('jefe_gabinete', 'admin') AND secretaria_id IS NULL)
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
    OR (
      current_setting('app.current_rol', true) = 'apoyo'
      AND secretaria_id IS NULL
      AND estado IN ('solicitud', 'tentativo')
    )
  );

ALTER POLICY eventos_update ON eventos_agenda
  USING (
    current_setting('app.current_rol', true) IN ('jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= rol_rango('director')
    )
    OR (
      current_setting('app.current_rol', true) = 'apoyo'
      AND estado IN ('solicitud', 'tentativo')
      AND EXISTS (
        SELECT 1 FROM evento_colaboradores ec
        WHERE ec.evento_id = eventos_agenda.id
          AND ec.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_rol', true) IN ('jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
    OR (
      current_setting('app.current_rol', true) = 'apoyo'
      AND estado IN ('solicitud', 'tentativo')
      AND EXISTS (
        SELECT 1 FROM evento_colaboradores ec
        WHERE ec.evento_id = eventos_agenda.id
          AND ec.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    )
  );

ALTER POLICY eventos_delete ON eventos_agenda
  USING (
    current_setting('app.current_rol', true) IN ('jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= rol_rango('director')
    )
  );

COMMIT;
