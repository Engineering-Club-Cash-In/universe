/**
 * COBROS-02 W2 · Reglas puras de la rebaja parcial de mora. Sin base de datos:
 * `controllers/latefee.ts` las usa dentro de su transacción.
 */
import { STATUS_EXCLUIDOS_MORA } from "../constants/creditStatus";

/**
 * Por qué NO se rebaja la mora de un crédito con este estado (null si sí se puede).
 * Convenio, incobrable, cancelado, caído… tienen su propio régimen: no se les
 * toca la mora desde una solicitud de rebaja.
 */
export function motivoRebajaParcialNoPermitida(status: string | null | undefined): string | null {
  if (status && STATUS_EXCLUIDOS_MORA.includes(status)) {
    return `El crédito está en ${status}, con régimen propio: su mora no se rebaja desde aquí.`;
  }
  return null;
}
