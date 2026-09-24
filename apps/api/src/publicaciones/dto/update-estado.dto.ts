import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum EstadoPublicacion {
  BORRADOR = 'borrador',
  REVISION = 'revision',
  APROBADO = 'aprobado',
  PUBLICADO = 'publicado',
}

export class UpdateEstadoDto {
  @IsEnum(EstadoPublicacion)
  estado: EstadoPublicacion;

  // Obligatorio al devolver a 'borrador' (rechazo): el autor tiene que saber
  // por qué. En las transiciones hacia adelante se ignora.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
