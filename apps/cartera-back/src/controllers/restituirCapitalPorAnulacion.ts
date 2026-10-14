import { and, asc, eq } from "drizzle-orm";
import type { db } from "../database/index";
import {
  abonos_capital,
  creditos,
  creditos_inversionistas,
  pagos_credito_inversionistas,
} from "../database/db/schema";
import { planRestitucionCapital } from "./restitucionCapitalPorAnulacionPolicy";
import { AnulacionCapitalNoRestituibleError } from "./restitucionCapitalError";

/**
 * Devuelve al crédito y a sus inversionistas el capital que bajó el pago que se está anulando
 * (lo que escribió la validación: `recomputeCreditAfterCapital` + `processAndReplaceCreditInvestors`
 * + PCI, y `abonos_capital` en el abono directo). La decisión es de `planRestitucionCapital`.
 *
 * Corre DENTRO de la transacción de `anularPagoYRestituirMora`, justo después de `reabrirCuota`
 * (que evalúa con el capital de ANTES de reponer). `credito` y `pago` son las filas que esa
 * transacción ya candó. Orden de candados: creditos → pagos_credito → cuotas_credito →
 * creditos_inversionistas → pagos_credito_inversionistas → abonos_capital (el de la validación).
 * Un rechazo tira 409 y aborta la anulación entera.
 */
export async function restituirCapitalPorAnulacion(
  tx: typeof db,
  {
    pago_id,
    credito_id,
    credito,
    pago,
  }: {
    pago_id: number;
    credito_id: number;
    credito: Parameters<typeof planRestitucionCapital>[0]["credito"];
    pago: Parameters<typeof planRestitucionCapital>[0]["pago"];
  },
): Promise<void> {
  const roster = await tx
    .select({
      id: creditos_inversionistas.id,
      inversionista_id: creditos_inversionistas.inversionista_id,
      monto_aportado: creditos_inversionistas.monto_aportado,
      porcentaje_participacion_inversionista: creditos_inversionistas.porcentaje_participacion_inversionista,
      porcentaje_cash_in: creditos_inversionistas.porcentaje_cash_in,
    })
    .from(creditos_inversionistas)
    .where(eq(creditos_inversionistas.credito_id, credito_id))
    .orderBy(asc(creditos_inversionistas.id))
    .for("update");
  const filasPci = await tx
    .select({
      inversionista_id: pagos_credito_inversionistas.inversionista_id,
      abono_capital: pagos_credito_inversionistas.abono_capital,
      estado_liquidacion: pagos_credito_inversionistas.estado_liquidacion,
      liquidacion_id: pagos_credito_inversionistas.liquidacion_id,
    })
    .from(pagos_credito_inversionistas)
    .where(and(eq(pagos_credito_inversionistas.pago_id, pago_id), eq(pagos_credito_inversionistas.credito_id, credito_id)))
    .orderBy(asc(pagos_credito_inversionistas.id))
    .for("update");
  const abonosCapital = await tx
    .select({ liquidado: abonos_capital.liquidado, pago_espejo_id: abonos_capital.pago_espejo_id })
    .from(abonos_capital)
    .where(eq(abonos_capital.pago_id, pago_id))
    .orderBy(asc(abonos_capital.abono_id))
    .for("update");

  const plan = planRestitucionCapital({ pago, credito, filasPci, roster, abonosCapital });
  if (plan.tipo === "SIN_CAPITAL") return;
  if (plan.tipo === "RECHAZAR") throw new AnulacionCapitalNoRestituibleError(plan.codigo);

  // Por `import()`: los dos arrastran `../database` (mismo cuidado que en `anularPagoMora.ts`).
  const { setCapitalSource } = await import("../utils/withAuditContext");
  await setCapitalSource(tx, "ANULACION", null, `Anulación del pago ${pago_id}`);
  await tx
    .update(creditos)
    .set({
      capital: plan.credito.capital,
      cuota_interes: plan.credito.cuotaInteres,
      iva_12: plan.credito.iva,
      deudatotal: plan.credito.deudaTotal,
    })
    .where(eq(creditos.credito_id, credito_id));
  for (const { id, inversionista_id: _, ...montos } of plan.inversionistas) {
    await tx.update(creditos_inversionistas).set(montos).where(eq(creditos_inversionistas.id, id));
  }
  await tx
    .delete(pagos_credito_inversionistas)
    .where(and(eq(pagos_credito_inversionistas.pago_id, pago_id), eq(pagos_credito_inversionistas.credito_id, credito_id)));
  if (plan.borrarAbonosCapital) {
    const { revertirAbonoCapitalEspejo } = await import("./abonosCapital");
    await revertirAbonoCapitalEspejo(pago_id, tx);
  }
}
