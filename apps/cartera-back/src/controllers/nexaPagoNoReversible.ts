import { and, eq } from "drizzle-orm";
import { db } from "../database";
import { pagos_credito } from "../database/db";

/**
 * Decisión de negocio (06-oct): un pago que entró por Nexa NO se puede anular
 * ni revertir en cartera. Nexa ya aprobó la transferencia y su API no permite
 * deshacerla: revertirlo solo crea un descuadre entre cartera y Nexa.
 *
 * "Vino de Nexa" = la fila del pago tiene `nexa_payment_event_id`. Todas las
 * filas de una misma boleta Nexa lo llevan (registerPayment lo graba en cada
 * una), así que basta con mirar la fila que se quiere deshacer.
 * (`nexa_payment_events.pago_id` solo guarda la primera y puede ser NULL, por
 * eso no se usa.)
 */
export {
  NEXA_PAYMENT_NOT_REVERSIBLE_CODE,
  NEXA_PAYMENT_NOT_REVERSIBLE_MESSAGE,
  NexaPaymentNotReversibleError,
  esNexaPaymentNotReversibleError,
  respuestaNexaNoReversible,
  pagoNexaBloqueaAnular,
  desligarFilaDeEventoNexaFallido,
} from "./nexaPagoNoReversibleError";
import { NexaPaymentNotReversibleError, pagoNexaBloqueaAnular } from "./nexaPagoNoReversibleError";

type Ejecutor = Pick<typeof db, "select">;

async function eventoNexaDelPago(
  { credito_id, pago_id }: { credito_id: number; pago_id: number },
  ejecutor: Ejecutor,
): Promise<number | null> {
  const [fila] = await ejecutor
    .select({ nexaPaymentEventId: pagos_credito.nexaPaymentEventId })
    .from(pagos_credito)
    .where(
      and(
        eq(pagos_credito.credito_id, credito_id),
        eq(pagos_credito.pago_id, pago_id),
      ),
    )
    .limit(1);
  return fila?.nexaPaymentEventId ?? null;
}

export async function pagoEntroPorNexa(
  ids: { credito_id: number; pago_id: number },
  ejecutor: Ejecutor = db,
): Promise<boolean> {
  return (await eventoNexaDelPago(ids, ejecutor)) != null;
}

/**
 * Tira `NexaPaymentNotReversibleError` si el pago entró por Nexa, salvo que su evento esté
 * `failed` (Nexa devolvió el dinero y la fila se tiene que anular): ver `pagoNexaBloqueaAnular`.
 */
export async function rechazarSiPagoEsNexa(
  ids: { credito_id: number; pago_id: number },
  ejecutor: Pick<typeof db, "select" | "execute"> = db,
): Promise<void> {
  if (await pagoNexaBloqueaAnular(ejecutor, await eventoNexaDelPago(ids, ejecutor))) {
    throw new NexaPaymentNotReversibleError();
  }
}
