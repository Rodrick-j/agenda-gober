import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// Excepción deliberada al principio "RLS es la única fuente de verdad": las
// tablas que toca este módulo (usuarios, usuario_roles) NO tienen RLS -- no
// pueden tenerla, porque el login las consulta con el pool crudo, ANTES de
// que exista ningún contexto de sesión que una política pudiera evaluar (ver
// el comentario en auth.service.ts). Este guard es, acá sí, la barrera real.
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
