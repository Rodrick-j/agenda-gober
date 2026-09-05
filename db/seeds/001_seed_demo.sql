INSERT INTO secretarias (nombre, slug) VALUES
  ('Salud', 'salud'),
  ('Obras Publicas', 'obras'),
  ('Finanzas', 'finanzas'),
  ('Desarrollo Productivo', 'desarrollo'),
  ('Educacion', 'educacion'),
  ('Comunicacion', 'comunicacion')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO roles (nombre, ambito_secretaria) VALUES
  ('gobernador', false),
  ('jefe_gabinete', false),
  ('admin', false),
  ('secretario', true),
  ('director', true),
  ('operador', true)
ON CONFLICT (nombre) DO NOTHING;
