import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { EventoEstado } from './evento-estado.enum';

// Filtros de la mesa de trabajo (vista de tabla) -- todo opcional, se
// combinan con AND. Sin DTO de body porque es un GET: los valores llegan
// como querystring, de ahí los @Transform (booleans/arrays como texto).
export class MesaTrabajoFiltroDto {
  @IsOptional()
  @IsISO8601()
  desde?: string;

  @IsOptional()
  @IsISO8601()
  hasta?: string;

  // Busca en título, organización solicitante y lugar (ILIKE).
  @IsOptional()
  @IsString()
  busqueda?: string;

  // "estado=solicitud,tentativo" -- se separa en el controller antes de
  // llegar acá transformado a array.
  @IsOptional()
  @IsArray()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  estado?: EventoEstado[];

  @IsOptional()
  @IsUUID('4')
  responsableApoyoId?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  participaGobernador?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  sinHorario?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  conIndicacionPendiente?: boolean;

  @IsOptional()
  pagina?: string;

  @IsOptional()
  porPagina?: string;
}
