import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class ConflictosEventoDto {
  @IsISO8601()
  fechaInicio: string;

  @IsISO8601()
  fechaFin: string;

  @IsOptional()
  @IsUUID('4')
  excluirId?: string;
}
