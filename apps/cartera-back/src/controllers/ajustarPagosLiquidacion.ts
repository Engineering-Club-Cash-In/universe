// ============================================
// ajustarPagosLiquidacion
// ============================================
//
// Endpoint para corregir manualmente pagos espejo y monto_aportado de un
// inversionista en una liquidación específica. Soporta dry-run cuando algún
// crédito tiene compras del mes en curso registradas en
// compras_credito_inversionista (donde el monto_aportado del espejo es el
// acumulado y no refleja la posición pre-compra).
//
// Para cada cambio:
//   - Actualiza el pago espejo (abono_capital, abono_interes, abono_iva_12)
//     SOLO con los campos no-null del request.
//   - Para monto_aportado, evalúa si el crédito tiene compras del mes y
//     ajusta sumando la compra al valor del endpoint, salvo que se mande
//     monto_aportado_forzado=true (valor literal sin ajuste).
//
// Dry-run global: si algún cambio tiene compra del mes Y el override no está
// activo Y force=false → no aplica nada, devuelve el plan.
//
// Opcional: si generar_reporte=true tras aplicar, genera el Excel con el
// mismo flujo que /investor/reporte-liquidados, filtrando los créditos por
// las compras del mes (excluir si monto<=compra, restar compra si monto>compra).
// Devuelve solo la URL (no actualiza reporte_liquidacion_url en la liquidación).
// ============================================

import Big from "big.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../database/index";
import {
  compras_credito_inversionista,
  creditos_inversionistas_espejo,
  inversionistas,
  liquidaciones,
  pagos_credito_inversionistas_espejo,
} from "../database/db/schema";
import { formatToUSD } from "../utils/functions/currencyConverter";
import { generarYSubirExcelInversionista } from "../utils/functions/generalFunctions";
import { resumeInvestor } from "./investor";

export type AjustarCambio = {
  credito_id: number;
  abono_capital?: number | null;
  abono_interes?: number | null;
  iva?: number | null;
  monto_aportado?: number | null;
  monto_aportado_forzado?: boolean;
};

export type AjustarPagosLiquidacionInput = {
  inversionista_id: number;
  liquidacion_id: number;
  cambios: AjustarCambio[];
  force?: boolean;
  generar_reporte?: boolean;
};

// ============================================
// computarTotalesFiltrados
// ============================================
// Recomputa los totales del inversionista para una liquidación, sobre los
// créditos NO excluidos del reporte y con el monto_aportado ajustado por
// la compra del mes cuando corresponde.
//
// Reglas (decididas con el user):
//   - Créditos en `creditos_excluidos`: no aportan a ningún total.
//   - Créditos en `monto_aportado_ajustado`: aportan todos sus abonos
//     COMPLETOS, solo `total_monto_aportado` usa el monto ajustado.
//
// La lógica de cálculo (sin_reinversion / reinversion_capital / interes /
// total / variable / combinada, ISR sobre interés, IVA, neto) replica
// EXACTAMENTE la de getInvestorTotalsGlobales en investor.ts para que el
// total_reinversion sea comparable contra liquidaciones.reinversion_total.
//
// Devuelve valores RAW en Quetzales (sin conversión a USD).
// ============================================
async function computarTotalesFiltrados(opts: {
  inversionista_id: number;
  liquidacion_id: number;
  creditos_excluidos: Set<number>;
  monto_aportado_ajustado: Map<number, Big>;
}): Promise<{
  total_abono_capital: Big;
  total_abono_interes: Big;
  total_abono_iva: Big;
  total_isr: Big;
  total_cuota_sin_reinversion: Big;
  total_cuota: Big;
  total_monto_aportado: Big;
  total_abono_general_interes: Big;
  total_reinversion: Big;
  total_reinversion_capital: Big;
  total_reinversion_interes: Big;
  pagos_count: number;
  moneda: string;
  emite_factura: boolean;
}> {
  const {
    inversionista_id,
    liquidacion_id,
    creditos_excluidos,
    monto_aportado_ajustado,
  } = opts;

  const [inv] = await db
    .select({
      emite_factura: inversionistas.emite_factura,
      reinversion: inversionistas.tipo_reinversion,
      monto_reinversion: inversionistas.monto_reinversion,
      moneda: inversionistas.moneda,
    })
    .from(inversionistas)
    .where(eq(inversionistas.inversionista_id, inversionista_id))
    .limit(1);

  if (!inv) {
    throw new Error(`Inversionista ${inversionista_id} no encontrado.`);
  }

  const creditosEspejo = await db
    .select({
      credito_id: creditos_inversionistas_espejo.credito_id,
      monto_aportado: creditos_inversionistas_espejo.monto_aportado,
      tipo_reinversion: creditos_inversionistas_espejo.tipo_reinversion,
    })
    .from(creditos_inversionistas_espejo)
    .where(eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id));

  const pagos = await db
    .select({
      credito_id: pagos_credito_inversionistas_espejo.credito_id,
      abono_capital: pagos_credito_inversionistas_espejo.abono_capital,
      abono_interes: pagos_credito_inversionistas_espejo.abono_interes,
      abono_iva_12: pagos_credito_inversionistas_espejo.abono_iva_12,
    })
    .from(pagos_credito_inversionistas_espejo)
    .where(
      and(
        eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionista_id),
        eq(pagos_credito_inversionistas_espejo.liquidacion_id, liquidacion_id),
      ),
    );

  const pagosPorCredito = new Map<number, typeof pagos>();
  for (const p of pagos) {
    const arr = pagosPorCredito.get(p.credito_id) ?? [];
    arr.push(p);
    pagosPorCredito.set(p.credito_id, arr);
  }

  const totales = {
    total_abono_capital: new Big(0),
    total_abono_interes: new Big(0),
    total_abono_iva: new Big(0),
    total_isr: new Big(0),
    total_cuota_sin_reinversion: new Big(0),
    total_cuota: new Big(0),
    total_monto_aportado: new Big(0),
    total_abono_general_interes: new Big(0),
    total_reinversion: new Big(0),
    total_reinversion_capital: new Big(0),
    total_reinversion_interes: new Big(0),
    pagos_count: 0,
  };

  for (const c of creditosEspejo) {
    if (creditos_excluidos.has(c.credito_id)) continue;
    const creditoPagos = pagosPorCredito.get(c.credito_id) ?? [];
    if (creditoPagos.length === 0) continue;

    const montoCredito =
      monto_aportado_ajustado.get(c.credito_id) ?? new Big(c.monto_aportado);
    totales.total_monto_aportado = totales.total_monto_aportado.plus(montoCredito);
    totales.pagos_count += creditoPagos.length;

    for (const pago of creditoPagos) {
      const abono_capital = new Big(pago.abono_capital);
      const abono_interes = new Big(pago.abono_interes);
      const abono_iva = new Big(pago.abono_iva_12).round(2);
      const isr = abono_interes.times(0.07);

      const abonoGeneralInteres = inv.emite_factura
        ? abono_interes.plus(abono_iva)
        : abono_interes.minus(isr);

      let reinversionActual = inv.reinversion;
      if (inv.reinversion === "reinversion_combinada") {
        reinversionActual = c.tipo_reinversion ?? "sin_reinversion";
      }

      const interesTotal = abono_interes.plus(
        inv.emite_factura ? abono_iva : isr.neg(),
      );

      let reinvCapital = new Big(0);
      let reinvInteres = new Big(0);
      let cuota_inversor: Big;

      switch (reinversionActual) {
        case "sin_reinversion":
          cuota_inversor = abono_capital.plus(interesTotal);
          break;
        case "reinversion_capital":
          reinvCapital = abono_capital;
          cuota_inversor = interesTotal;
          break;
        case "reinversion_interes":
          reinvInteres = interesTotal;
          cuota_inversor = abono_capital;
          break;
        case "reinversion_total":
          reinvCapital = abono_capital;
          reinvInteres = interesTotal;
          cuota_inversor = new Big(0);
          break;
        case "reinversion_variable":
          // El ajuste global se aplica después del loop
          cuota_inversor = abono_capital.plus(interesTotal);
          break;
        default:
          cuota_inversor = abono_capital.plus(interesTotal);
      }

      totales.total_abono_capital = totales.total_abono_capital.plus(abono_capital);
      totales.total_abono_interes = totales.total_abono_interes.plus(abono_interes);
      totales.total_abono_iva = totales.total_abono_iva.plus(abono_iva);
      if (!inv.emite_factura) {
        totales.total_isr = totales.total_isr.plus(isr);
      }
      totales.total_cuota = totales.total_cuota.plus(cuota_inversor);
      totales.total_abono_general_interes = totales.total_abono_general_interes.plus(
        abonoGeneralInteres,
      );

      const pagoNeto = abono_capital.plus(interesTotal);
      totales.total_cuota_sin_reinversion =
        totales.total_cuota_sin_reinversion.plus(pagoNeto);

      // Reinversión: NO se vuelve a aplicar ISR aquí. `reinvInteres` ya viene
      // neto desde `interesTotal` (que ya restó ISR cuando no emite_factura).
      // Mismo criterio que getInvestorTotalsGlobales — restar otra vez el 7%
      // dejaría los totales un ~7% por debajo de lo que ve el inversionista
      // en la columna "% Inv. Interés Neto" del Excel.
      totales.total_reinversion = totales.total_reinversion.plus(
        reinvCapital.plus(reinvInteres),
      );
      totales.total_reinversion_capital =
        totales.total_reinversion_capital.plus(reinvCapital);
      totales.total_reinversion_interes =
        totales.total_reinversion_interes.plus(reinvInteres);
    }
  }

  // Ajuste global para reinversion_variable (mismo que getInvestorTotalsGlobales)
  if (inv.reinversion === "reinversion_variable") {
    const montoReinv = new Big(inv.monto_reinversion ?? 0);
    const reinversion = montoReinv.gt(totales.total_cuota)
      ? totales.total_cuota
      : montoReinv;
    totales.total_reinversion = reinversion;
    totales.total_cuota = totales.total_cuota.minus(reinversion);
  }

  return {
    ...totales,
    moneda: inv.moneda ?? "quetzales",
    emite_factura: inv.emite_factura,
  };
}

function getMesEnCursoGuatemala(): { inicio: Date; fin: Date } {
  // Rango [inicio, fin) del mes calendario en zona Guatemala.
  // Se construye en UTC interpretando que Guatemala es UTC-6 sin DST.
  const now = new Date();
  const gtNow = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const y = gtNow.getUTCFullYear();
  const m = gtNow.getUTCMonth();
  const inicio = new Date(Date.UTC(y, m, 1, 6, 0, 0)); // 00:00 GT = 06:00 UTC
  const fin = new Date(Date.UTC(y, m + 1, 1, 6, 0, 0));
  return { inicio, fin };
}

export async function ajustarPagosLiquidacion(input: AjustarPagosLiquidacionInput) {
  const {
    inversionista_id,
    liquidacion_id,
    cambios,
    force = false,
    generar_reporte = false,
  } = input;

  if (cambios.length === 0) {
    return { success: false, message: "El arreglo `cambios` está vacío.", status: 400 as const };
  }

  // ── PASO 1: VALIDAR QUE LA LIQUIDACIÓN PERTENEZCA AL INVERSIONISTA ──
  const [liq] = await db
    .select({ liquidacion_id: liquidaciones.liquidacion_id })
    .from(liquidaciones)
    .where(
      and(
        eq(liquidaciones.liquidacion_id, liquidacion_id),
        eq(liquidaciones.inversionista_id, inversionista_id),
      ),
    )
    .limit(1);

  if (!liq) {
    return {
      success: false,
      message: `Liquidación ${liquidacion_id} no encontrada para inversionista ${inversionista_id}.`,
      status: 404 as const,
    };
  }

  const creditoIds = Array.from(new Set(cambios.map((c) => c.credito_id)));

  // ── PASO 2: TRAER PAGOS ESPEJO ACTUALES ──
  const pagosActuales = await db
    .select({
      id: pagos_credito_inversionistas_espejo.id,
      credito_id: pagos_credito_inversionistas_espejo.credito_id,
      abono_capital: pagos_credito_inversionistas_espejo.abono_capital,
      abono_interes: pagos_credito_inversionistas_espejo.abono_interes,
      abono_iva_12: pagos_credito_inversionistas_espejo.abono_iva_12,
    })
    .from(pagos_credito_inversionistas_espejo)
    .where(
      and(
        eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionista_id),
        eq(pagos_credito_inversionistas_espejo.liquidacion_id, liquidacion_id),
        inArray(pagos_credito_inversionistas_espejo.credito_id, creditoIds),
      ),
    );

  const pagoPorCredito = new Map(pagosActuales.map((p) => [p.credito_id, p]));

  // ── PASO 3: TRAER monto_aportado ACTUAL DEL ESPEJO ──
  const espejoActual = await db
    .select({
      credito_id: creditos_inversionistas_espejo.credito_id,
      monto_aportado: creditos_inversionistas_espejo.monto_aportado,
    })
    .from(creditos_inversionistas_espejo)
    .where(
      and(
        eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
        inArray(creditos_inversionistas_espejo.credito_id, creditoIds),
      ),
    );

  const espejoPorCredito = new Map(
    espejoActual.map((e) => [e.credito_id, new Big(e.monto_aportado)]),
  );

  // ── PASO 4: TRAER COMPRAS DEL MES (todos los status: completado +
  //         pendientes; las canceladas no existen, se borran del histórico) ──
  const { inicio, fin } = getMesEnCursoGuatemala();
  const comprasMes = await db
    .select({
      credito_id: compras_credito_inversionista.credito_id,
      monto_aportado: compras_credito_inversionista.monto_aportado,
    })
    .from(compras_credito_inversionista)
    .where(
      and(
        eq(compras_credito_inversionista.inversionista_id, inversionista_id),
        inArray(compras_credito_inversionista.credito_id, creditoIds),
        sql`${compras_credito_inversionista.fecha} >= ${inicio}`,
        sql`${compras_credito_inversionista.fecha} < ${fin}`,
      ),
    );

  const compraPorCredito = new Map<number, Big>();
  for (const c of comprasMes) {
    const prev = compraPorCredito.get(c.credito_id) ?? new Big(0);
    compraPorCredito.set(c.credito_id, prev.plus(new Big(c.monto_aportado)));
  }

  // ── Filtrar compras CANCELADAS ──
  // Regla del negocio: para saber si una compra fue efectivamente aplicada,
  // el monto_aportado del espejo tiene que ser >= la suma de la compra.
  // Si es MENOR, la compra fue cancelada (la operación nunca se cerró) y
  // se debe ignorar para los efectos del filtro. El crédito entra normal
  // al reporte y la lógica del monto_aportado no debe sumar/restar nada.
  for (const [credId, compraVal] of Array.from(compraPorCredito.entries())) {
    const espejoVal = espejoPorCredito.get(credId);
    if (espejoVal !== undefined && compraVal.gt(espejoVal)) {
      compraPorCredito.delete(credId);
    }
  }

  // ── PASO 5: ARMAR PLAN POR CAMBIO ──
  type PlanItem = {
    credito_id: number;
    error?: string;
    sin_cambios?: boolean;
    pago_espejo_id?: number;
    pago_espejo?: {
      abono_capital?: { actual: string; nuevo: string };
      abono_interes?: { actual: string; nuevo: string };
      abono_iva_12?: { actual: string; nuevo: string };
    };
    monto_aportado?: {
      actual: string;
      compra_mes: string;
      monto_endpoint: string;
      monto_erroneo?: string;
      nuevo: string | null;
      modo:
        | "ajustado_con_compra"
        | "literal_forzado"
        | "literal_sin_compra"
        | "sin_cambio_coincide";
    };
    requiere_dry_run: boolean;
  };

  const plan: PlanItem[] = [];
  let algunRequiereDryRun = false;

  for (const cambio of cambios) {
    const pago = pagoPorCredito.get(cambio.credito_id);
    const espejoMonto = espejoPorCredito.get(cambio.credito_id);

    if (!pago) {
      plan.push({
        credito_id: cambio.credito_id,
        error: `No existe pago espejo para credito ${cambio.credito_id} en la liquidación ${liquidacion_id}.`,
        requiere_dry_run: false,
      });
      continue;
    }

    const item: PlanItem = {
      credito_id: cambio.credito_id,
      pago_espejo_id: pago.id,
      requiere_dry_run: false,
    };

    // Plan del pago espejo (solo campos no-null)
    const pe: NonNullable<PlanItem["pago_espejo"]> = {};
    if (cambio.abono_capital != null) {
      pe.abono_capital = {
        actual: pago.abono_capital,
        nuevo: new Big(cambio.abono_capital).toFixed(10),
      };
    }
    if (cambio.abono_interes != null) {
      pe.abono_interes = {
        actual: pago.abono_interes,
        nuevo: new Big(cambio.abono_interes).toFixed(10),
      };
    }
    if (cambio.iva != null) {
      pe.abono_iva_12 = {
        actual: pago.abono_iva_12,
        nuevo: new Big(cambio.iva).toFixed(2),
      };
    }
    if (Object.keys(pe).length > 0) {
      item.pago_espejo = pe;
    }

    // Plan del monto_aportado
    if (cambio.monto_aportado != null) {
      if (espejoMonto == null) {
        item.error = `No existe creditos_inversionistas_espejo para inversionista ${inversionista_id}, credito ${cambio.credito_id}.`;
        plan.push(item);
        continue;
      }

      const montoEndpoint = new Big(cambio.monto_aportado);
      const compra = compraPorCredito.get(cambio.credito_id) ?? new Big(0);
      const forzado = cambio.monto_aportado_forzado === true;

      if (forzado) {
        item.monto_aportado = {
          actual: espejoMonto.toFixed(8),
          compra_mes: compra.toFixed(8),
          monto_endpoint: montoEndpoint.toFixed(8),
          nuevo: montoEndpoint.toFixed(8),
          modo: "literal_forzado",
        };
      } else if (compra.eq(0)) {
        item.monto_aportado = {
          actual: espejoMonto.toFixed(8),
          compra_mes: "0",
          monto_endpoint: montoEndpoint.toFixed(8),
          nuevo: montoEndpoint.toFixed(8),
          modo: "literal_sin_compra",
        };
      } else {
        const montoErroneo = espejoMonto.minus(compra);
        const diff = montoErroneo.minus(montoEndpoint).abs();
        if (diff.lt(0.01)) {
          item.monto_aportado = {
            actual: espejoMonto.toFixed(8),
            compra_mes: compra.toFixed(8),
            monto_endpoint: montoEndpoint.toFixed(8),
            monto_erroneo: montoErroneo.toFixed(8),
            nuevo: null,
            modo: "sin_cambio_coincide",
          };
        } else {
          const nuevo = montoEndpoint.plus(compra);
          item.monto_aportado = {
            actual: espejoMonto.toFixed(8),
            compra_mes: compra.toFixed(8),
            monto_endpoint: montoEndpoint.toFixed(8),
            monto_erroneo: montoErroneo.toFixed(8),
            nuevo: nuevo.toFixed(8),
            modo: "ajustado_con_compra",
          };
          item.requiere_dry_run = true;
        }
      }
    }

    if (!item.pago_espejo && !item.monto_aportado && !item.error) {
      item.sin_cambios = true;
    }

    if (item.requiere_dry_run) algunRequiereDryRun = true;
    plan.push(item);
  }

  // ── PASO 6: DECIDIR DRY-RUN GLOBAL ──
  // El dry-run NO bloquea la generación del reporte (eso se decide aparte).
  // Solo decide si se aplican los cambios al espejo o no.
  const isDryRun = algunRequiereDryRun && !force;

  // ── PASO 7: APLICAR EN TRANSACCIÓN (si no es dry-run) ──
  if (!isDryRun) {
    await db.transaction(async (tx) => {
      for (const item of plan) {
        if (item.error || item.sin_cambios) continue;

        // Update pago espejo
        if (item.pago_espejo && item.pago_espejo_id != null) {
          const setObj: Record<string, unknown> = { updated_at: new Date() };
          if (item.pago_espejo.abono_capital) {
            setObj.abono_capital = item.pago_espejo.abono_capital.nuevo;
          }
          if (item.pago_espejo.abono_interes) {
            setObj.abono_interes = item.pago_espejo.abono_interes.nuevo;
          }
          if (item.pago_espejo.abono_iva_12) {
            setObj.abono_iva_12 = item.pago_espejo.abono_iva_12.nuevo;
          }
          if (Object.keys(setObj).length > 1) {
            await tx
              .update(pagos_credito_inversionistas_espejo)
              .set(setObj)
              .where(eq(pagos_credito_inversionistas_espejo.id, item.pago_espejo_id));
          }
        }

        // Update monto_aportado en espejo
        if (item.monto_aportado && item.monto_aportado.nuevo != null) {
          await tx
            .update(creditos_inversionistas_espejo)
            .set({
              monto_aportado: item.monto_aportado.nuevo,
              updated_at: new Date(),
            })
            .where(
              and(
                eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
                eq(creditos_inversionistas_espejo.credito_id, item.credito_id),
              ),
            );
        }
      }
    });
  }

  // ── PASO 8: COMPUTAR FILTRO DE COMPRAS DEL MES (siempre) ──
  // Necesario tanto para la comparación de reinversion_total como para el
  // reporte (si se pide). Se hace sobre TODOS los créditos del inversionista
  // en el espejo (no solo los del payload de cambios).
  const todasComprasMes = await db
    .select({
      credito_id: compras_credito_inversionista.credito_id,
      monto_aportado: compras_credito_inversionista.monto_aportado,
    })
    .from(compras_credito_inversionista)
    .where(
      and(
        eq(compras_credito_inversionista.inversionista_id, inversionista_id),
        sql`${compras_credito_inversionista.fecha} >= ${inicio}`,
        sql`${compras_credito_inversionista.fecha} < ${fin}`,
      ),
    );

  const compraTodosPorCredito = new Map<number, Big>();
  for (const c of todasComprasMes) {
    const prev = compraTodosPorCredito.get(c.credito_id) ?? new Big(0);
    compraTodosPorCredito.set(c.credito_id, prev.plus(new Big(c.monto_aportado)));
  }

  // Construir conjuntos de excluidos / ajustados a partir del espejo actual.
  const todosEspejos = await db
    .select({
      credito_id: creditos_inversionistas_espejo.credito_id,
      monto_aportado: creditos_inversionistas_espejo.monto_aportado,
    })
    .from(creditos_inversionistas_espejo)
    .where(
      eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
    );

  const creditos_excluidos_reporte: number[] = [];
  const creditos_ajustados_reporte: {
    credito_id: number;
    monto_original: string;
    monto_ajustado: string;
  }[] = [];
  // Créditos donde detectamos que la compra del mes en realidad fue
  // CANCELADA (monto_espejo < compra). Se reportan para diagnóstico pero
  // no se filtran ni ajustan: el crédito entra normal al reporte.
  const compras_canceladas: {
    credito_id: number;
    espejo_monto: string;
    compra_monto: string;
  }[] = [];
  const ajustadosMap = new Map<number, Big>();

  for (const e of todosEspejos) {
    const compra = compraTodosPorCredito.get(e.credito_id);
    if (!compra || compra.eq(0)) continue;
    const monto = new Big(e.monto_aportado);
    // Compra cancelada: el espejo nunca llegó al monto de la compra,
    // así que la operación nunca se cerró efectivamente. Ignorarla.
    if (monto.lt(compra)) {
      compras_canceladas.push({
        credito_id: e.credito_id,
        espejo_monto: monto.toFixed(2),
        compra_monto: compra.toFixed(2),
      });
      continue;
    }
    if (monto.eq(compra)) {
      creditos_excluidos_reporte.push(e.credito_id);
    } else {
      const ajustado = monto.minus(compra);
      ajustadosMap.set(e.credito_id, ajustado);
      creditos_ajustados_reporte.push({
        credito_id: e.credito_id,
        monto_original: monto.toFixed(2),
        monto_ajustado: ajustado.toFixed(2),
      });
    }
  }

  const excluidosSet = new Set(creditos_excluidos_reporte);

  // ── PASO 9: RECOMPUTAR TOTALES FILTRADOS Y COMPARAR CONTRA LIQUIDACION ──
  // Recomputa todos los totales en RAW Q sobre los créditos del espejo que
  // sobreviven al filtro, con monto_aportado ajustado donde aplica.
  // Para cada campo de `liquidaciones` que dependa de estos totales:
  //   - Si difiere del valor guardado: se incluye en el update (cuando NO
  //     es dry-run) y se reporta en `totales_update`.
  //   - Si no difiere: se ignora (no se sobreescribe innecesariamente).
  const totalesFiltrados = await computarTotalesFiltrados({
    inversionista_id,
    liquidacion_id,
    creditos_excluidos: excluidosSet,
    monto_aportado_ajustado: ajustadosMap,
  });

  const [liqRow] = await db
    .select({
      total_pagos_liquidados: liquidaciones.total_pagos_liquidados,
      total_capital: liquidaciones.total_capital,
      total_interes: liquidaciones.total_interes,
      total_iva: liquidaciones.total_iva,
      total_isr: liquidaciones.total_isr,
      total_cuota: liquidaciones.total_cuota,
      reinversion_capital: liquidaciones.reinversion_capital,
      reinversion_interes: liquidaciones.reinversion_interes,
      reinversion_total: liquidaciones.reinversion_total,
    })
    .from(liquidaciones)
    .where(eq(liquidaciones.liquidacion_id, liquidacion_id))
    .limit(1);

  // total_iva en `liquidaciones` se guarda según emite_factura, igual que
  // hace getInvestorTotalsGlobales al rendear el header del Excel.
  const totalIvaFinal = totalesFiltrados.emite_factura
    ? totalesFiltrados.total_abono_iva
    : totalesFiltrados.total_abono_interes.round(2).times(0.12);

  // Mapeo: campo de liquidaciones → valor recalculado.
  const nuevosValores: Record<string, Big | number> = {
    total_pagos_liquidados: totalesFiltrados.pagos_count,
    total_capital: totalesFiltrados.total_abono_capital.round(2),
    total_interes: totalesFiltrados.total_abono_interes.round(2),
    total_iva: totalIvaFinal.round(2),
    total_isr: totalesFiltrados.total_isr.round(2),
    total_cuota: totalesFiltrados.total_cuota.round(2),
    reinversion_capital: totalesFiltrados.total_reinversion_capital.round(2),
    reinversion_interes: totalesFiltrados.total_reinversion_interes.round(2),
    reinversion_total: totalesFiltrados.total_reinversion.round(2),
  };

  // SIEMPRE reportamos los 9 campos (cambien o no), con anterior/nuevo/diferencia.
  // Eso permite al cliente confirmar que la comparación se hizo y ver que
  // ningún total quedó descalibrado. Solo los que tienen `cambio=true`
  // entran al UPDATE.
  type TotalesUpdateField = {
    anterior: string;
    nuevo: string;
    diferencia: string;
    cambio: boolean;
    aplicado: boolean;
  };

  const totales_update: Record<string, TotalesUpdateField> = {};
  const setObj: Record<string, unknown> = {};
  const previos: Record<string, string | number> = liqRow
    ? {
        total_pagos_liquidados: liqRow.total_pagos_liquidados,
        total_capital: liqRow.total_capital,
        total_interes: liqRow.total_interes,
        total_iva: liqRow.total_iva,
        total_isr: liqRow.total_isr,
        total_cuota: liqRow.total_cuota,
        reinversion_capital: liqRow.reinversion_capital,
        reinversion_interes: liqRow.reinversion_interes,
        reinversion_total: liqRow.reinversion_total,
      }
    : {};

  if (liqRow) {
    for (const [campo, nuevo] of Object.entries(nuevosValores)) {
      if (campo === "total_pagos_liquidados") {
        const ant = Number(previos[campo] ?? 0);
        const nue = Number(nuevo);
        const cambio = ant !== nue;
        totales_update[campo] = {
          anterior: String(ant),
          nuevo: String(nue),
          diferencia: String(nue - ant),
          cambio,
          aplicado: cambio && !isDryRun,
        };
        if (cambio) setObj[campo] = nue;
        continue;
      }
      const ant = new Big(previos[campo] ?? 0);
      const nue = nuevo as Big;
      const diff = nue.minus(ant);
      const cambio = !diff.eq(0);
      totales_update[campo] = {
        anterior: ant.toFixed(2),
        nuevo: nue.toFixed(2),
        diferencia: diff.toFixed(2),
        cambio,
        aplicado: cambio && !isDryRun,
      };
      if (cambio) setObj[campo] = nue.toFixed(2);
    }
  }

  const huboCambiosTotales = Object.keys(setObj).length > 0;
  if (huboCambiosTotales && !isDryRun) {
    await db
      .update(liquidaciones)
      .set(setObj as any)
      .where(eq(liquidaciones.liquidacion_id, liquidacion_id));
  }

  // ── PASO 10: GENERAR REPORTE (OPCIONAL, también en dry-run) ──
  // En dry-run el espejo no se actualizó, así que el reporte refleja el
  // estado actual con el filtro de compras del mes aplicado. Tras force=true
  // refleja el estado post-aplicación.
  let reporte_url: string | null = null;

  if (generar_reporte) {
    try {
      const result = await resumeInvestor(
        inversionista_id,
        1,
        999999,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        "espejos",
        true,
        liquidacion_id,
        undefined,
      );

      if (!result.inversionistas.length) {
        return {
          success: true,
          dry_run: isDryRun,
          message: isDryRun
            ? "Plan en dry-run, no se generó reporte: inversionista sin pagos liquidados."
            : "Cambios aplicados, pero no se generó reporte: inversionista sin pagos liquidados.",
          cambios: plan,
          reporte_url: null,
          creditos_excluidos_reporte,
          creditos_ajustados_reporte,
          compras_canceladas,
          totales_update,
          status: 200 as const,
        };
      }

      const inversionista = result.inversionistas[0] as any;

      // Filtrar / ajustar créditos del Excel
      const ajustadoPorIdStr = new Map(
        creditos_ajustados_reporte.map((c) => [c.credito_id, c.monto_ajustado]),
      );
      const creditosFiltrados: any[] = [];
      for (const c of inversionista.creditos ?? []) {
        if (excluidosSet.has(c.credito_id)) continue;
        const ajustado = ajustadoPorIdStr.get(c.credito_id);
        if (ajustado != null) {
          creditosFiltrados.push({ ...c, monto_aportado: ajustado });
        } else {
          creditosFiltrados.push(c);
        }
      }
      inversionista.creditos = creditosFiltrados;

      // Subtotales consistentes con el filtro. Recomputados en Q y luego
      // convertidos a USD si el inversionista usa esa moneda (para que el
      // Excel los muestre correctamente formateados).
      const esDolares = totalesFiltrados.moneda === "dolares";
      const fmt = (val: Big): number =>
        esDolares
          ? formatToUSD(val.toString(), inversionista_id)
          : Number(val.round(2).toString());

      const totalAbonoIvaShown = totalesFiltrados.emite_factura
        ? totalesFiltrados.total_abono_iva
        : totalesFiltrados.total_abono_interes.round(2).times(0.12);

      inversionista.subtotal = {
        total_abono_capital: fmt(totalesFiltrados.total_abono_capital),
        total_abono_interes: fmt(totalesFiltrados.total_abono_interes),
        total_abono_iva: fmt(totalAbonoIvaShown),
        total_isr: fmt(totalesFiltrados.total_isr),
        total_cuota_sin_reinversion: fmt(totalesFiltrados.total_cuota_sin_reinversion),
        total_cuota_con_reinversion: fmt(totalesFiltrados.total_cuota),
        total_cuota: fmt(totalesFiltrados.total_cuota),
        total_monto_aportado: fmt(totalesFiltrados.total_monto_aportado),
        total_abono_general_interes: fmt(totalesFiltrados.total_abono_general_interes),
        total_reinversion: fmt(totalesFiltrados.total_reinversion),
        total_reinversion_capital: fmt(totalesFiltrados.total_reinversion_capital),
        total_reinversion_interes: fmt(totalesFiltrados.total_reinversion_interes),
      };

      const logoUrl = (import.meta as any).env?.LOGO_URL || "";
      const filename = `ajuste_liquidados_${liquidacion_id}_${Date.now()}.xlsx`;
      const { url } = await generarYSubirExcelInversionista(
        inversionista,
        filename,
        logoUrl,
      );
      reporte_url = url;

      // En modo aplicar (no dry-run), persistir la nueva URL en la
      // liquidación para que `reporte_liquidacion_url` quede sincronizada
      // con el Excel que acabamos de generar.
      if (!isDryRun) {
        await db
          .update(liquidaciones)
          .set({ reporte_liquidacion_url: url })
          .where(eq(liquidaciones.liquidacion_id, liquidacion_id));
      }
    } catch (err) {
      console.error("[ajustarPagosLiquidacion] Error generando reporte:", err);
      reporte_url = null;
    }
  }

  const cambiosAplicables = plan.filter((p) => !p.error && !p.sin_cambios).length;

  return {
    success: true,
    dry_run: isDryRun,
    message: isDryRun
      ? "Dry-run: hay créditos con compra del mes registrada. Revisá el plan y volvé a llamar con force=true (o mandá monto_aportado_forzado=true en los cambios donde corresponda)."
      : `Cambios aplicados a ${cambiosAplicables} crédito(s).`,
    cambios: plan,
    reporte_url,
    creditos_excluidos_reporte,
    creditos_ajustados_reporte,
    compras_canceladas,
    totales_update,
    totales_cambios_count: Object.values(totales_update).filter((t) => t.cambio)
      .length,
    status: 200 as const,
  };
}
