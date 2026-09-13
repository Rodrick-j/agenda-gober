-- Lote de seguridad (sin columnas nuevas en eventos_agenda, sin rol nuevo):
--   1) avisar al backend cuando se revoca una sesion, para forzar la
--      desconexion del socket correspondiente -- hoy el HTTP se corta al
--      instante (JwtStrategy revalida contra la base en cada request) pero
--      un socket ya conectado seguia vivo con la autorizacion vieja.
--   2) disponibilidad del Gobernador sin exponer el evento reservado --
--      hoy buscarConflictos() consulta bajo el RLS de quien pregunta, asi
--      que un evento confidencial de otra secretaria en el que participa
--      el Gobernador no cuenta como cruce para quien no puede verlo.

BEGIN;

-- 1) Sockets ------------------------------------------------------------
--
-- sesiones no tiene RLS (019_sesiones.sql: se consulta antes de que exista
-- contexto de sesion) -- esta funcion no necesita SECURITY DEFINER, no hay
-- politica que sortear. Se dispara con el UPDATE que YA hacen hoy
-- admin.service.ts (desactivar/cambiar rol) y auth.service.ts (logout,
-- revocar sesion): ninguno de los dos archivos cambia una linea.
--
-- Payload lleva `sesionId` (no solo `usuarioId`): el gateway desconecta por
-- sesion, nunca por usuario completo -- un usuario puede tener mas de una
-- sesion viva (dos dispositivos/pestañas) y revocar una sola no debe tocar
-- las demas, mismo criterio que ya usa JwtStrategy.validate para HTTP.
CREATE OR REPLACE FUNCTION fn_notify_sesion_revocada() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'sesiones_revocadas',
    json_build_object('sesionId', NEW.id, 'usuarioId', NEW.usuario_id)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Solo dispara en la transicion NULL -> con valor (nunca en el INSERT --
-- una sesion siempre nace sin revocar -- ni si algo la vuelve a actualizar
-- ya revocada, para no reenviar el aviso).
CREATE TRIGGER trg_notify_sesion_revocada
AFTER UPDATE OF revocada_at ON sesiones
FOR EACH ROW
WHEN (NEW.revocada_at IS NOT NULL AND OLD.revocada_at IS NULL)
EXECUTE FUNCTION fn_notify_sesion_revocada();

-- 2) Disponibilidad del Gobernador --------------------------------------
--
-- SECURITY DEFINER, mismo patron ya usado 6 veces en el sistema para
-- romper RLS a proposito con un objetivo puntual (fn_evento_visible_para_actual,
-- fn_evento_editable_por_actual, fn_tarea_visible_para_actual,
-- fn_item_accesible_para_actual, fn_evento_de_mi_secretaria,
-- fn_evento_visible_completo). A diferencia de esas 6 (que no fijan
-- search_path -- hallazgo de esta migracion, queda para otra), esta SI fija
-- search_path, igual que ya hace fn_agenda_recordatorios_sweep (027): sin
-- eso, un objeto con el mismo nombre creado antes en el search_path de
-- quien llama podria secuestrar la resolucion de un identificador no
-- calificado dentro de una funcion SECURITY DEFINER.
--
-- El unico limite real de "que puede ver" esta funcion es lo que
-- selecciona: nunca titulo/lugar/descripcion/secretaria/confidencialidad/id
-- del evento, solo el rango horario. No recibe ningun parametro de "a
-- quien miro" -- esta fijo a rol=gobernador adentro; si aceptara un
-- usuario_id como parametro dejaria de ser "la disponibilidad del
-- Gobernador" para volverse una forma generica de consultar la agenda de
-- cualquiera sin RLS, que es exactamente lo que este cambio evita, no
-- reproduce.
--
-- Quien puede invocarla (revisado): SOLO los roles que coordinan o
-- consultan la agenda de Gabinete -- gobernador y jefe_gabinete hoy; el
-- rol `apoyo` se suma a esta lista cuando se lo crea (ver
-- 029_agenda_solicitudes.sql). NO cualquier autenticado -- la primera
-- version de esta funcion no restringia esto ("cualquiera que este por
-- agendar algo se entere"), y se corrigio explicitamente para no dar
-- acceso automatico a roles de secretaria/UNICOM que no coordinan la
-- agenda del Gobernador. Nota de honestidad: como gobernador/jefe_gabinete
-- ya son transversales y ven CUALQUIER evento directo por eventos_select,
-- para ellos esta funcion HOY nunca devuelve nada (la condicion NOT(...) de
-- abajo los excluye siempre) -- el mecanismo queda "dormido" hasta que
-- exista un rol permitido que SI tenga huecos de visibilidad, que es
-- exactamente el caso de `apoyo`.
--
-- La ultima condicion (NOT (...)) excluye lo que quien pregunta YA puede
-- ver por su propia eventos_select (008_eventos_agenda.sql) -- se
-- mantiene deliberadamente igual a esa politica; si esa politica cambia,
-- esta funcion tiene que actualizarse junto (documentado, no oculto).
--
-- Por que "creado_por = gobernador" cuenta como participacion -- CRITERIO
-- PROVISIONAL DE COMPATIBILIDAD, no una equivalencia definitiva con
-- asistencia: eventos_select (008) nunca usa creado_por como via de
-- visibilidad independiente, asi que aca tampoco deberia ser la regla
-- final. Se mantiene por ahora unicamente para no perder cobertura de
-- eventos YA EXISTENTES que el propio Gobernador cargo sin invitarse a si
-- mismo como responsable. El flujo nuevo de solicitudes
-- (029_agenda_solicitudes.sql) NUNCA depende de este criterio: al
-- confirmar un evento con participacion del Gobernador, lo agrega
-- explicitamente a evento_responsables -- la ocupacion del Gobernador ahi
-- sale siempre de participacion explicita, no de quien lo creo. Los
-- eventos anteriores que solo tienen este criterio como cobertura quedan
-- pendientes de una revision aparte (por ejemplo, decidir si conviene
-- pedirles a esas personas que se agreguen como responsables) -- no se
-- reinterpretan ni se tocan en silencio acá.
CREATE OR REPLACE FUNCTION fn_disponibilidad_gobernador(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_excluir_id uuid DEFAULT NULL
) RETURNS TABLE(fecha_inicio timestamptz, fecha_fin timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT e.fecha_inicio, e.fecha_fin
  FROM public.eventos_agenda e
  WHERE current_setting('app.current_rol', true) = ANY (ARRAY['gobernador', 'jefe_gabinete'])
    AND e.fecha_inicio < p_hasta
    AND e.fecha_fin > p_desde
    AND (p_excluir_id IS NULL OR e.id <> p_excluir_id)
    AND (
      EXISTS (
        SELECT 1 FROM public.usuario_roles ur
        JOIN public.roles r ON r.id = ur.rol_id
        WHERE r.nombre = 'gobernador' AND ur.usuario_id = e.creado_por
      )
      OR EXISTS (
        SELECT 1 FROM public.evento_responsables er
        JOIN public.usuario_roles ur ON ur.usuario_id = er.usuario_id
        JOIN public.roles r ON r.id = ur.rol_id
        WHERE er.evento_id = e.id AND r.nombre = 'gobernador'
      )
    )
    AND NOT (
      current_setting('app.current_rol', true) IN ('gobernador', 'jefe_gabinete', 'admin')
      OR (
        e.secretaria_id = NULLIF(current_setting('app.current_secretaria_id', true), '')::uuid
        AND public.rol_rango(current_setting('app.current_rol', true)) >= public.nivel_rango(e.nivel_confidencialidad)
      )
      OR EXISTS (
        SELECT 1 FROM public.evento_responsables er2
        WHERE er2.evento_id = e.id
          AND er2.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    );
$$;

-- Por defecto Postgres otorga EXECUTE a PUBLIC en toda funcion nueva (las 6
-- funciones SECURITY DEFINER existentes lo tienen asi, sin revocar --
-- tambien un hallazgo de esta migracion). Para esta, explicito: solo
-- app_user puede invocarla -- es el unico rol de login que existe fuera de
-- los superusuarios de administracion, asi que esto no acota mucho hoy,
-- pero deja la intencion explicita en vez de depender del default.
REVOKE ALL ON FUNCTION fn_disponibilidad_gobernador(timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_disponibilidad_gobernador(timestamptz, timestamptz, uuid) TO :"app_user_name";

COMMIT;
