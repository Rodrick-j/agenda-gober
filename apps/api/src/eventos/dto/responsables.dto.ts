import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReemplazarResponsablesDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  usuarioIds: string[];
}
