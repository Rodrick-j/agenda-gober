import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export enum InstruccionPrioridad {
  BAJA = 'baja',
  MEDIA = 'media',
  ALTA = 'alta',
  URGENTE = 'urgente',
}

// No incluye emitida_por: siempre sale del usuario autenticado
// (TxService.currentUser). Y la política RLS instrucciones_insert exige que
// el rol sea 'gobernador' -- si otro rol lo intenta, Postgres responde 42501
// y mapPgError lo traduce a 403.
export class CreateInstruccionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titulo: string;

  @IsString()
  @IsNotEmpty()
  objetivo: string;

  @IsOptional()
  @IsEnum(InstruccionPrioridad)
  prioridad?: InstruccionPrioridad;

  @IsOptional()
  @IsISO8601()
  fechaLimite?: string;
}
