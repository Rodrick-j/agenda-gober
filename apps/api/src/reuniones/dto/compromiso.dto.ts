import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export enum CompromisoEstado {
  PENDIENTE = 'pendiente',
  CUMPLIDO = 'cumplido',
}

export class CreateCompromisoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  descripcion: string;

  @IsOptional()
  @IsUUID('4')
  responsableId?: string;

  @IsOptional()
  @IsISO8601()
  fechaLimite?: string;
}

export class UpdateCompromisoDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  descripcion?: string;

  @IsOptional()
  @IsUUID('4')
  responsableId?: string;

  @IsOptional()
  @IsISO8601()
  fechaLimite?: string;

  @IsOptional()
  @IsEnum(CompromisoEstado)
  estado?: CompromisoEstado;
}
