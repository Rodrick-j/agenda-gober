import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum EvidenciaTipo {
  INFORME = 'informe',
  FOTO = 'foto',
  DOCUMENTO = 'documento',
}

// Metadata que acompaña al archivo en el multipart.
export class EvidenciaMetaDto {
  @IsOptional()
  @IsEnum(EvidenciaTipo)
  tipo?: EvidenciaTipo;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
