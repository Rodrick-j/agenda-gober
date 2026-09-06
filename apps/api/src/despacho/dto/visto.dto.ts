import { IsEnum, IsOptional } from 'class-validator';

export enum VistoTipo {
  VISTO = 'visto',
  ACUSE = 'acuse',
}

export class VistoDto {
  // Default 'visto' (abrió el detalle). 'acuse' es el botón "Enterado".
  @IsOptional()
  @IsEnum(VistoTipo)
  tipo?: VistoTipo;
}
