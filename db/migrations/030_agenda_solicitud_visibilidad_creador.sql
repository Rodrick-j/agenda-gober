-- Corrige un bloqueo real encontrado al probar 029 de punta a punta: un
-- INSERT ... RETURNING (el patrón que EventosService.crear() usa siempre,
-- para devolver la fila creada sin una segunda consulta) exige que la fila
-- recién insertada también pase la política SELECT -- no solo la WITH CHECK
-- del INSERT (Postgres trata el RETURNING de un INSERT/UPDATE como un caso
-- más de "with check options": si la fila no sería visible, no la omite en
-- silencio, lanza el mismo error 42501 "new row violates row-level security
-- policy"). Reproducido y confirmado con las pruebas manuales de esta
-- sesión: el mismo INSERT sin RETURNING pasa; con RETURNING falla.
--
-- El problema es real para `apoyo`: al crear una solicitud transversal
-- (secretaria_id NULL, sin invitados ni colaborador todavía -- ese paso es
-- una fila aparte en evento_colaboradores, después de conocer el id de la
-- solicitud), eventos_select (029) no tiene ninguna rama que le deje ver su
-- propia fila recién creada en ese instante.
--
-- Esto no es una rama nueva de alcance -- es exactamente lo que 029 ya
-- dijo que iba a pasar ("así puede registrar su solicitud y de inmediato
-- quedar con acceso de trabajo sobre ella") y lo que el diseño original de
-- este recorrido pide ("el apoyo ve lo que registra"): quien registra algo
-- tiene que poder verlo, sin depender de un segundo paso que además
-- necesita el id que este mismo INSERT todavía no devolvió.
--
-- Acotado a propósito: solo agrega visibilidad de LO QUE CREÓ, solo para
-- `apoyo` (los demás roles ya ven su propia creación por alguna rama
-- existente -- secretaria+rango para roles de secretaría, transversal para
-- gobernador/jefe_gabinete/admin). No usa `creado_por` como sustituto de
-- participación de otra persona (a diferencia del criterio provisional
-- documentado en fn_disponibilidad_gobernador, 028): acá es siempre la
-- propia persona autenticada viendo su propia fila.
--
-- Probado (ROLLBACK, ver sesión de trabajo): (a) apoyo ve e inserta con
-- RETURNING su propia solicitud; (b) un segundo usuario `apoyo` que no la
-- creó, no es responsable ni colaborador, sigue sin verla (cuenta = 0).

BEGIN;

ALTER POLICY eventos_select ON eventos_agenda
  USING (
    current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
    OR (
      secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
      AND rol_rango(current_setting('app.current_rol', true)) >= nivel_rango(nivel_confidencialidad)
    )
    OR EXISTS (
      SELECT 1 FROM evento_responsables er
      WHERE er.evento_id = eventos_agenda.id
        AND er.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
    OR EXISTS (
      SELECT 1 FROM evento_colaboradores ec
      WHERE ec.evento_id = eventos_agenda.id
        AND ec.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
    OR (
      current_setting('app.current_rol', true) = 'apoyo'
      AND creado_por = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

COMMIT;
