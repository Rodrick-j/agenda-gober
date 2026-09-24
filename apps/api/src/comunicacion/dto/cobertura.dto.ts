import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export enum CoberturaEstado {
  SOLICITADA = 'solicitada',
  PLANIFICADA = 'planificada',
  EN_PRODUCCION = 'en_produccion',
  LISTA = 'lista',
  PUBLICADA = 'publicada',
  DESCARTADA = 'descartada',
}

export class PedirCoberturaDto {
  @IsUUID('4')
  eventoId: string;
}

export class ActualizarCoberturaDto {
  @IsOptional()
  @IsEnum(CoberturaEstado)
  estado?: CoberturaEstado;

  @IsOptional()
  @IsUUID('4')
  comunicadorId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tipoPieza?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  enfoque?: string;

  @IsOptional()
  @IsUUID('4')
  publicacionId?: string;
}
