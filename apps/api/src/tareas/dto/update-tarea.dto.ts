import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateTareaDto, TareaEstado } from './create-tarea.dto';

export class UpdateTareaDto extends PartialType(OmitType(CreateTareaDto, ['asignadoIds'] as const)) {
  @IsOptional()
  @IsEnum(TareaEstado)
  estado?: TareaEstado;
}
