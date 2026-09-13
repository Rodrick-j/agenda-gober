import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Espejo de indicacion_estado (032): solo estos dos son transiciones válidas
// desde 'pendiente' -- nadie puede insertar directo en estos dos (RLS de
// evento_indicaciones_insert exige estado='pendiente' al crear).
export class AtenderIndicacionDto {
  @IsIn(['aplicada', 'descartada'])
  estado: 'aplicada' | 'descartada';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resultadoNota?: string;
}
