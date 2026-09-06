import { IsEnum, IsOptional, IsUUID } from 'class-validator';

// Vía API solo se permiten las salidas manuales. El resto de transiciones
// (emitida → en_organizacion → en_ejecucion → cumplida) las hace sola
// fn_despacho_recalcular a partir de los ítems.
export enum InstruccionEstadoManual {
  OBSERVADA = 'observada',
  CANCELADA = 'cancelada',
}

export class UpdateInstruccionDto {
  // El Jefe de Gabinete "toma" la instrucción. Al hacerlo, si sigue en
  // 'emitida' pasa a 'en_organizacion'.
  @IsOptional()
  @IsUUID('4')
  organizaId?: string;

  @IsOptional()
  @IsEnum(InstruccionEstadoManual)
  estado?: InstruccionEstadoManual;
}
