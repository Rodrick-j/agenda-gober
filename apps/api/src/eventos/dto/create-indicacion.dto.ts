import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Espejo de indicacion_tipo (032_evento_indicaciones.sql).
export enum IndicacionTipo {
  REPROGRAMAR = 'reprogramar',
  CANCELAR = 'cancelar',
  ACLARACION = 'aclaracion',
  OTRO = 'otro',
}

export class CreateIndicacionDto {
  @IsEnum(IndicacionTipo)
  tipo: IndicacionTipo;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  texto: string;
}
