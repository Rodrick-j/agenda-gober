import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export enum NivelConfidencialidad {
  PUBLICA = 'publica',
  INTERNA = 'interna',
  RESERVADA = 'reservada',
  CONFIDENCIAL = 'confidencial',
}

// A propósito NO incluye secretaria_id: siempre se toma del usuario
// autenticado (TxService.currentUser), nunca de lo que mande el cliente.
// El ValidationPipe global (forbidNonWhitelisted) rechaza con 400 cualquier
// intento de colarlo en el body.
export class CreatePublicacionDto {
  @IsString()
  @IsNotEmpty()
  titulo: string;

  @IsString()
  @IsNotEmpty()
  contenido: string;

  @IsEnum(NivelConfidencialidad)
  nivelConfidencialidad: NivelConfidencialidad;
}
