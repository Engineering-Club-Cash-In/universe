import { sql, type SQL } from "drizzle-orm";

/**
 * «Esta cuota ya tiene un pago que la cubre», con el criterio del cron.
 *
 * Vive en UN lugar porque de él cuelgan dos cosas que tienen que coincidir:
 * las cuotas que el cron `procesarMoras` cobra y las cuotas a las que el pago
 * y la condonación le anotan lo abonado (`cuotasParaPendienteDeCreditos`). Si
 * divergieran, se anotaría en cuotas que el cron ya no mira y el cron volvería
 * a cobrar mora ya pagada.
 *
 * La cuota de afuera va escrita con su tabla, a mano, y no como
 * `${cuotas_credito.cuota_id}`: en un select de UNA sola tabla (sin join)
 * Drizzle la renderiza como `"cuota_id"` a secas, que dentro de este
 * subquery se resuelve a `pc.cuota_id` — la condición queda
 * `pc.cuota_id = pc.cuota_id` y cualquier pago validado de la base marca
 * todas las cuotas como pagadas. Mismo cuidado que `incrementosMoraPorCredito`.
 */
export function hasPaidPaymentSql(): SQL<boolean> {
  return sql<boolean>`EXISTS (
    SELECT 1
    FROM cartera.pagos_credito pc
    WHERE pc.cuota_id = "cartera"."cuotas_credito"."cuota_id"
      AND pc."paymentFalse" = false
      AND pc.pagado = true
      AND pc.validation_status IN ('validated', 'no_required')
      AND COALESCE(pc.monto_aplicado, 0) > 0
  )`;
}
