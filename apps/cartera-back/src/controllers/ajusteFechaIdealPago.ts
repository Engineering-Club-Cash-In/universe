import Big from "big.js";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../database";
import {
  ajuste_fecha_ideal_pago,
  cuotas_credito,
  pagos_credito,
} from "../database/db";

type Executor = Pick<typeof db, "select" | "update">;
type AjusteCobrado = { id: number; monto_total: string };
type AjusteParaReconstruccion = AjusteCobrado | { pendiente: true };

export async function prepararAjusteFechaIdealParaReconstruccion(
  credito_id: number,
  executor: Executor = db,
): Promise<AjusteParaReconstruccion | null> {
  const [ajusteCobrado] = await executor
    .select({
      id: ajuste_fecha_ideal_pago.id,
      monto_total: ajuste_fecha_ideal_pago.monto_total,
    })
    .from(ajuste_fecha_ideal_pago)
    .where(
      and(
        eq(ajuste_fecha_ideal_pago.credito_id, credito_id),
        isNotNull(ajuste_fecha_ideal_pago.fecha_cobro),
        isNotNull(ajuste_fecha_ideal_pago.pago_id),
      ),
    )
    .limit(1);

  if (ajusteCobrado) return ajusteCobrado;

  const teniaAjustePendiente = await resetAjusteFechaIdealPorCredito(
    credito_id,
    executor,
  );
  return teniaAjustePendiente ? { pendiente: true } : null;
}

export async function reattachAjusteFechaIdealReconstruido(
  ajuste: AjusteParaReconstruccion | null,
  cuotas: readonly { cuota_id: number; numero_cuota: number }[],
  pagos: readonly {
    pago_id: number;
    cuota_id: number | null;
    otros: string | null;
    monto_boleta?: string | null;
    monto_boleta_cuota?: string | null;
  }[],
  executor: Executor = db,
): Promise<void> {
  if (ajuste === null) return;

  const cuota1Id = cuotas.find((cuota) => cuota.numero_cuota === 1)?.cuota_id;
  if (cuota1Id === undefined) {
    throw new Error("No se pudo reconstruir el pago de la cuota 1");
  }

  if ("pendiente" in ajuste) {
    const [cuotaReabierta] = await executor
      .update(cuotas_credito)
      .set({ pagado: false })
      .where(eq(cuotas_credito.cuota_id, cuota1Id))
      .returning({ cuota_id: cuotas_credito.cuota_id });
    if (!cuotaReabierta) {
      throw new Error("No se pudo reabrir la cuota 1 para cobrar el ajuste");
    }
    return;
  }

  const pagoCuota1 = pagos.find((pago) => pago.cuota_id === cuota1Id);
  if (!pagoCuota1) {
    throw new Error("No se pudo reconstruir el pago de la cuota 1");
  }

  const [ajusteActualizado] = await executor
    .update(ajuste_fecha_ideal_pago)
    .set({ pago_id: pagoCuota1.pago_id })
    .where(
      and(
        eq(ajuste_fecha_ideal_pago.id, ajuste.id),
        isNotNull(ajuste_fecha_ideal_pago.fecha_cobro),
        isNull(ajuste_fecha_ideal_pago.pago_id),
      ),
    )
    .returning({ id: ajuste_fecha_ideal_pago.id });

  if (!ajusteActualizado) {
    throw new Error(`No se pudo reenlazar el ajuste ${ajuste.id}`);
  }

  const montoTotal = new Big(ajuste.monto_total);
  const [pagoActualizado] = await executor
    .update(pagos_credito)
    .set({
      otros: new Big(pagoCuota1.otros || 0).plus(montoTotal).toString(),
      ...(pagoCuota1.monto_boleta != null
        ? {
            monto_boleta: new Big(pagoCuota1.monto_boleta)
              .plus(montoTotal)
              .toString(),
          }
        : {}),
      ...(pagoCuota1.monto_boleta_cuota != null
        ? {
            monto_boleta_cuota: new Big(pagoCuota1.monto_boleta_cuota)
              .plus(montoTotal)
              .toString(),
          }
        : {}),
    })
    .where(eq(pagos_credito.pago_id, pagoCuota1.pago_id))
    .returning({ pago_id: pagos_credito.pago_id });

  if (!pagoActualizado) {
    throw new Error(`No se pudo aplicar el ajuste ${ajuste.id} al pago`);
  }
}

/**
 * Si pago_id es el que cobró un ajuste por fecha ideal de pago (ver
 * insertPayment en registerPayment.ts), lo resetea a pendiente
 * (fecha_cobro/pago_id = NULL). Se debe llamar en TODO lugar que invalide un
 * pago ya aplicado — reversión, boleta falsa, anulación por incobrable, etc.
 * Sin esto el dinero queda "cobrado" para siempre apuntando a un pago que en
 * realidad nunca entró, y nadie lo vuelve a cobrar.
 *
 * Devuelve true si pago_id SÍ era el que cobraba un ajuste (se reseteó). El
 * caller lo necesita: si el pago que se invalida era justo ese, la cuota 1
 * puede quedar "cerrada" igual porque el monto contractual por su cuenta
 * sigue cubierto (shouldInstallmentRemainPaidAfterReversal no sabe nada del
 * ajuste) — hay que forzar la reapertura aparte, ver reversePayment.ts y
 * payments.ts (falsePayment).
 *
 * No-op silencioso (retorna false) si pago_id no cobró ningún ajuste (caso normal).
 */
export async function resetAjusteFechaIdealSiPagoInvalidado(
  pago_id: number,
  executor: Executor = db
): Promise<boolean> {
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

  return reseteado.length > 0;
}

/**
 * Igual que resetAjusteFechaIdealSiPagoInvalidado pero buscando por crédito.
 * Para los flujos que BORRAN el pago que cobró el ajuste en vez de marcarlo
 * inválido (marcarCreditoComoCaido): ahí el pago_id ya no sirve de llave —
 * el ON DELETE SET NULL del FK lo dejó en NULL y fecha_cobro se quedaría
 * marcada para siempre sin ningún pago detrás. Hay a lo sumo 1 fila por
 * crédito (uq_ajuste_fecha_ideal_pago_credito), así que credito_id basta.
 *
 * No-op silencioso si el crédito no tiene ajuste (caso normal).
 */
export async function resetAjusteFechaIdealPorCredito(
  credito_id: number,
  executor: Executor = db
): Promise<boolean> {
  const reseteado = await executor
    .update(ajuste_fecha_ideal_pago)
    .set({ fecha_cobro: null, pago_id: null })
    .where(eq(ajuste_fecha_ideal_pago.credito_id, credito_id))
    .returning({ id: ajuste_fecha_ideal_pago.id });

  if (reseteado.length > 0) {
    console.log(
      `🧾 Ajuste por fecha ideal de pago #${reseteado[0].id} reseteado a pendiente (crédito ${credito_id}: se borraron sus pagos).`
    );
  }
  return reseteado.length > 0;
}

export type AjusteReimportAction =
  | { kind: "ninguna" }
  | { kind: "reenganchar"; ajusteId: number; montoTotal: string }
  | { kind: "ya_reenganchado"; montoTotal: string }
  | { kind: "reabrir" };

export function debeRestaurarTotalesBoletaAjuste({
  accion,
  pagoCuota1Id,
  pagosActualizados,
}: {
  accion: AjusteReimportAction;
  pagoCuota1Id: number | null;
  pagosActualizados: readonly number[];
}): boolean {
  return (
    accion.kind === "ya_reenganchado" &&
    pagoCuota1Id != null &&
    pagosActualizados.includes(pagoCuota1Id)
  );
}

/**
 * Elige una sola fila por cuota de forma determinista. Para cuota 1 siempre
 * conserva el pago que ya respalda el ajuste; moverlo a otra fila copiaría el
 * monto sin retirarlo de la original. Sin vínculo, usa el pago_id más reciente.
 */
export function seleccionarPagosCanonicosPorCuota<
  T extends { cuota_id: number; numero_cuota: number; pago_id: number | null },
>(rows: readonly T[], pagoAjusteId: number | null | undefined): T[] {
  const porCuota = new Map<number, T>();
  for (const row of rows) {
    const actual = porCuota.get(row.cuota_id);
    if (!actual) {
      porCuota.set(row.cuota_id, row);
      continue;
    }
    const rowEsVinculado =
      row.numero_cuota === 1 && row.pago_id === pagoAjusteId;
    const actualEsVinculado =
      actual.numero_cuota === 1 && actual.pago_id === pagoAjusteId;
    if (
      rowEsVinculado ||
      (!actualEsVinculado && (row.pago_id ?? -1) > (actual.pago_id ?? -1))
    ) {
      porCuota.set(row.cuota_id, row);
    }
  }
  return [...porCuota.values()].sort(
    (a, b) => a.numero_cuota - b.numero_cuota,
  );
}

/**
 * Qué hacer con el ajuste cuando una reconstrucción de historial (Excel/SIFCO
 * — marcarCuotasPagadasHastaNumero y sus 5 llamadores) marca la cuota 1 como
 * pagada. Esos flujos no pasan por insertPayment, así que no tienen ninguna
 * noción del ajuste por su cuenta.
 *
 * Se decide con el ÚNICO dato real que tenemos — el estado del ajuste ANTES
 * de que la reconstrucción lo toque — en vez de asumir que sí o que no se
 * cobró:
 * - Si ya tenía fecha_cobro (un pago real, por insertPayment, lo había
 *   cobrado antes) → es un hecho: se reengancha a la fila reconstruida.
 * - Si nunca se cobró → también es un hecho: no hay evidencia de que haya
 *   entrado, así que la cuota 1 se reabre en vez de darla por buena.
 */
export function decidirAjusteAlReconstruirCuota1({
  hastaCuota,
  ajustePrevio,
  pagoCuota1Id,
}: {
  hastaCuota: number;
  ajustePrevio: {
    id: number;
    montoTotal: string;
    fechaCobro: Date | string | null;
    pagoId?: number | null;
  } | null;
  pagoCuota1Id?: number | null;
}): AjusteReimportAction {
  if (hastaCuota < 1 || !ajustePrevio) return { kind: "ninguna" };
  if (ajustePrevio.fechaCobro != null) {
    // Idempotencia: processFromExcelFull puede haber reenlazado el ajuste a
    // esta misma fila dentro de su transacción antes de llamar al marcador
    // SIFCO. No se debe volver a sumar monto_total en `otros`.
    if (
      ajustePrevio.pagoId != null &&
      pagoCuota1Id != null &&
      ajustePrevio.pagoId === pagoCuota1Id
    ) {
      return { kind: "ya_reenganchado", montoTotal: ajustePrevio.montoTotal };
    }
    return {
      kind: "reenganchar",
      ajusteId: ajustePrevio.id,
      montoTotal: ajustePrevio.montoTotal,
    };
  }
  return { kind: "reabrir" };
}
