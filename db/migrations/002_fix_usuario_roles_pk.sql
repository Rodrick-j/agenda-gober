-- 001 usaba (usuario_id, rol_id, secretaria_id) como PK compuesta. Postgres
-- vuelve NOT NULL cualquier columna que forme parte de una PK, así que un rol
-- transversal (gobernador, jefe_gabinete) con secretaria_id NULL nunca podía
-- insertarse. Se reemplaza por un id propio + UNIQUE (permite NULL).
ALTER TABLE usuario_roles DROP CONSTRAINT usuario_roles_pkey;
ALTER TABLE usuario_roles ALTER COLUMN secretaria_id DROP NOT NULL;
ALTER TABLE usuario_roles ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE usuario_roles ADD CONSTRAINT usuario_roles_pkey PRIMARY KEY (id);
ALTER TABLE usuario_roles ADD CONSTRAINT usuario_roles_usuario_rol_secretaria_key
  UNIQUE (usuario_id, rol_id, secretaria_id);
