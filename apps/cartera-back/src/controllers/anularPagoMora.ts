import { and, eq, gt, inArray } from "drizzle-orm";
import type { db } from "../database/index";
import {
  creditos,
  moras_historial,
  pagos_credito,
} from "../database/db/schema";
import { updateMora } from "./latefee";
import { resetAjusteFechaIdealSiPagoInvalidado } from "./ajusteFechaIdealPago";
import { restitucionMoraDePagoAnulado } from "../utils/restitucionMoraPagoAnulado";

/**
 * El cuerpo de `falsePayment`: marcar la boleta como falsa Y devolverle al
 * crédito la mora que esa boleta había cobrado, DENTRO DE UNA SOLA
 * TRANSACCIÓN.
 *
 * ── Por qué es un módulo aparte ─────────────────────────────────────────────
 * Vive fuera de `payments.ts` para poder EJERCERSE en una prueba: varios tests
 * de la suite registran un `mock.module("./payments")` global y el módulo real
 * deja de existir en la corrida completa. Las dependencias que también están
 * mockeadas en otros archivos (`./latefee`) entran por `deps` para que la
 * prueba las inyecte y no dependa de cuál mock gane la corrida.
 *
 * ── Por qué una sola transacción ────────────────────────────────────────────
 * Antes eran dos pasos con dos commits: el UPDATE que dejaba
 * `paymentFalse = true` y DESPUÉS la restitución. Si la restitución fallaba
 * —error transitorio, o mora inexistente— la anulación ya estaba firme y
 * lanzar no la deshacía. Y el reintento era peor que inútil: leía
 * `paymentFalse = true`, la regla devolvía `null` y la restitución quedaba
 * saltada PARA SIEMPRE. Boleta anulada, crédito sin la mora que su cliente
 * volvió a deber.
 *
 * Se eligió la transacción y no "marcar falso y reintentar la mora aparte"
 * porque el estado que decide si hay que restituir (`paymentFalse`) es el
 * MISMO que el primer paso pisa: cualquier esquema reintentable necesitaría un
 * marcador durable adicional solo para recordar si la mora ya se devolvió,
 * mientras que la transacción hace que ese estado no pueda avanzar sin ella.
 * Lo que lo impedía era que `updateMora` abría su propia transacción; ahora
 * acepta la del caller.
 *
 * Devuelve cuántas filas de pago se marcaron (siempre 1; el 0 tira).
 */
export type AnularPagoMoraDeps = {
  updateMora: typeof updateMora;
  resetAjusteFechaIdeal: typeof resetAjusteFechaIdealSiPagoInvalidado;
};

const DEPS_REALES = (): AnularPagoMoraDeps => ({
  updateMora,
  resetAjusteFechaIdeal: resetAjusteFechaIdealSiPagoInvalidado,
});

export async function anularPagoYRestituirMora(
  tx: typeof db,
  { pago_id, credito_id }: { pago_id: number; credito_id: number },
  deps: AnularPagoMoraDeps = DEPS_REALES(),
): Promise<number> {
  // 🔒 ORDEN DE CANDADOS: `creditos` PRIMERO, `moras_credito` después (ver el
  // bloque al inicio de `latefee.ts`). Esta transacción toca las dos filas —la
  // segunda adentro de `updateMora`—, así que toma la del crédito acá arriba,
  // antes que ninguna otra. `updateMora` la vuelve a pedir con su propio FOR
  // UPDATE: sobre una fila que esta misma transacción ya candó no espera a
  // nadie.
  const [creditoCandado] = await tx
    .select({ credito_id: creditos.credito_id })
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id))
    .limit(1)
    .for("update");

  if (!creditoCandado) {
    throw new Error("No payment found to mark as false with the given criteria");
  }

  // La mora que ESTE pago había cubierto, leída ANTES de marcarlo falso: es lo
  // único que hay que restituir (no el monto de la boleta, que también trae
  // capital, interés e IVA). `paymentFalse` se lee en la misma consulta para no
  // restituir dos veces si la boleta ya estaba anulada: el UPDATE de abajo pasa
  // igual sobre una fila ya falsa y su `rowCount` no distingue los dos casos.
  // Va con FOR UPDATE porque sin candado dos anulaciones simultáneas leían las
  // dos `paymentFalse = false` y restituían las dos.
  const [pagoPrevio] = await tx
    .select({
      mora: pagos_credito.mora,
      paymentFalse: pagos_credito.paymentFalse,
      created_at: pagos_credito.createdAt,
    })
    .from(pagos_credito)
    .where(
      and(
        eq(pagos_credito.pago_id, pago_id),
        eq(pagos_credito.credito_id, credito_id),
      ),
    )
    .limit(1)
    .for("update");

  // ¿El cron ya repuso esta mora por su cuenta?
  //
  // Registrar un pago baja la mora EN EL ACTO, pero el criterio de cobertura
  // del cron solo cuenta pagos `validated`/`no_required`: un pago que amanece
  // `pending` deja su cuota contada como vencida y `procesarMoras` vuelve a
  // FIJAR la mora completa desde la fórmula —REEMPLAZA el monto, no lo suma—.
  // Después de esa corrida la bajada del pago ya está deshecha, y volver a
  // sumarle `pagos_credito.mora` al anular dejaba al cliente con el doble
  // (Q100 → Q0 → Q100 del cron → Q200). Por eso la restitución se reconcilia
  // contra lo que de verdad falta: si hubo un CREACION/RECALCULO automático
  // posterior al pago, no falta nada.
  //
  // Solo cuentan CREACION y RECALCULO: son los dos eventos con los que el cron
  // FIJA el monto desde la fórmula. Una DESACTIVACION es lo contrario —apagó la
  // mora— y no repone nada.
  //
  // El ancla es `createdat` del pago (el momento en que se escribió la fila y
  // se aplicó el DECREMENTO), no `fecha_pago`, que se puede retrofechar. Si la
  // fila no lo trae, no se reconcilia y se restituye como antes: el sobrecobro
  // lo corrige el cron en su próxima corrida, perderle la mora al crédito no lo
  // corrige nadie.
  const eventosDelCron = pagoPrevio?.created_at
    ? await tx
        .select({ historial_id: moras_historial.historial_id })
        .from(moras_historial)
        .where(
          and(
            eq(moras_historial.credito_id, credito_id),
            eq(moras_historial.origen, "PROCESO_AUTO"),
            inArray(moras_historial.tipo_evento, ["CREACION", "RECALCULO"]),
            gt(moras_historial.fecha, pagoPrevio.created_at),
          ),
        )
        .limit(1)
    : [];

  // Actualizar el estado del pago a falso
  const actualizado = await tx
    .update(pagos_credito)
    .set({
      pagado: false,
      paymentFalse: true,
    })
    .where(
      and(
        eq(pagos_credito.pago_id, pago_id),
        eq(pagos_credito.credito_id, credito_id),
      ),
    );

  // 🚨 Si no se actualizó ningún registro, lanza error controlado
  if (!actualizado.rowCount || actualizado.rowCount === 0) {
    throw new Error("No payment found to mark as false with the given criteria");
  }

  // ── RESTITUIR LA MORA QUE LA BOLETA FALSA HABÍA COBRADO ───────────────────
  // Anular un pago significa que el cliente NO pagó: la mora que esa boleta
  // cubrió le vuelve a deberse. Sin esto el crédito se quedaba sin esa mora y,
  // peor, el `DECREMENTO` del pago quedaba huérfano en `moras_historial`: el
  // reporte de recuperación veía una bajada sin contrapartida y contaba la
  // reposición del cron de la mañana siguiente como mora NUEVA. Mismo patrón
  // que `reversePayment`, con su propio prefijo de motivo —anular no es
  // revertir— para que el historial no confunda los dos hechos.
  const restitucionMora = restitucionMoraDePagoAnulado(pagoPrevio, pago_id, {
    moraRepuestaPorElCron: eventosDelCron.length > 0,
  });

  if (restitucionMora) {
    const resultadoMora = await deps.updateMora({
      credito_id,
      tipo: "INCREMENTO",
      activa: true,
      dbClient: tx,
      ...restitucionMora,
    });

    // El fallo TIENE que tirar: es lo que aborta la transacción y deja el pago
    // SIN marcar, para que el reintento vuelva a intentar las dos cosas.
    if (!resultadoMora.success) {
      throw new Error(
        "Error al restituir la mora del pago anulado: " + resultadoMora.message,
      );
    }
  }

  // Si este pago era el que cobró un ajuste por fecha ideal de pago, resetearlo
  // a pendiente — la boleta resultó falsa, el dinero nunca entró de verdad.
  await deps.resetAjusteFechaIdeal(pago_id, tx);

  return actualizado.rowCount ?? 0;
}
