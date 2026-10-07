import { sql } from "drizzle-orm";
import type { db } from "../database/index";

/**
 * El error de negocio "pago Nexa no anulable" (409), sin dependencias: lo
 * importan módulos que no pueden arrastrar la conexión a la base
 * (`anularPagoMora.ts`). La regla y la lectura viven en `nexaPagoNoReversible.ts`.
 */
export const NEXA_PAYMENT_NOT_REVERSIBLE_CODE = "nexa_payment_not_reversible";
export const NEXA_PAYMENT_NOT_REVERSIBLE_MESSAGE =
  "Este pago entró por Nexa y no se puede anular.";

export class NexaPaymentNotReversibleError extends Error {
  readonly code = NEXA_PAYMENT_NOT_REVERSIBLE_CODE;
  readonly status = 409 as const;
  constructor() {
    super(NEXA_PAYMENT_NOT_REVERSIBLE_MESSAGE);
  }
}

export function esNexaPaymentNotReversibleError(
  error: unknown,
): error is NexaPaymentNotReversibleError {
  return error instanceof NexaPaymentNotReversibleError;
}

export function respuestaNexaNoReversible() {
  return {
    success: false as const,
    code: NEXA_PAYMENT_NOT_REVERSIBLE_CODE,
    message: NEXA_PAYMENT_NOT_REVERSIBLE_MESSAGE,
  };
}

/**
 * ¿La fila ligada a este evento Nexa queda bloqueada para anular/revertir? Sí, salvo que el evento
 * esté `failed`: Nexa rechazó la transferencia y devolvió el dinero, así que las filas que alcanzaron
 * a crearse SE TIENEN que anular (el dashboard lo pide). `failed` es el único estado de rechazo; todo
 * lo demás (processing, manual_review, applied, billing_*, billed) aceptó o puede haber aceptado la
 * transferencia y sigue bloqueado. Sin evento encontrado también bloquea: ante la duda, no se anula.
 * Los chequeos que deciden corren bajo el candado del crédito, que también toma el handler de Nexa,
 * así que el status no cambia entre esta lectura y la escritura.
 */
export async function pagoNexaBloqueaAnular(
  ejecutor: Pick<typeof db, "execute">,
  nexaPaymentEventId: number | null | undefined,
): Promise<boolean> {
  if (nexaPaymentEventId == null) return false;
  const result = await ejecutor.execute(sql`
    SELECT status FROM cartera.nexa_payment_events WHERE id = ${nexaPaymentEventId}`);
  const fila = result.rows[0] as { status?: string } | undefined;
  return fila?.status !== "failed";
}

/**
 * Al anular una fila de un evento Nexa `failed`, la desliga del evento (nexa_payment_event_id = NULL)
 * en la misma transacción y bajo el candado. Si quedara ligada, el reintento de Nexa de esa
 * transferencia la encontraría con `findPayments` (que no filtra anuladas), se saltaría el registro
 * limpio y reaplicaría la fila anulada o reseteada. Desligada, el reintento ve 0 filas y registra un
 * pago nuevo. Solo toca la fila si el evento sigue `failed`; devuelve si la desligó.
 * Si el evento además apunta a esta fila (`nexa_payment_events.pago_id`, FK sin ON DELETE), también
 * se le suelta el pago_id: la reversa puede borrar la fila (rama de pago parcial) y el DELETE
 * violaría la FK. No se pone `pago_id_eliminado`, que significa "aceptado y borrado" y haría que el
 * reintento se contestara como aplicado; con pago_id NULL un `failed` sigue siendo `retry`.
 *
 * La usan las rutas que ANULAN de verdad (falsePayment/anularPagoMora y reversePayment). La vuelta a
 * pendiente no: la fila sigue viva con sus montos como el registro de esa transferencia, y si Nexa
 * la reintenta el camino normal la reaplica en vez de duplicarla.
 */
export async function desligarFilaDeEventoNexaFallido(
  ejecutor: Pick<typeof db, "execute">,
  pagoId: number,
  nexaPaymentEventId: number | null | undefined,
): Promise<boolean> {
  if (nexaPaymentEventId == null) return false;
  await ejecutor.execute(sql`
    UPDATE cartera.nexa_payment_events SET pago_id = NULL, updated_at = now()
    WHERE id = ${nexaPaymentEventId} AND status = 'failed' AND pago_id = ${pagoId}`);
  const result = await ejecutor.execute(sql`
    UPDATE cartera.pagos_credito SET nexa_payment_event_id = NULL
    WHERE pago_id = ${pagoId}
      AND nexa_payment_event_id = ${nexaPaymentEventId}
      AND EXISTS (SELECT 1 FROM cartera.nexa_payment_events e
                  WHERE e.id = ${nexaPaymentEventId} AND e.status = 'failed')`);
  return Number(result.rowCount ?? 0) > 0;
}
