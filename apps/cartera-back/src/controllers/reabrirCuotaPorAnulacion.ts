import { and, eq } from "drizzle-orm";
import type { db } from "../database/index";
import { creditos, cuotas_credito, pagos_credito } from "../database/db/schema";
import { planReaperturaCuotaPorAnulacion } from "./reabrirCuotaPorAnulacionPolicy";

/**
 * Deshace en la cuota lo que `insertPayment` estampó con el pago que se acaba de
 * anular (`pagado = true` y los `*_restante` descontados en las filas hermanas).
 * La decisión es de `planReaperturaCuotaPorAnulacion`; esto solo lee y escribe.
 *
 * Corre DENTRO de la transacción de `anularPagoYRestituirMora`, después de marcar
 * la fila `paymentFalse = true`, así que `creditos` ya está candado. Orden de
 * escritura: `pagos_credito` (hermanas) y luego `cuotas_credito`. Es el orden
 * inverso al de RAMA B de `aplicarPagoNormalEnTx` (cuotas primero), pero no hay
 * abrazo mortal: todos los escritores del crédito hacen cola en
 * `withPaymentAdvisoryLock(credito_id)` y esta tx ya tiene `creditos FOR UPDATE`.
 */
export async function reabrirCuotaPorAnulacion(
  tx: typeof db,
  { pago_id, credito_id }: { pago_id: number; credito_id: number },
): Promise<void> {
  const [anulada] = await tx
    .select({
      cuota_id: pagos_credito.cuota_id,
      abono_capital: pagos_credito.abono_capital,
      abono_interes: pagos_credito.abono_interes,
      abono_iva_12: pagos_credito.abono_iva_12,
      abono_seguro: pagos_credito.abono_seguro,
      abono_gps: pagos_credito.abono_gps,
      membresias_pago: pagos_credito.membresias_pago,
      capital_restante: pagos_credito.capital_restante,
      interes_restante: pagos_credito.interes_restante,
      iva_12_restante: pagos_credito.iva_12_restante,
      seguro_restante: pagos_credito.seguro_restante,
      gps_restante: pagos_credito.gps_restante,
      membresias: pagos_credito.membresias,
    })
    .from(pagos_credito)
    .where(and(eq(pagos_credito.pago_id, pago_id), eq(pagos_credito.credito_id, credito_id)))
    .limit(1);
  if (!anulada || anulada.cuota_id == null) return;

  const [credito] = await tx
    .select({ cuota: creditos.cuota, statusCredit: creditos.statusCredit, capital: creditos.capital })
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id))
    .limit(1);

  const hermanas = await tx
    .select({
      pago_id: pagos_credito.pago_id,
      validationStatus: pagos_credito.validationStatus,
      paymentFalse: pagos_credito.paymentFalse,
      abono_capital: pagos_credito.abono_capital,
      abono_interes: pagos_credito.abono_interes,
      abono_iva_12: pagos_credito.abono_iva_12,
      abono_seguro: pagos_credito.abono_seguro,
      abono_gps: pagos_credito.abono_gps,
      membresias_pago: pagos_credito.membresias_pago,
      // Para `cuentaComoHermanoVivo` (hermanas `no_required` con plata cubren la cuota).
      monto_aplicado: pagos_credito.monto_aplicado,
      abono_interes_ci: pagos_credito.abono_interes_ci,
      abono_iva_ci: pagos_credito.abono_iva_ci,
      mora: pagos_credito.mora,
      pagoConvenio: pagos_credito.pagoConvenio,
      otros: pagos_credito.otros,
    })
    .from(pagos_credito)
    .where(
      and(
        eq(pagos_credito.cuota_id, anulada.cuota_id),
        eq(pagos_credito.credito_id, credito_id),
        eq(pagos_credito.paymentFalse, false),
      ),
    );

  const plan = planReaperturaCuotaPorAnulacion({
    creditoId: credito_id,
    montoCuota: credito?.cuota,
    statusCredit: credito?.statusCredit,
    capital: credito?.capital,
    filaAnulada: anulada,
    hermanas,
  });

  if (plan.replica) {
    await tx
      .update(pagos_credito)
      .set(plan.replica.payload)
      .where(
        and(
          eq(pagos_credito.cuota_id, plan.replica.cuotaId),
          eq(pagos_credito.credito_id, plan.replica.creditoId),
          eq(pagos_credito.paymentFalse, false),
        ),
      );
  }
  if (plan.reabrirFilas) {
    await tx
      .update(pagos_credito)
      .set({ pagado: false })
      .where(
        and(
          eq(pagos_credito.cuota_id, anulada.cuota_id),
          eq(pagos_credito.credito_id, credito_id),
          eq(pagos_credito.paymentFalse, false),
          eq(pagos_credito.pagado, true),
        ),
      );
  }
  if (plan.reabrirCuota) {
    await tx
      .update(cuotas_credito)
      .set({ pagado: false })
      .where(and(eq(cuotas_credito.cuota_id, anulada.cuota_id), eq(cuotas_credito.pagado, true)));
  }
}
