import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { NivelConfidencialidad } from '../../publicaciones/dto/create-publicacion.dto';
import { ESTADOS_INICIALES, EventoEstado } from './evento-estado.enum';

export enum EventoTipo {
  REUNION = 'reunion',
  AUDIENCIA = 'audiencia',
  INSPECCION = 'inspeccion',
  ACTO = 'acto',
  CONFERENCIA = 'conferencia',
  OTRO = 'otro',
}

export class CreateEventoDto {
  @IsOptional()
  @IsEnum(EventoTipo)
  tipo?: EventoTipo;

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

  // Texto libre, provisional (034_agenda_mesa_trabajo.sql): no existe hoy un
  // directorio de organizaciones/contactos -- eso es una pieza deferida del
  // diseño original, esto es solo la columna que la mesa de trabajo
  // necesita mientras tanto.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organizacionSolicitante?: string;

  // Opcionales: "registro corto, incluso sin horario" (solicitud de apoyo).
  // Cualquier otro estado exige ambas -- lo exige igual la base
  // (estado_requiere_fecha, 029_agenda_solicitudes.sql); acá solo se valida
  // el formato si vienen.
  @IsOptional()
  @IsISO8601()
  fechaInicio?: string;

  @IsOptional()
  @IsISO8601()
  fechaFin?: string;

  @IsEnum(NivelConfidencialidad)
  nivelConfidencialidad: NivelConfidencialidad;

  @IsOptional()
  @IsBoolean()
  recordatoriosActivos?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  responsableIds?: string[];

  // Si se omite, la base aplica su DEFAULT ('confirmado') -- se preserva el
  // comportamiento de siempre para quien no sabe de este campo. `apoyo`
  // nunca puede dejarlo en blanco esperando ese default: RLS exige
  // 'solicitud'/'tentativo' para su rama (eventos_insert, 029); el service
  // lo completa a 'solicitud' cuando no se indica.
  @IsOptional()
  @IsIn(ESTADOS_INICIALES)
  estado?: EventoEstado;

  // Explícito, nunca inferido de confirmar un evento transversal (corrección
  // real de esta sesión: la versión anterior agregaba automáticamente a
  // TODOS los usuarios con rol `gobernador` al confirmar cualquier evento
  // transversal). Quien crea/edita decide si el Gobernador participa.
  @IsOptional()
  @IsBoolean()
  participaGobernador?: boolean;
}
