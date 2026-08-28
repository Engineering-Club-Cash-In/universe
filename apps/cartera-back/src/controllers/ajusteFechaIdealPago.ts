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
