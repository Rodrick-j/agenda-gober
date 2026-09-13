import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReemplazarColaboradoresDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  usuarioIds: string[];
}
