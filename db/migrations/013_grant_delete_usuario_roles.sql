-- 001 solo dio SELECT/INSERT/UPDATE sobre usuario_roles. El panel de Super
-- Administrador reasigna rol/secretaria con el mismo patron "borrar todo e
-- insertar de nuevo" que ya usan evento_responsables/tarea_asignados, asi
-- que hace falta DELETE tambien.
GRANT DELETE ON usuario_roles TO :"app_user_name";
