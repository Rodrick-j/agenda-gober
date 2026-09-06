import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { NivelConfidencialidad } from '../../publicaciones/dto/create-publicacion.dto';

export enum TareaEstado {
  PENDIENTE = 'pendiente',
  EN_PROGRESO = 'en_progreso',
  COMPLETADA = 'completada',
  CANCELADA = 'cancelada',
}

export enum TareaPrioridad {
  BAJA = 'baja',
  MEDIA = 'media',
  ALTA = 'alta',
}

export class CreateTareaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titulo: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsEnum(TareaPrioridad)
  prioridad?: TareaPrioridad;

  @IsOptional()
  @IsISO8601()
  fechaVencimiento?: string;

  @IsEnum(NivelConfidencialidad)
  nivelConfidencialidad: NivelConfidencialidad;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  asignadoIds?: string[];
}
