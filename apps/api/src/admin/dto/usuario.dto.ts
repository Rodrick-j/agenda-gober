import { IsBoolean, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export enum RolNombre {
  GOBERNADOR = 'gobernador',
  JEFE_GABINETE = 'jefe_gabinete',
  ADMIN = 'admin',
  SECRETARIO = 'secretario',
  DIRECTOR = 'director',
  OPERADOR = 'operador',
}

export class CrearUsuarioDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nombre: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(RolNombre)
  rol: RolNombre;

  @IsOptional()
  @IsUUID('4')
  secretariaId?: string;
}

export class ActualizarUsuarioDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nombre?: string;

  @IsOptional()
  @IsEnum(RolNombre)
  rol?: RolNombre;

  @IsOptional()
  @IsUUID('4')
  secretariaId?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  password: string;
}
