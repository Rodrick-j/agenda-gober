import { Injectable } from '@nestjs/common';
import type { QueryResult, QueryResultRow } from 'pg';
import { getRequestContext } from './request-context';

// Único punto por el que el resto de la app toca la base de datos dentro de
// una request. Usa siempre el cliente de la transacción ya contextualizada
// (nunca el pool directo), para que las políticas RLS se apliquen siempre.
@Injectable()
export class TxService {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    const { client } = getRequestContext();
    return client.query<T>(text, params);
  }

  get currentUser() {
    const { userId, rol, secretariaId } = getRequestContext();
    return { userId, rol, secretariaId };
  }
}
