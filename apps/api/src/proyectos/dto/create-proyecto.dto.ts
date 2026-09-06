import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { NivelConfidencialidad } from '../../publicaciones/dto/create-publicacion.dto';

export enum ProyectoEstado {
  PLANIFICACION = 'planificacion',
  EN_EJECUCION = 'en_ejecucion',
  PAUSADO = 'pausado',
  FINALIZADO = 'finalizado',
  CANCELADO = 'cancelado',
}

export class CreateProyectoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  presupuesto?: number;

  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaFinEstimada?: string;

  @IsEnum(NivelConfidencialidad)
  nivelConfidencialidad: NivelConfidencialidad;
}

export class UpdateProyectoDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nombre?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsEnum(ProyectoEstado)
  estado?: ProyectoEstado;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  avancePorcentaje?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  presupuesto?: number;

  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaFinEstimada?: string;

  @IsOptional()
  @IsEnum(NivelConfidencialidad)
  nivelConfidencialidad?: NivelConfidencialidad;
}
