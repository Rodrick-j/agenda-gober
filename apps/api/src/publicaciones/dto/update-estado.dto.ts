import { IsEnum } from 'class-validator';

export enum EstadoPublicacion {
  BORRADOR = 'borrador',
  REVISION = 'revision',
  APROBADO = 'aprobado',
  PUBLICADO = 'publicado',
}

export class UpdateEstadoDto {
  @IsEnum(EstadoPublicacion)
  estado: EstadoPublicacion;
}
