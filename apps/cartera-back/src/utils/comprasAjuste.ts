import { db } from "../database/index";
import { compras_credito_inversionista } from "../database/db/schema";
import { and, eq, desc, gte, inArray, lt } from "drizzle-orm";
import Big from "big.js";

export interface AjusteCompras {
  /** Restar del espejo antes de comparar con histórico (compras post-historico). */
  montoRestarValidacion: Big;
  /** Restar de la base de cálculo de intereses (Casos 2 y 3). */
  montoRestarCalculo: Big;
}

/**
 * Calcula los ajustes de compras de cartera para un inversionista+crédito.
 *
 * montoRestarValidacion: compras cuyo created_at es POSTERIOR al último histórico;
 *   addInvestorToCredit ya actualizó el espejo pero el histórico aún no las refleja.
 *
 * montoRestarCalculo: Caso 2 (pendientes) y Caso 3 (completadas en el período o después);
 *   reducen la base sobre la que se calcula el interés.
 *   Si periodoMes/periodoAnio no se proveen, montoRestarCalculo queda en 0.
 */
export async function calcularAjusteCompras(
  credito_id: number,
  inversionista_id: number,
  lastHistoricoFecha: Date | null,
  periodoMes?: number,
  periodoAnio?: number,
): Promise<AjusteCompras> {
  const compras = await db
    .select({
      monto_aportado: compras_credito_inversionista.monto_aportado,
      status: compras_credito_inversionista.status,
      updated_at: compras_credito_inversionista.updated_at,
      created_at: compras_credito_inversionista.created_at,
    })
    .from(compras_credito_inversionista)
    .where(
      and(
        eq(compras_credito_inversionista.credito_id, credito_id),
        eq(compras_credito_inversionista.inversionista_id, inversionista_id),
        inArray(compras_credito_inversionista.tipo_operacion, ["compra_cartera"]), // Hay que volver a ponerlo para que acepte reinversiones
      ),
    )
    .orderBy(desc(compras_credito_inversionista.updated_at));

  let montoRestarValidacion = new Big(0);
  let montoRestarCalculo = new Big(0);

  for (const compra of compras) {
    const montoCompra = new Big(compra.monto_aportado);
    if (montoCompra.eq(0)) continue;

    // Validación: compras creadas después del histórico ya actualizaron el espejo
    // pero el histórico no las refleja — restar para que la comparación sea justa.
    const createdAt = compra.created_at ? new Date(compra.created_at) : null;
    if (lastHistoricoFecha && createdAt && createdAt > lastHistoricoFecha) {
      montoRestarValidacion = montoRestarValidacion.plus(montoCompra);
    }

    if (periodoMes === undefined || periodoAnio === undefined) continue;

    const esPendiente =
      compra.status === "pendiente_revision" ||
      compra.status === "pendiente_compra_cartera" ||
      compra.status === "pendiente_reinversion";

    if (esPendiente) {
      // Caso 2: pendiente → restar de cálculo
      montoRestarCalculo = montoRestarCalculo.plus(montoCompra);
    } else if (compra.status === "completado" && compra.updated_at) {
      const updatedAt = new Date(compra.updated_at);
      const esDelPeriodoODespues =
        updatedAt.getFullYear() > periodoAnio ||
        (updatedAt.getFullYear() === periodoAnio && updatedAt.getMonth() >= periodoMes);

      if (esDelPeriodoODespues) {
        // Caso 3: completada en el período o después → restar de cálculo
        montoRestarCalculo = montoRestarCalculo.plus(montoCompra);
        // Caso 1: completada antes del período → cálculo usa monto completo (no restar)
      }
    }
  }

  return { montoRestarValidacion, montoRestarCalculo };
}

/**
 * Suma los monto_aportado de las compras de cartera (tipo_operacion = 'compra_cartera',
 * status = 'completado') que el inversionista hizo sobre el crédito durante el
 * MES ANTERIOR a `fechaPeriodo`, filtradas por `updated_at`.
 *
 * Excluye reinversiones y compras pendientes — solo cuentan las compras nuevas
 * de cartera ya completadas que se sumaron al monto_aportado del espejo durante
 * ese mes. Sirve para separar la parte "vieja" del monto (interés mensual completo)
 * de la parte aportada por estas compras (interés proporcional).
 */
export async function obtenerSumaComprasMesAnterior(
  credito_id: number,
  inversionista_id: number,
  fechaPeriodo: Date,
): Promise<Big> {
  const mes = fechaPeriodo.getMonth();
  const anio = fechaPeriodo.getFullYear();
  const mesAnterior = mes === 0 ? 11 : mes - 1;
  const anioMesAnterior = mes === 0 ? anio - 1 : anio;

  const inicioMesAnterior = new Date(anioMesAnterior, mesAnterior, 1);
  const inicioMesActual = new Date(anio, mes, 1);

  const compras = await db
    .select({ monto_aportado: compras_credito_inversionista.monto_aportado })
    .from(compras_credito_inversionista)
    .where(
      and(
        eq(compras_credito_inversionista.credito_id, credito_id),
        eq(compras_credito_inversionista.inversionista_id, inversionista_id),
        eq(compras_credito_inversionista.tipo_operacion, "compra_cartera"),
        eq(compras_credito_inversionista.status, "completado"),
        gte(compras_credito_inversionista.updated_at, inicioMesAnterior),
        lt(compras_credito_inversionista.updated_at, inicioMesActual),
      ),
    );

  return compras.reduce(
    (acc, c) => acc.plus(new Big(c.monto_aportado ?? 0)),
    new Big(0),
  );
}
