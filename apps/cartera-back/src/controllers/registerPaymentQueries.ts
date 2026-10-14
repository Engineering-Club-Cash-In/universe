import { and, asc, eq, gt, notInArray, or } from "drizzle-orm";
import type { db } from "../database/index";
import { cuotas_credito, pagos_credito } from "../database/db";

/**
 * Condición `where` de "la última cuota realmente pagada" de un crédito, para
 * el join `cuotas_credito ⟕ pagos_credito`. Su `fecha_vencimiento` es el ancla
 * con la que `insertPayment` decide si el crédito está al día — y con eso, si
 * abre la compuerta del abono directo a capital sin `permite_abono_capital`.
 *
 * Exige que la fila del pago haya aplicado plata A LA CUOTA — `monto_aplicado`,
 * `abono_capital` o `abono_interes` — y que no sea un abono directo a capital.
 * Eso deja fuera las tres clases de fila que dicen `pagado = true` sin que
 * nadie haya pagado la cuota:
 *
 * 1. Filas históricas de import con `pagado = true` y todo en cero.
 * 2. Los recibos especiales de solo mora / solo otros, que se guardan con
 *    `pagado = true` y `monto_aplicado = 0` sobre una cuota que sigue ABIERTA y
 *    puede vencer a futuro (ver `updateCredit.ts`, el where de
 *    `recalcularPagosCredito`).
 * 3. Los abonos directos a capital, que sí llevan plata pero no pagan cuota.
 *
 * ⚠️ NO agregar `monto_boleta` al `or`: no es plata aplicada a esta cuota, es
 * el total de la boleta, que `insertPayment` estampa IGUAL en todas las filas
 * que crea — incluidos esos recibos especiales, que entonces volverían a pasar.
 *
 * ⚠️ NO usar `cuotas_credito.pagado`: esa columna NO la escribe `insertPayment`,
 * solo la vía de validación de conta (`aplicarPagoAlCredito`,
 * `aplicarMontoAPago`, `revalidatePayment`). Exigirla haría que la cuota recién
 * pagada en ESTE mismo request no cuente, y el crédito se leería moroso hasta
 * que conta valide — días después.
 *
 * Las tres columnas son nullable en la base real — incluida `monto_aplicado`,
 * que el schema de Drizzle declara `.notNull()` pero que en prod tiene miles de
 * filas en NULL. No importa: `col > 0` da NULL en esas filas y un `or` de NULLs
 * no es TRUE, así que la fila queda fuera, que es justo lo que se quiere. Por
 * eso tampoco hace falta `coalesce`.
 *
 * No se incluyen los otros buckets de plata (`abono_seguro`, `abono_gps`,
 * `abono_iva_12`, `membresias_pago`): barrido en prod 16-sep-2026, ampliar el
 * `or` con los cuatro no cambia el ancla de NINGUNO de los 1,699 créditos.
 */
export const condicionUltimaCuotaPagada = (credito_id: number) =>
  and(
    eq(cuotas_credito.credito_id, credito_id),
    gt(cuotas_credito.numero_cuota, 0),
    eq(pagos_credito.pagado, true),
    // Un abono directo a capital NO es pago de cuota — lo dice el propio
    // `registerPayment.ts` al elegir `capital_validated` justamente para que
    // "quede fuera de la lógica de cuota". Pero su fila se escribe con
    // `pagado = true` y `monto_aplicado`/`abono_capital` positivos, así que sin
    // esta exclusión pasaría el filtro de plata: una cuota futura donde quedó
    // mal anclado un abono viejo seguiría contando como pagada y el defecto se
    // reproduciría solo. `reset` NO se excluye: es una cancelación con plata
    // real (sacarlo mueve el ancla de 66 créditos).
    //
    // El `notInArray` va sin guarda de NULL a propósito: `validation_status` es
    // NOT NULL con default `no_required` en prod y en DEV (0 filas NULL en las
    // dos), y el schema la declara `.notNull()`. Si eso cambiara habría que
    // envolverlo en `or(isNull(...), ...)`, porque `NULL NOT IN (...)` es NULL
    // y la fila se caería del ancla.
    //
    // ⚠️ DEV no tiene `capital_validated` en el enum: falta aplicar la
    // migración 0012 allá, y sin ella esta consulta revienta.
    notInArray(pagos_credito.validationStatus, ["capital", "capital_validated"]),
    or(
      gt(pagos_credito.monto_aplicado, "0"),
      gt(pagos_credito.abono_capital, "0"),
      gt(pagos_credito.abono_interes, "0")
    )
  );

/**
 * Las filas de la cuota entre las que `insertPayment` elige el saldo vigente y el destino del
 * cierre (`pagoOriginal`, `allExistingPagos[0]`). Una fila ANULADA (`paymentFalse = true`) nunca
 * entra, sea `pending`, `validated` o `no_required`: sus restantes son los de después de un pago
 * que ya no existe, y el cierre no puede sobrescribirla (crédito 9331, cuota 2).
 */
export const pagosExistentesDeCuota = (
  executor: typeof db,
  cuotaId: number,
  creditoId: number,
) =>
  executor
    .select({ pago: pagos_credito })
    .from(pagos_credito)
    .innerJoin(cuotas_credito, eq(pagos_credito.cuota_id, cuotas_credito.cuota_id))
    .where(
      and(
        eq(pagos_credito.cuota_id, cuotaId),
        eq(pagos_credito.credito_id, creditoId),
        eq(pagos_credito.paymentFalse, false),
        or(
          // Los `pending` entran solo si siguen sin pagar (los pagados ya pasaron por /aplicar-pago).
          notInArray(pagos_credito.validationStatus, ["pending"]),
          eq(pagos_credito.pagado, false),
        ),
      ),
    )
    .orderBy(asc(pagos_credito.pago_id));

/**
 * ¿Queda alguna fila VIVA en la cuota, del estado que sea? Incluye las `pending` ya pagadas que
 * `pagosExistentesDeCuota` deja afuera: una cuota que cerró un pago aún sin validar NO está
 * huérfana, y no puede volver a cargarse desde la semilla anulada (crédito 459, cuota 4).
 */
export const hayFilaVivaEnCuota = async (
  executor: typeof db,
  cuotaId: number,
  creditoId: number,
) => {
  const [fila] = await executor
    .select({ pagoId: pagos_credito.pago_id })
    .from(pagos_credito)
    .where(
      and(
        eq(pagos_credito.cuota_id, cuotaId),
        eq(pagos_credito.credito_id, creditoId),
        eq(pagos_credito.paymentFalse, false),
      ),
    )
    .limit(1);
  return fila !== undefined;
};

/**
 * La semilla `no_required` ANULADA más vieja de la cuota (menor `pago_id`), o `undefined`.
 * Solo para `saldoDeRespaldoDeSemillaAnulada`: nunca se usa como destino del cierre.
 */
export const semillaAnuladaDeCuota = async (
  executor: typeof db,
  cuotaId: number,
  creditoId: number,
) => {
  const [fila] = await executor
    .select({ pago: pagos_credito })
    .from(pagos_credito)
    .where(
      and(
        eq(pagos_credito.cuota_id, cuotaId),
        eq(pagos_credito.credito_id, creditoId),
        eq(pagos_credito.paymentFalse, true),
        eq(pagos_credito.validationStatus, "no_required"),
      ),
    )
    .orderBy(asc(pagos_credito.pago_id))
    .limit(1);
  return fila?.pago;
};
