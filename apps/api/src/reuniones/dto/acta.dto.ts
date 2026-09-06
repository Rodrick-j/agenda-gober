import { IsNotEmpty, IsString } from 'class-validator';

export class UpsertActaDto {
  @IsString()
  @IsNotEmpty()
  contenido: string;
}
