import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

// Devolver un ítem y reabrir una instrucción exigen motivo (decisión #4).
export class MotivoDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(500)
  motivo: string;
}
