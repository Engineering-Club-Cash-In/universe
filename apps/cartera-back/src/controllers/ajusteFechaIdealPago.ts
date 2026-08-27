import { eq } from "drizzle-orm";
import { db } from "../database";
import { ajuste_fecha_ideal_pago } from "../database/db";

type Executor = Pick<typeof db, "update">;

/**
 * Si pago_id es el que cobró un ajuste por fecha ideal de pago (ver
 * insertPayment en registerPayment.ts), lo resetea a pendiente
 * (fecha_cobro/pago_id = NULL). Se debe llamar en TODO lugar que invalide un
 * pago ya aplicado — reversión, boleta falsa, anulación por incobrable, etc.
 * Sin esto el dinero queda "cobrado" para siempre apuntando a un pago que en
 * realidad nunca entró, y nadie lo vuelve a cobrar.
 *
 * No-op silencioso si pago_id no es el que cobró ningún ajuste (caso normal).
 */
export async function resetAjusteFechaIdealSiPagoInvalidado(
  pago_id: number,
  executor: Executor = db
): Promise<void> {
  const reseteado = await executor
    .update(ajuste_fecha_ideal_pago)
    .set({ fecha_cobro: null, pago_id: null })
    .where(eq(ajuste_fecha_ideal_pago.pago_id, pago_id))
    .returning({ id: ajuste_fecha_ideal_pago.id });

  if (reseteado.length > 0) {
    console.log(
      `🧾 Ajuste por fecha ideal de pago #${reseteado[0].id} reseteado a pendiente (pago_id=${pago_id} invalidado).`
    );
  }
}

/**
 * Igual que resetAjusteFechaIdealSiPagoInvalidado pero buscando por crédito.
 * Para los flujos que BORRAN el pago que cobró el ajuste en vez de marcarlo
 * inválido (marcarCreditoComoCaido): ahí el pago_id ya no sirve de llave —
 * el ON DELETE SET NULL del FK lo dejó en NULL y fecha_cobro se quedaría
 * marcada para siempre sin ningún pago detrás. Hay a lo sumo 1 fila por
 * crédito (uq_ajuste_fecha_ideal_pago_credito), así que credito_id basta.
 *
 * No-op silencioso si el crédito no tiene ajuste (caso normal).
 */
export async function resetAjusteFechaIdealPorCredito(
  credito_id: number,
  executor: Executor = db
): Promise<void> {
  const reseteado = await executor
    .update(ajuste_fecha_ideal_pago)
    .set({ fecha_cobro: null, pago_id: null })
    .where(eq(ajuste_fecha_ideal_pago.credito_id, credito_id))
    .returning({ id: ajuste_fecha_ideal_pago.id });

  if (reseteado.length > 0) {
    console.log(
      `🧾 Ajuste por fecha ideal de pago #${reseteado[0].id} reseteado a pendiente (crédito ${credito_id}: se borraron sus pagos).`
    );
  }
}
