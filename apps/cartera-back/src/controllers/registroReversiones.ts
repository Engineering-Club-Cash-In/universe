/**
 * El acta de defunción de un pago revertido (D-36).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SON DOS ESCRITURAS Y EL ORDEN ES EL DISEÑO, NO UN DETALLE.
 *
 * `reversePayment` corre dentro de una transacción, pero **tres cosas escriben
 * fuera de ella** —`updateMora`, `reverseConvenioPayment` y
 * `processAndReplaceCreditInvestorsReverse` usan el `db` global, no el `tx`—.
 * Existe entonces una ventana en la que la mora ya se devolvió, el convenio ya
 * cambió y el inversionista ya se ajustó, pero el pago **no** quedó revertido.
 *
 * Con un solo INSERT transaccional, ese desastre sería invisible: el rollback
 * se llevaría también el registro. Por eso:
 *
 *   · `iniciada`   va FUERA de la transacción, antes de los `delete`.
 *                  Sobrevive al rollback **a propósito**.
 *   · `completada` va DENTRO, al final. Commitea junto con la reversión.
 *
 * Una fila que se queda en `iniciada` para siempre **es la alarma**: alguien
 * tiene que mirar ese crédito. Hoy esa lista no existe.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Decisión: docs/features/bot-whatsapp-cobros/DECISIONES.md (D-36)
 */

import { and, eq } from "drizzle-orm";
import { db } from "../database";
import {
  boletas,
  cuotas_credito,
  pagos_reversiones,
} from "../database/db/schema";

/** Lo que se sabe del pago justo antes de destruirlo. */
export type PagoARevertir = {
  pago_id: number;
  credito_id: number;
  cuota_id: number | null;
  monto_aplicado: string | null;
  mora: string | null;
  validationStatus: string | null;
  numeroAutorizacion: string | null;
  banco_id: number | null;
};

/**
 * Deja constancia de que se empezó a revertir. **Fuera de la transacción.**
 *
 * Se llama apenas pasa el portero (`revertirAbonoCapitalEspejo`) y **antes** de
 * cualquier `delete`: las URLs de las boletas hay que copiarlas mientras
 * todavía existen, porque después ya no habría de dónde sacarlas.
 *
 * Usa el `db` global a propósito. Si recibiera el `tx`, un rollback se llevaría
 * puesta justo la evidencia que esta fila viene a dejar.
 *
 * **Nunca tira.** Que el registro de auditoría falle no puede impedir una
 * reversión que contabilidad necesita hacer; se loguea y se sigue.
 */
export async function registrarReversionIniciada(
  pago: PagoARevertir,
  usuarioEmail: string,
  motivo?: string | null,
): Promise<number | null> {
  try {
    // Las boletas y el número de cuota, mientras se pueden leer.
    const [urls, numeroCuota] = await Promise.all([
      db
        .select({ url: boletas.url_boleta })
        .from(boletas)
        .where(eq(boletas.pago_id, pago.pago_id)),
      pago.cuota_id === null
        ? Promise.resolve([])
        : db
            .select({ numero: cuotas_credito.numero_cuota })
            .from(cuotas_credito)
            .where(eq(cuotas_credito.cuota_id, pago.cuota_id))
            .limit(1),
    ]);

    const [fila] = await db
      .insert(pagos_reversiones)
      .values({
        estado: "iniciada",
        pago_id: pago.pago_id,
        credito_id: pago.credito_id,
        cuota_id: pago.cuota_id,
        numero_cuota: numeroCuota[0]?.numero ?? null,
        monto: pago.monto_aplicado,
        mora_devuelta: pago.mora,
        validation_status_previo: pago.validationStatus,
        numero_autorizacion: pago.numeroAutorizacion,
        banco_id: pago.banco_id,
        urls_boletas: urls.map((b) => b.url),
        motivo: motivo ?? null,
        usuario_email: usuarioEmail,
        snapshot: pago,
      })
      .returning({ id: pagos_reversiones.reversion_id });

    return fila?.id ?? null;
  } catch (error) {
    console.error(
      `[Reversiones] no se pudo registrar el inicio de la reversión del pago ${pago.pago_id}:`,
      error,
    );
    return null;
  }
}

/**
 * Marca la reversión como terminada. **Dentro de la transacción.**
 *
 * Y de paso pasa a `superada` cualquier `iniciada` previa del mismo pago: si
 * una reversión falló y alguien la reintentó con éxito, la fila vieja ya no
 * tiene que seguir alarmando. Si el reintento también falla, se queda en
 * `iniciada` y sigue alarmando, que es lo correcto.
 *
 * Así la lista de reversiones a medias se limpia sola y nadie tiene que ir a
 * marcar nada a mano.
 */
export async function marcarReversionCompletada(
  // Mismo criterio que `revertirAbonoCapitalEspejo`: el ejecutor es el `tx`.
  ejecutor: any,
  pagoId: number,
  reversionId: number | null,
): Promise<void> {
  // Sin fila de inicio no hay nada que cerrar: el INSERT de `iniciada` falló y
  // ya quedó en el log. Se evita inventar una `completada` huérfana que diría
  // que todo salió bien sin que exista el registro de qué se revirtió.
  if (reversionId === null) return;

  await ejecutor
    .update(pagos_reversiones)
    .set({ estado: "completada" })
    .where(eq(pagos_reversiones.reversion_id, reversionId));

  // Los intentos anteriores que quedaron colgados ya no son un problema
  // abierto: este reintento los resolvió. La fila de arriba ya no es `iniciada`,
  // así que este UPDATE no se pisa a sí mismo.
  await ejecutor
    .update(pagos_reversiones)
    .set({ estado: "superada" })
    .where(
      and(
        eq(pagos_reversiones.pago_id, pagoId),
        eq(pagos_reversiones.estado, "iniciada"),
      ),
    );
}
