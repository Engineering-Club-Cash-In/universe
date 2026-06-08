/**
 * actualizarPagosExcel
 * ------------------------------------------------------------------
 * Endpoint de producción: recibe un array de créditos (numero SIFCO), baja el
 * Excel de cartera desde R2 (con caché) y actualiza los PAGOS ya pagados de
 * cada crédito con los valores del Excel.
 *
 * Reglas (acordadas con Daniel):
 *  - Solo se tocan cuotas PAGADAS (cuota.pagado = true, numero_cuota > 0).
 *  - NO se toca el crédito (capital, cuota, etc.) — eso es de conta.
 *  - Match por FECHA DE VENCIMIENTO: cuota.fecha_vencimiento (DB) ↔ "Pago" (Excel).
 *    El número de cuota del Excel está desfasado, por eso no se usa.
 *  - Campos que se escriben por pago:
 *      abono_capital/interes/iva_12/interes_ci/iva_ci/seguro/gps, membresias(_pago),
 *      pago_del_mes, mora, otros.
 *      capital_restante = total_restante = "Total restante" del Excel.
 *      interes_restante = iva_12_restante = seguro_restante = gps_restante = 0.
 *      pagado = true.
 *  - Caso normal (1 pago/cuota): se escriben los totales del Excel directo.
 *  - Caso parcial (≥2 pagos/cuota): se reparte cada monto_aplicado en cascada
 *    (interés → IVA → seguro → GPS → membresías → capital) sembrando los totales
 *    del Excel, igual que repararTotalRestante.
 *
 * Atomicidad: se valida TODO primero. Si algún crédito/cuota no matchea en el
 * Excel (o hay error), NO se escribe nada y se devuelve el detalle. Si todo
 * está OK, se aplican todos los updates en UNA sola transacción.
 */
import { Elysia, t } from "elysia";
import { and, asc, eq, ne } from "drizzle-orm";
import Big from "big.js";
import { db } from "../database";
import { creditos, cuotas_credito, pagos_credito } from "../database/db";
import { authMiddleware } from "./midleware";
import {
  descargarCarteraDeR2,
  leerPagosCarteraPorVencimiento,
  aISO,
  type PagoCarteraExcel,
} from "../services/carteraExcelR2";

const Q = (n: Big | number | string) => new Big(n).round(2).toString();

type Update = { pago_id: number; datos: Record<string, unknown> };

/**
 * Construye los updates de una cuota pagada a partir de su fila de Excel.
 * - 1 pago  → valores del Excel directo.
 * - N pagos → cascada del monto_aplicado sobre los totales del Excel.
 */
function construirUpdatesCuota(
  excel: PagoCarteraExcel,
  pagos: Array<{ pago_id: number; monto_aplicado: any; fecha_pago: any }>,
): Update[] {
  const totalRestante = Q(excel.total_restante);
  const restantesEnCero = {
    interes_restante: "0",
    iva_12_restante: "0",
    seguro_restante: "0",
    gps_restante: "0",
    capital_restante: totalRestante,
    total_restante: totalRestante,
  };

  // Suma de abonos = monto realmente aplicado a la cuota (capital + interés +
  // IVA + seguro + GPS + membresías).
  const sumaAbonos = new Big(excel.abono_capital)
    .plus(excel.abono_interes)
    .plus(excel.abono_iva_12)
    .plus(excel.abono_seguro)
    .plus(excel.abono_gps)
    .plus(excel.membresias_pago);

  // Monto de la cuota: el del Excel si viene; si no (hojas viejas vacías), la
  // suma de abonos. NO se toca creditos.cuota (eso es de conta).
  const cuotaMonto = excel.cuota > 0 ? new Big(excel.cuota) : sumaAbonos;

  // ── Caso normal: un solo pago ─────────────────────────────────────────────
  if (pagos.length === 1) {
    return [
      {
        pago_id: pagos[0].pago_id,
        datos: {
          cuota: Q(cuotaMonto),
          monto_aplicado: Q(sumaAbonos),
          abono_capital: Q(excel.abono_capital),
          abono_interes: Q(excel.abono_interes),
          abono_iva_12: Q(excel.abono_iva_12),
          abono_interes_ci: Q(excel.abono_interes_ci),
          abono_iva_ci: Q(excel.abono_iva_ci),
          abono_seguro: Q(excel.abono_seguro),
          abono_gps: Q(excel.abono_gps),
          membresias: Q(excel.membresias),
          membresias_pago: Q(excel.membresias_pago),
          membresias_mes: Q(excel.membresias_pago),
          pago_del_mes: Q(excel.pago_del_mes),
          mora: Q(excel.mora),
          otros: Q(excel.otros),
          ...restantesEnCero,
          pagado: true,
        },
      },
    ];
  }

  // ── Caso parcial: cascada sobre los totales del Excel ─────────────────────
  let rem = {
    interes: new Big(excel.abono_interes),
    iva: new Big(excel.abono_iva_12),
    seguro: new Big(excel.abono_seguro),
    gps: new Big(excel.abono_gps),
    membresias: new Big(excel.membresias_pago),
    capital: new Big(excel.abono_capital),
  };
  const totalInteres = new Big(excel.abono_interes);
  const totalIva = new Big(excel.abono_iva_12);

  const ordenados = [...pagos].sort((a, b) => {
    const fa = a.fecha_pago ? new Date(a.fecha_pago).getTime() : 0;
    const fb = b.fecha_pago ? new Date(b.fecha_pago).getTime() : 0;
    if (fa !== fb) return fa - fb;
    return a.pago_id - b.pago_id;
  });

  const updates: Update[] = [];
  const ultimoIdx = ordenados.length - 1;

  ordenados.forEach((pago, i) => {
    const esUltimo = i === ultimoIdx;
    let disp = new Big(pago.monto_aplicado ?? 0);

    const tomar = (campo: keyof typeof rem) => {
      const v = disp.gte(rem[campo]) ? rem[campo] : disp;
      disp = disp.minus(v);
      rem[campo] = rem[campo].minus(v);
      return v;
    };

    const aInteres = tomar("interes");
    const aIva = tomar("iva");
    const aSeguro = tomar("seguro");
    const aGps = tomar("gps");
    const aMemb = tomar("membresias");
    const aCapital = tomar("capital");
    const pagoMes = aInteres.plus(aIva).plus(aSeguro).plus(aGps).plus(aMemb).plus(aCapital);

    // CI proporcional a la fracción de interés/IVA que cubrió este pago.
    const aIntCI = totalInteres.gt(0)
      ? new Big(excel.abono_interes_ci).times(aInteres).div(totalInteres)
      : new Big(0);
    const aIvaCI = totalIva.gt(0)
      ? new Big(excel.abono_iva_ci).times(aIva).div(totalIva)
      : new Big(0);

    updates.push({
      pago_id: pago.pago_id,
      datos: {
        cuota: Q(cuotaMonto),
        monto_aplicado: Q(pagoMes),
        abono_capital: Q(aCapital),
        abono_interes: Q(aInteres),
        abono_iva_12: Q(aIva),
        abono_interes_ci: Q(aIntCI),
        abono_iva_ci: Q(aIvaCI),
        abono_seguro: Q(aSeguro),
        abono_gps: Q(aGps),
        membresias: Q(aMemb),
        membresias_pago: Q(aMemb),
        membresias_mes: Q(aMemb),
        pago_del_mes: Q(pagoMes),
        // mora/otros van solo en el último pago para no duplicar el total.
        mora: esUltimo ? Q(excel.mora) : "0",
        otros: esUltimo ? Q(excel.otros) : "0",
        // restantes individuales = snapshot tras este pago (trail histórico).
        interes_restante: Q(rem.interes),
        iva_12_restante: Q(rem.iva),
        seguro_restante: Q(rem.seguro),
        gps_restante: Q(rem.gps),
        // capital/total restante = saldo del crédito (igual en toda la cuota).
        capital_restante: totalRestante,
        total_restante: totalRestante,
        pagado: esUltimo,
      },
    });
  });

  return updates;
}

export const actualizarPagosExcelRouter = new Elysia()
  .use(authMiddleware)
  .post(
    "/actualizar-pagos-excel",
    async ({ body, set }: any) => {
      const {
        creditos: lista,
        excel_key,
        force_refresh = false,
        dry_run = true,
        orden_cronologico = [],
        omitir_sin_match = true,
      } = body ?? {};

      if (!Array.isArray(lista) || lista.length === 0) {
        set.status = 400;
        return { success: false, error: "Debe enviar un array 'creditos' con números SIFCO" };
      }

      // Bases (14 díg) que se matchean por ORDEN cronológico en vez de por mes
      // (para créditos cuyas fechas del Excel están corridas vs la DB).
      const cronoSet = new Set(
        (Array.isArray(orden_cronologico) ? orden_cronologico : []).map((s: string) =>
          String(s).replace(/[^0-9]/g, "").padStart(14, "0"),
        ),
      );

      // 1️⃣ Bajar (o cachear) el Excel de R2.
      const descarga = await descargarCarteraDeR2({ key: excel_key, forceRefresh: force_refresh });

      // 2️⃣ Fase DB: traer pagos+cuotas de cada crédito y armar los pedidos.
      type CuotaInfo = {
        numero_cuota: number;
        fecha_vencimiento: string | null;
        pagos: Array<{ pago_id: number; monto_aplicado: any; fecha_pago: any }>;
      };
      const datosCredito = new Map<
        string,
        { credito_id: number; base: string; cuotasPagadas: CuotaInfo[] }
      >();
      const pedidos: Array<{ sifco: string; vencimientos: string[]; todos?: boolean }> = [];

      for (const sifcoRaw of lista) {
        const sifco = String(sifcoRaw);
        const base = sifco.replace(/[^0-9]/g, "").padStart(14, "0");

        const [credito] = await db
          .select({ credito_id: creditos.credito_id })
          .from(creditos)
          .where(eq(creditos.numero_credito_sifco, sifco))
          .limit(1);

        if (!credito) {
          datosCredito.set(sifco, { credito_id: -1, base, cuotasPagadas: [] });
          continue;
        }

        const rows = await db
          .select()
          .from(pagos_credito)
          .innerJoin(cuotas_credito, eq(pagos_credito.cuota_id, cuotas_credito.cuota_id))
          .where(
            and(
              eq(pagos_credito.credito_id, credito.credito_id),
              // Excluye pagos falsos y pendientes (no se sincronizan desde el Excel).
              eq(pagos_credito.paymentFalse, false),
              ne(pagos_credito.validationStatus, "pending"),
            ),
          )
          .orderBy(asc(cuotas_credito.numero_cuota), asc(pagos_credito.pago_id));

        const porCuota = new Map<number, CuotaInfo>();
        for (const r of rows) {
          const c = r.cuotas_credito;
          if (!c.pagado || c.numero_cuota <= 0) continue;
          if (!porCuota.has(c.numero_cuota)) {
            porCuota.set(c.numero_cuota, {
              numero_cuota: c.numero_cuota,
              fecha_vencimiento: aISO(c.fecha_vencimiento as any),
              pagos: [],
            });
          }
          porCuota.get(c.numero_cuota)!.pagos.push({
            pago_id: r.pagos_credito.pago_id,
            monto_aplicado: r.pagos_credito.monto_aplicado,
            fecha_pago: r.pagos_credito.fecha_pago,
          });
        }

        const cuotasPagadas = [...porCuota.values()].sort(
          (a, b) => b.numero_cuota - a.numero_cuota, // de la última a la primera
        );
        datosCredito.set(sifco, { credito_id: credito.credito_id, base, cuotasPagadas });
        pedidos.push({
          sifco,
          vencimientos: cuotasPagadas
            .map((c) => c.fecha_vencimiento)
            .filter((v): v is string => !!v),
          todos: cronoSet.has(base), // cronológico → traer todas las filas del crédito
        });
      }

      // 3️⃣ Leer del Excel solo las hojas necesarias.
      const excelIdx = await leerPagosCarteraPorVencimiento(descarga.filePath, pedidos);

      // 4️⃣ Validar + construir updates (sin escribir).
      const resultados: any[] = [];
      const updatesGlobal: Update[] = [];
      const problemas: any[] = [];
      const omitidas: any[] = []; // cuotas sin match cuando omitir_sin_match=true

      for (const sifcoRaw of lista) {
        const sifco = String(sifcoRaw);
        const d = datosCredito.get(sifco)!;

        if (d.credito_id === -1) {
          problemas.push({ numero_credito_sifco: sifco, motivo: "credito_no_existe" });
          resultados.push({ numero_credito_sifco: sifco, estado: "credito_no_existe" });
          continue;
        }

        const filasExcel = excelIdx.get(d.base);
        const cambiosCredito: any[] = [];
        let pagosAfectados = 0;

        // Cuotas pagadas en orden ascendente (para el emparejado cronológico).
        const esCrono = cronoSet.has(d.base);
        const cuotasAsc = [...d.cuotasPagadas].sort((a, b) => a.numero_cuota - b.numero_cuota);
        // Modo cronológico: pagos del Excel (con abonos) ordenados por fecha.
        const excelOrdenado = esCrono
          ? [...(filasExcel?.values() ?? [])]
              .filter((e) => e.abono_capital !== 0 || e.pago_del_mes !== 0)
              .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))
          : [];

        cuotasAsc.forEach((cuota, i) => {
          if (!cuota.fecha_vencimiento) {
            problemas.push({
              numero_credito_sifco: sifco,
              numero_cuota: cuota.numero_cuota,
              motivo: "cuota_sin_fecha_vencimiento",
            });
            return;
          }
          // Match por orden (cronológico) o por mes (default).
          const excel = esCrono
            ? excelOrdenado[i]
            : filasExcel?.get(cuota.fecha_vencimiento.slice(0, 7));
          if (!excel) {
            const item = {
              numero_credito_sifco: sifco,
              numero_cuota: cuota.numero_cuota,
              fecha_vencimiento: cuota.fecha_vencimiento,
              motivo: esCrono ? "sin_pago_excel_en_ese_orden" : "sin_match_en_excel",
            };
            (omitir_sin_match ? omitidas : problemas).push(item);
            return;
          }

          const updates = construirUpdatesCuota(excel, cuota.pagos);
          updatesGlobal.push(...updates);
          pagosAfectados += updates.length;
          cambiosCredito.push({
            numero_cuota: cuota.numero_cuota,
            fecha_vencimiento: cuota.fecha_vencimiento,
            mes_excel: excel.mes,
            pagos: updates.length,
            es_parcial: cuota.pagos.length > 1,
            partes_excel: excel.partes, // >1 = crédito partido (filas sumadas)
            inversionistas: excel.inversionistas,
            datos: dry_run ? updates.map((u) => ({ pago_id: u.pago_id, ...u.datos })) : undefined,
          });
        });

        resultados.push({
          numero_credito_sifco: sifco,
          credito_id: d.credito_id,
          cuotas_pagadas: d.cuotasPagadas.length,
          pagos_a_actualizar: pagosAfectados,
          cambios: cambiosCredito,
        });
      }

      // 5️⃣ Si hay problemas con el Excel → abortar, NO escribir nada.
      if (problemas.length > 0) {
        set.status = 422;
        return {
          success: false,
          abortado: true,
          motivo: "Hay cuotas pagadas sin match en el Excel (o créditos inexistentes). No se escribió nada.",
          excel: { key: descarga.key, etag: descarga.etag, from_cache: descarga.fromCache },
          problemas_count: problemas.length,
          problemas,
          resultados,
        };
      }

      // 6️⃣ Dry-run: devolver preview sin escribir.
      if (dry_run) {
        set.status = 200;
        return {
          success: true,
          dry_run: true,
          excel: { key: descarga.key, etag: descarga.etag, from_cache: descarga.fromCache },
          total_creditos: lista.length,
          pagos_a_actualizar: updatesGlobal.length,
          omitidas_count: omitidas.length,
          omitidas,
          resultados,
        };
      }

      // 7️⃣ Escribir TODO en una sola transacción (atómico).
      try {
        await db.transaction(async (tx) => {
          for (const { pago_id, datos } of updatesGlobal) {
            await tx.update(pagos_credito).set(datos).where(eq(pagos_credito.pago_id, pago_id));
          }
        });
      } catch (e: any) {
        set.status = 500;
        return {
          success: false,
          abortado: true,
          motivo: "Error al escribir; la transacción se revirtió por completo.",
          error: e?.message ?? String(e),
        };
      }

      set.status = 200;
      return {
        success: true,
        dry_run: false,
        excel: { key: descarga.key, etag: descarga.etag, from_cache: descarga.fromCache },
        total_creditos: lista.length,
        pagos_actualizados: updatesGlobal.length,
        omitidas_count: omitidas.length,
        omitidas,
        resultados,
      };
    },
    {
      body: t.Object({
        creditos: t.Array(t.String({ minLength: 1 })),
        excel_key: t.Optional(t.String()),
        force_refresh: t.Optional(t.Boolean()),
        dry_run: t.Optional(t.Boolean()),
        orden_cronologico: t.Optional(t.Array(t.String())),
        omitir_sin_match: t.Optional(t.Boolean()),
      }),
      detail: {
        summary: "Actualizar pagos pagados de créditos desde el Excel de cartera (R2)",
        description:
          "Baja el .xlsx de cartera desde R2 (caché por ETag), y para cada crédito actualiza sus cuotas PAGADAS con los abonos/restantes del Excel. Match por fecha_vencimiento ↔ columna 'Pago'. Soporta pagos parciales (cascada). dry_run=true (default) solo previsualiza. Si alguna cuota no matchea en el Excel, aborta sin escribir. Escribe todo en una sola transacción.",
        tags: ["Créditos", "Cartera"],
      },
    },
  );
