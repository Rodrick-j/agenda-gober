import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CrearSecretariaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nombre: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug solo puede tener minúsculas, números y guiones' })
  slug: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descripcion?: string;
}

export class ActualizarSecretariaDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  descripcion?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
