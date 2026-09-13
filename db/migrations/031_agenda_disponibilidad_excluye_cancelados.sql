-- Corrige un falso cruce introducido por 029: fn_disponibilidad_gobernador
-- todavía no sabía de `estado` (no existía cuando se escribió, 028) y
-- cuenta cualquier evento por rango de fechas sin mirarlo -- un evento
-- 'cancelado' o 'no_realizado' del Gobernador seguiría bloqueando ese
-- horario para siempre. eventos.service.ts (buscarConflictos, parte
-- visible) ya excluye esos dos estados; esto alinea la parte oculta con lo
-- mismo. 'solicitud' no participa nunca de un cruce (fecha_inicio/fin NULL,
-- la condición de rango ya lo descarta); 'realizado' sí sigue contando --
-- ocurrió, ocupó ese horario.

BEGIN;

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
  WHERE current_setting('app.current_rol', true) = ANY (ARRAY['gobernador', 'jefe_gabinete', 'apoyo'])
    AND e.fecha_inicio < p_hasta
    AND e.fecha_fin > p_desde
    AND e.estado NOT IN ('cancelado', 'no_realizado')
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
      OR EXISTS (
        SELECT 1 FROM public.evento_colaboradores ec2
        WHERE ec2.evento_id = e.id
          AND ec2.usuario_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    );
$$;

REVOKE ALL ON FUNCTION fn_disponibilidad_gobernador(timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_disponibilidad_gobernador(timestamptz, timestamptz, uuid) TO :"app_user_name";

COMMIT;
