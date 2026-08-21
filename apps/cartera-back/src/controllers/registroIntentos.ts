/**
 * El acta del intento de registro de un pago del bot (§4.1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `insertPayment` ESCRIBE COSAS ANTES DE LA PRIMERA FILA DE `pagos_credito`.
 *
 * La mora (`updateMora`) y el pago de convenio se comitean antes de que exista
 * el pago. Si el proceso revienta en esa ventana, el 500 es indeterminado, pero
 * no queda pago, ni boleta, ni reversión que lo delate: la reconciliación del
 * bot leería "acá no pasó nada" y dejaría reintentar — aplicando la boleta
 * completa sobre una mora ya descontada.
 *
 * Con el acta, un `iniciado` que nadie completó es la prueba de que un registro
 * murió a medias, y esa boleta va a revisión manual en vez de reabrirse.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Solo para pagos del bot: los demás canales tienen a una persona adelante que
 * ve el error y no hay reconciliación automática que pueda decidir mal.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../database";
import { pagos_intentos_boleta } from "../database/db/schema";

/** Con quién registra sus pagos el bot (copiado del CRM, no cambiar solo acá). */
export const REGISTRADO_POR_EL_BOT = "bot-cobros@clubcashin.com";

/**
 * Deja constancia de que un registro está por empezar a escribir.
 *
 * Usa el `db` global a propósito: tiene que sobrevivir a cualquier cosa que le
 * pase al registro. Si ESTA escritura falla, el llamador debe abortar ANTES de
 * mutar nada — sin acta no hay red, y un 500 acá es seguro porque todavía no se
 * escribió nada.
 */
export async function registrarIntentoIniciado(datos: {
  credito_id: number;
  register_by: string;
  monto_boleta: number;
  urls_boletas: string[];
}): Promise<number> {
  const [fila] = await db
    .insert(pagos_intentos_boleta)
    .values({
      credito_id: datos.credito_id,
      register_by: datos.register_by,
      monto_boleta: datos.monto_boleta.toString(),
      urls_boletas: datos.urls_boletas,
    })
    .returning({ intento_id: pagos_intentos_boleta.intento_id });

  return fila.intento_id;
}

/**
 * El registro terminó bien: el acta se cierra.
 *
 * Nunca tira — el pago ya está escrito y un fallo acá no puede convertirlo en
 * error. Si esta marca se pierde, el intento queda `iniciado` con pagos vivos a
 * la vista, y la reconciliación resuelve por los pagos, que mandan.
 */
export async function marcarIntentoCompletado(
  intentoId: number,
): Promise<void> {
  try {
    await db
      .update(pagos_intentos_boleta)
      .set({ estado: "completado", completado_en: sql`now()` })
      .where(
        and(
          eq(pagos_intentos_boleta.intento_id, intentoId),
          eq(pagos_intentos_boleta.estado, "iniciado"),
        ),
      );
  } catch (error) {
    console.error(
      `[registroIntentos] no se pudo cerrar el intento ${intentoId}:`,
      error,
    );
  }
}
