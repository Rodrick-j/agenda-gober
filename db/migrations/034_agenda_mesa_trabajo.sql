-- Mesa de trabajo de Agenda (vista de tabla para la Jefa de Gabinete):
-- ningún permiso nuevo, ningún registro nuevo -- son los mismos eventos_agenda
-- de siempre, vistos y editados distinto. Lo único que agrega este lote a la
-- base es una columna de texto libre, provisional (el usuario fue explícito:
-- "las columnas son provisionales hasta revisar una muestra... no
-- construyas todavía un editor de hojas completo" -- así que esto NO es el
-- módulo de contactos/organizaciones con snapshot congelado del diseño
-- original, que sigue diferido).

BEGIN;

-- "Organización solicitante": no existe ningún campo parecido hoy
-- (verificado: information_schema.columns sin coincidencias en todo el
-- esquema salvo instrucciones.organiza_id, que es un concepto distinto de
-- Despacho). Texto libre a propósito -- el directorio de organizaciones con
-- historial es la pieza deferida.
ALTER TABLE eventos_agenda ADD COLUMN organizacion_solicitante text;

COMMIT;
