import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export enum InstruccionItemTipo {
  EVENTO = 'evento',
  TAREA = 'tarea',
  PROYECTO = 'proyecto',
  REUNION = 'reunion',
}

export enum ItemTareaPrioridad {
  BAJA = 'baja',
  MEDIA = 'media',
  ALTA = 'alta',
}

// Dos modos:
//  - con refId: vincula un evento/tarea/proyecto que YA existe.
//  - sin refId: crea una tarea nueva (transversal, secretaria_id NULL) y la
//    asigna a `asignadoIds` o, si no vienen, al secretario/director de
//    `secretariaId`. La secretaría la ve por la vía "asignado" de la RLS de
//    tareas, sin ver la instrucción madre.
export class CreateItemDto {
  @IsEnum(InstruccionItemTipo)
  tipo: InstruccionItemTipo;

  @IsOptional()
  @IsUUID('4')
  refId?: string;

  @IsOptional()
  @IsUUID('4')
  secretariaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  titulo?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsEnum(ItemTareaPrioridad)
  prioridad?: ItemTareaPrioridad;

  @IsOptional()
  @IsISO8601()
  fechaVencimiento?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  asignadoIds?: string[];
}
