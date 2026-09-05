import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateEventoDto } from './create-evento.dto';

export class UpdateEventoDto extends PartialType(OmitType(CreateEventoDto, ['responsableIds'] as const)) {}
