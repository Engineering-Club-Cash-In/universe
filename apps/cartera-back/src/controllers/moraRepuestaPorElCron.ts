import { and, eq, gt, inArray } from "drizzle-orm";
import type { db } from "../database/index";
import { moras_historial } from "../database/db/schema";

/**
 * ¿El cron ya repuso, por su cuenta, la mora que este pago había bajado?
 *
 * ── Por qué la pregunta existe ──────────────────────────────────────────────
 * Registrar un pago baja la mora EN EL ACTO (`insertPayment` →
 * `procesarPagoMora` → `updateMora` DECREMENTO), pero el criterio de cobertura
 * del cron solo cuenta pagos `validated`/`no_required` (el EXISTS de
 * `hasPaidPayment` en `procesarMoras`). Un pago que amanece `pending` deja su
 * cuota contada como vencida y el cron vuelve a FIJAR la mora completa desde la
 * fórmula —REEMPLAZA el monto, no lo acumula—. Después de esa corrida la bajada
 * del pago ya está deshecha, y restituirla encima —al anular la boleta o al
 * revertir el pago— le cobra al cliente el doble.
 *
 * Solo cuentan `CREACION` y `RECALCULO`: son los dos eventos con los que el
 * cron fija el monto desde la fórmula. Una `DESACTIVACION` es lo contrario
 * —apagó la mora— y no repone nada.
 *
 * ── El ancla ────────────────────────────────────────────────────────────────
 * Es `pagos_credito.createdat`: el momento en que se escribió la fila y se
 * aplicó el DECREMENTO. NO `fecha_pago`, que es retrofechable y dejaría la
 * ventana en cualquier lado. Sin ancla (`desde` vacío) no se reconcilia nada y
 * el caller restituye como antes: el sobrecobro lo corrige el cron en su
 * próxima corrida, perderle la mora al crédito no lo corrige nadie.
 *
 * ── Por qué es un módulo aparte ─────────────────────────────────────────────
 * Los dos caminos que invalidan un pago —`anularPagoYRestituirMora` y
 * `reversePayment`— necesitan la MISMA respuesta. Con la consulta duplicada,
 * cambiarle el criterio a uno (agregar un `tipo_evento`, mover el ancla) dejaba
 * al otro con la regla vieja, y el que se quedara atrás volvería a sobrecobrar.
 * Acá hay una sola definición.
 *
 * `executor` es el `tx` del caller cuando lo hay: leer con OTRA conexión
 * mientras su transacción tiene filas candadas es pedir un bloqueo contra uno
 * mismo. Es una LECTURA sin candado, así que no participa del orden de candados
 * del módulo (`creditos` antes que `moras_credito`).
 */
export async function elCronYaRepusoLaMora(
  /**
   * `Pick<..., "select">` y no `typeof db`: el `tx` que entrega
   * `db.transaction` es un `PgTransaction` y no trae `$client`. Lo único que se
   * le pide acá es leer.
   */
  executor: Pick<typeof db, "select">,
  {
    credito_id,
    desde,
  }: { credito_id: number; desde: Date | null | undefined },
): Promise<boolean> {
  if (!desde) return false;

  const eventos = await executor
    .select({ historial_id: moras_historial.historial_id })
    .from(moras_historial)
    .where(
      and(
        eq(moras_historial.credito_id, credito_id),
        eq(moras_historial.origen, "PROCESO_AUTO"),
        inArray(moras_historial.tipo_evento, ["CREACION", "RECALCULO"]),
        gt(moras_historial.fecha, desde),
      ),
    )
    .limit(1);

  return eventos.length > 0;
}
