-- Reemplaza el catalogo de secretarias de prueba por las 10 reales de la
-- Gobernacion de Oruro. No se borra ninguna fila (romperia publicaciones,
-- tareas, eventos, proyectos y usuarios ya creados contra esos IDs) -- se
-- renombran las que tienen equivalente real y se desactivan las que no.
ALTER TABLE secretarias ADD COLUMN descripcion text;

-- Equivalentes directos: se renombran en el lugar (mismo id, mismo slug
-- viejo reemplazado) para que los usuarios de prueba ya creados contra
-- estas secretarias queden apuntando a la secretaria real correcta.
UPDATE secretarias SET nombre = 'SDOP', slug = 'sdop',
  descripcion = 'Secretaría Departamental de Obras Públicas'
  WHERE slug = 'obras';

UPDATE secretarias SET nombre = 'SDAFP', slug = 'sdafp',
  descripcion = 'Secretaría Departamental de Administración y Finanzas Públicas'
  WHERE slug = 'finanzas';

UPDATE secretarias SET nombre = 'SDDPI', slug = 'sddpi',
  descripcion = 'Secretaría Departamental de Desarrollo Productivo e Industria'
  WHERE slug = 'desarrollo';

-- Sin equivalente en el organigrama real de secretarias: se desactivan (no
-- se borran) -- los usuarios de prueba de Salud/Educacion siguen pudiendo
-- entrar y su historial de prueba queda intacto, solo dejan de aparecer
-- como secretaria activa en el catalogo.
UPDATE secretarias SET activa = false WHERE slug IN ('salud', 'educacion');

-- Comunicacion se mantiene activa: no aparece en el organigrama oficial de
-- "Secretarias" pero es una unidad real de trabajo dentro de la Gobernacion.

-- Las 7 secretarias reales restantes, nuevas.
INSERT INTO secretarias (nombre, slug, descripcion) VALUES
  ('SG', 'sg', 'Secretaría General'),
  ('SDCT', 'sdct', 'Secretaría Departamental de Cultura y Turismo'),
  ('SDMMRE', 'sdmmre', 'Secretaría Departamental de Minería, Metalurgia y Recursos Energéticos'),
  ('SDMAAMT', 'sdmaamt', 'Secretaría Departamental de Medio Ambiente, Agua y Madre Tierra'),
  ('SDDSSA', 'sddssa', 'Secretaría Departamental de Desarrollo Social y Seguridad Alimentaria'),
  ('SDPD', 'sdpd', 'Secretaría Departamental de Planificación del Desarrollo'),
  ('SDAJ', 'sdaj', 'Secretaría Departamental de Asuntos Jurídicos')
ON CONFLICT (slug) DO NOTHING;
