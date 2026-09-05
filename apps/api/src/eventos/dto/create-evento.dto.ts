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

export class CreateEventoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titulo: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  lugar?: string;

  @IsISO8601()
  fechaInicio: string;

  @IsISO8601()
  fechaFin: string;

  @IsEnum(NivelConfidencialidad)
  nivelConfidencialidad: NivelConfidencialidad;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  responsableIds?: string[];
}
