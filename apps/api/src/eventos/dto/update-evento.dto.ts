import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateEventoDto } from './create-evento.dto';
import { EventoEstado } from './evento-estado.enum';

// `estado` se redefine aparte (no hereda la restricción de CreateEventoDto a
// solo estados iniciales): al editar sí valen las transiciones a
// cancelado/realizado/no_realizado. Quién puede dejarlo en cuál lo decide
// RLS (eventos_update, 029_agenda_solicitudes.sql), no esta validación.
export class UpdateEventoDto extends PartialType(
  OmitType(CreateEventoDto, ['responsableIds', 'estado'] as const),
) {
  @IsOptional()
  @IsEnum(EventoEstado)
  estado?: EventoEstado;
}
