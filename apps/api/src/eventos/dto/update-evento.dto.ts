import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
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

  // Bloqueo optimista (034_agenda_mesa_trabajo.sql, "protección frente a
  // cambios simultáneos"): el `updated_at` que el cliente vio la última vez
  // que cargó el registro. Si alguien más lo modificó mientras tanto, el
  // UPDATE no encuentra la fila con ESE updated_at y el service devuelve
  // 409 con el estado actual, en vez de sobrescribir en silencio. Opcional
  // a propósito -- quien no lo manda mantiene el comportamiento de siempre
  // (el diálogo de edición del calendario, por ejemplo, ya reduce el riesgo
  // abriendo el registro justo antes de editar).
  @IsOptional()
  @IsISO8601()
  ifUpdatedAt?: string;
}
