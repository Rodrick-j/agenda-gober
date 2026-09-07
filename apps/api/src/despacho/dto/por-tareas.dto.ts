import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class PorTareasDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  tareaIds: string[];
}
