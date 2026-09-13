// Espejo de evento_estado (029_agenda_solicitudes.sql). DEFAULT en la base
// sigue siendo 'confirmado' -- este enum solo valida lo que llega por HTTP,
// la autorización real de qué transición vale para qué rol vive en RLS
// (eventos_insert/eventos_update).
export enum EventoEstado {
  SOLICITUD = 'solicitud',
  TENTATIVO = 'tentativo',
  CONFIRMADO = 'confirmado',
  CANCELADO = 'cancelado',
  REALIZADO = 'realizado',
  NO_REALIZADO = 'no_realizado',
}

// Subconjunto aceptado al CREAR (no tendría sentido nacer cancelado/
// realizado/no_realizado).
export const ESTADOS_INICIALES = [
  EventoEstado.SOLICITUD,
  EventoEstado.TENTATIVO,
  EventoEstado.CONFIRMADO,
];
