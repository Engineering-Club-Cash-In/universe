import { db } from "../database/index";
import {
  creditos,
  pagos_credito,
  usuarios,
  inversionistas,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  pagos_credito_inversionistas,
  pagos_credito_inversionistas_espejo,
  boletas,
  cuotas_credito,
  abonos_capital,
  historico_liquidaciones_espejo,
  compras_credito_inversionista,
} from "../database/db/schema";
import { desc, gte } from "drizzle-orm";
import Big from "big.js";
import { z } from "zod";
import { and, eq, lt, sql, asc, lte, inArray } from "drizzle-orm";
import { removeAccents } from "../utils/functions/generalFunctions";
import {
  processAndReplaceCreditInvestors,
  processAndReplaceCreditInvestorsReverse,
} from "./investor";
import { updateMora } from "./latefee";
import { calcularAjusteCompras, obtenerSumaComprasMesAnterior, obtenerSumaComprasPendientes } from "../utils/comprasAjuste";
import { t } from "elysia";
export const pagoSchema = z.object({
  credito_id: z.number().int().positive(),
  usuario_id: z.number().int().positive(),
  monto_boleta: z.number().min(0.01),
  fecha_pago: z.string(),
  llamada: z.string().max(100).optional(),
  renuevo_o_nuevo: z.string().max(50).optional(),
  otros: z.number().optional(),
  mora: z.number().optional(),
  monto_boleta_cuota: z.number().optional(),
  abono_directo_capital: z.number().optional(),

  observaciones: z.string().max(500).optional(),
  credito_sifco: z.string().max(50).optional(),
  cuotaApagar: z.number().min(1),
  url_boletas: z.array(z.string().max(500)),
});


export async function getAllPagosWithCreditAndInversionistas(
  credito_sifco: string
) {
  try {
    // 1. Traer todos los pagos del crédito, junto a los datos de usuario y crédito
    const pagos = await db
      .select({
        pago_id: pagos_credito.pago_id,
        credito_id: pagos_credito.credito_id,
        cuota_id: pagos_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        cuota_pagada: cuotas_credito.pagado, // estado de la CUOTA (distinto de pagado del pago)
        cuota: pagos_credito.cuota,
        cuota_interes: pagos_credito.cuota_interes,
        abono_capital: pagos_credito.abono_capital,
        abono_interes: pagos_credito.abono_interes,
        abono_iva_12: pagos_credito.abono_iva_12,
        abono_interes_ci: pagos_credito.abono_interes_ci,
        abono_iva_ci: pagos_credito.abono_iva_ci,
        abono_seguro: pagos_credito.abono_seguro,
        abono_gps: pagos_credito.abono_gps,
        pago_del_mes: pagos_credito.pago_del_mes,
        monto_boleta: pagos_credito.monto_boleta,
        capital_restante: pagos_credito.capital_restante,
        interes_restante: pagos_credito.interes_restante,
        iva_12_restante: pagos_credito.iva_12_restante,
        seguro_restante: pagos_credito.seguro_restante,
        gps_restante: pagos_credito.gps_restante,
        total_restante: pagos_credito.total_restante,
        llamada: pagos_credito.llamada,
        fecha_pago: pagos_credito.fecha_pago,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        renuevo_o_nuevo: pagos_credito.renuevo_o_nuevo,
        membresias: pagos_credito.membresias,
        membresias_pago: pagos_credito.membresias_pago,
        membresias_mes: pagos_credito.membresias_mes,
        otros: pagos_credito.otros,
        mora: pagos_credito.mora,
        monto_boleta_cuota: pagos_credito.monto_boleta_cuota,
        seguro_total: pagos_credito.seguro_total,
        pagado: pagos_credito.pagado,
        facturacion: pagos_credito.facturacion,
        mes_pagado: pagos_credito.mes_pagado,
        seguro_facturado: pagos_credito.seguro_facturado,
        gps_facturado: pagos_credito.gps_facturado,
        reserva: pagos_credito.reserva,
        observaciones: pagos_credito.observaciones,
        usuario_id: creditos.usuario_id,
        numero_credito_sifco: creditos.numero_credito_sifco,
        usuario_nombre: usuarios.nombre,
        usuario_categoria: usuarios.categoria,
        usuario_nit: usuarios.nit,
        validationStatus: pagos_credito.validationStatus,
        liquidacion_inversionistas: cuotas_credito.liquidado_inversionistas,
        fechaLiquidacion: cuotas_credito.fecha_liquidacion_inversionistas,
        paymentFalse: pagos_credito.paymentFalse,
        monto_aplicado: pagos_credito.monto_aplicado,
        fecha_aplicado: pagos_credito.fecha_aplicado,
        origen_pago: pagos_credito.origen_pago,
      })
      .from(pagos_credito)
      .innerJoin(creditos, eq(pagos_credito.credito_id, creditos.credito_id))
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .leftJoin(
        cuotas_credito,
        eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
      )
      .where(eq(creditos.numero_credito_sifco, credito_sifco))
      .orderBy(cuotas_credito.numero_cuota);

    const pagoIds = pagos.map((p) => p.pago_id);

    const boletasArr =
      pagoIds.length > 0
        ? await db
            .select({
              pago_id: boletas.pago_id,
              url_boleta: boletas.url_boleta,
            })
            .from(boletas)
            .where(inArray(boletas.pago_id, pagoIds))
        : [];

    console.log("boletasArr", boletasArr);
    // @ts-ignore
    pagos.forEach((p) => {
      const pagoId = Number(p.pago_id);
      // @ts-ignore
      p.boletas = boletasArr
        .filter((b) => Number(b.pago_id) === pagoId)
        .map((b) => b.url_boleta);
    });

    // 2. Traer inversionistas de TODO el crédito solo UNA vez
    const creditosIds = [...new Set(pagos.map((p) => p.credito_id))].filter(
      (id): id is number => id !== null && id !== undefined
    );
    const inversionistasBase = await db.query.creditos_inversionistas.findMany({
      where: (ci, { inArray }) => inArray(ci.credito_id, creditosIds),
    });

    // 3. Traer la info de los inversionistas (nombre y emite_factura) de todos los inversionistas relacionados
    const inversionistaIds = [
      ...new Set(inversionistasBase.map((i) => i.inversionista_id)),
    ];
    const inversionistaInfoArr =
      inversionistaIds.length > 0
        ? await db
            .select({
              inversionista_id: inversionistas.inversionista_id,
              nombre: inversionistas.nombre,
              emite_factura: inversionistas.emite_factura,
            })
            .from(inversionistas)
            .where(
              inversionistaIds.length > 0
                ? inArray(inversionistas.inversionista_id, inversionistaIds)
                : undefined
            )
        : [];

    const inversionistaInfo = Object.fromEntries(
      inversionistaInfoArr.map((i) => [i.inversionista_id, i])
    );

    // 4. Traer TODOS los pagos_inversionistas de TODOS los pagos de una vez

    const pagosInversionistasBase =
      pagoIds.length > 0
        ? await db.query.pagos_credito_inversionistas.findMany({
            where: (pci, { inArray }) => inArray(pci.pago_id, pagoIds),
          })
        : [];

    // 5. Mapear por cada pago
    const result = pagos.map((pago) => {
      // Todos los inversionistas del crédito (siempre array, aunque esté vacío)
      const inversionistasData = inversionistasBase
        .filter((inv) => inv.credito_id === pago.credito_id)
        .map((inv) => ({
          ...inv,
          nombre: inversionistaInfo[inv.inversionista_id]?.nombre ?? "",
          emite_factura:
            inversionistaInfo[inv.inversionista_id]?.emite_factura ?? false,
        }));

      // Todos los pagos a inversionistas de este pago (puede estar vacío)
      const pagosInversionistas = pagosInversionistasBase
        .filter((pi) => pi.pago_id === pago.pago_id)
        .map((pi) => ({
          ...pi,
          nombre: inversionistaInfo[pi.inversionista_id]?.nombre ?? "",
          emite_factura:
            inversionistaInfo[pi.inversionista_id]?.emite_factura ?? false,
        }));

      return {
        pago,
        inversionistasData, // SIEMPRE array (puede ser vacío)
        pagosInversionistas, // SIEMPRE array (puede ser vacío)
      };
    });

    return result;
  } catch (error) {
    console.error("[getAllPagosWithCreditAndInversionistas] Error:", error);
    throw new Error("Error fetching all payments and investor details.");
  }
}

export async function getPayments(
  mes: number,
  anio: number,
  page: number = 1,
  perPage: number = 10,
  numero_credito_sifco: string
) {
  const offset = (page - 1) * perPage;

  // 1. Trae los pagos principales con info básica
  const rows = await db
    .select({
      pago: pagos_credito, // todas las columnas de pagos_credito
      numero_credito_sifco: creditos.numero_credito_sifco, // solo este campo de creditos
    })
    .from(pagos_credito)
    .innerJoin(creditos, eq(pagos_credito.credito_id, creditos.credito_id))
    .where(
      and(
        sql`EXTRACT(MONTH FROM ${pagos_credito.fecha_pago}) = ${mes}`,
        sql`EXTRACT(YEAR FROM ${pagos_credito.fecha_pago}) = ${anio}`,
        numero_credito_sifco !== ""
          ? eq(creditos.numero_credito_sifco, numero_credito_sifco)
          : sql`true`,
        eq(pagos_credito.pagado, true)
      )
    )
    .limit(perPage)
    .offset(offset)
    .orderBy(desc(pagos_credito.fecha_pago));

  // 2. Obtiene los ids de pago para traer los inversionistas de un solo golpe
  const pagoIds = rows.map((row) => row.pago.pago_id);
  let boletasArr: { pago_id: number; url_boleta: string }[] = [];
  if (pagoIds.length > 0) {
    boletasArr = await db
      .select({
        pago_id: boletas.pago_id,
        url_boleta: boletas.url_boleta,
      })
      .from(boletas)
      .where(inArray(boletas.pago_id, pagoIds));
  }
  const boletasPorPago: Record<number, string[]> = {};
  for (const b of boletasArr) {
    if (!boletasPorPago[b.pago_id]) boletasPorPago[b.pago_id] = [];
    boletasPorPago[b.pago_id].push(b.url_boleta);
  }
  // 3. Trae todos los pagos_credito_inversionistas de los pagos actuales
  let pagosInversionistas: any[] = [];
  if (pagoIds.length > 0) {
    pagosInversionistas = await db
      .select()
      .from(pagos_credito_inversionistas)
      .where(inArray(pagos_credito_inversionistas.pago_id, pagoIds));
  }

  // 4. Agrupa inversionistas por pago_id para unirlos luego
  const inversionistasPorPago: Record<number, any[]> = {};
  for (const inv of pagosInversionistas) {
    if (!inversionistasPorPago[inv.pago_id]) {
      inversionistasPorPago[inv.pago_id] = [];
    }
    inversionistasPorPago[inv.pago_id].push(inv);
  }

  // 5. Une todo en el resultado final
  const data = rows.map((row) => ({
    ...row.pago,
    numero_credito_sifco: row.numero_credito_sifco,
    inversionistas: inversionistasPorPago[row.pago.pago_id] || [],
    boletas: boletasPorPago[row.pago.pago_id] || [],
  }));

  // Total de filas
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(pagos_credito)
    .innerJoin(creditos, eq(pagos_credito.credito_id, creditos.credito_id))
    .where(
      and(
        sql`EXTRACT(MONTH FROM ${pagos_credito.fecha_pago}) = ${mes}`,
        sql`EXTRACT(YEAR FROM ${pagos_credito.fecha_pago}) = ${anio}`,
        numero_credito_sifco !== ""
          ? eq(creditos.numero_credito_sifco, numero_credito_sifco)
          : sql`true`,
        eq(pagos_credito.pagado, true)
      )
    );
  return {
    data, // [{ pago, numero_credito_sifco, inversionistas: [...] }]
    page,
    perPage,
    totalCount: Number(count),
    totalPages: Math.ceil(Number(count) / perPage),
  };
}
/**
 * Inserta los registros en pagos_credito_inversionistas para cada inversionista,
 * repartiendo los abonos según el porcentaje de participación (Big.js).
 */
export async function insertPagosCreditoInversionistas(
  pago_id: number,
  credito_id: number,
  excludeCube: boolean = false,
  cuotaPagada:boolean = false,
  updateCredito: boolean = true,  // si false, omite el UPDATE a creditos_inversionistas_espejo
  inversionista_id?: number,
  fechaPeriodo?: Date,
  // si true, cuando abono_capital supera al monto_aportado del espejo
  // se hace clamp al monto_aportado (en vez de tirar [ABONO_SUPERA_MONTO]).
  // Caso de uso: fallback de calcularYRegistrarPagosEspejo sobre créditos casi
  // liquidados donde la cuota mensual completa superaría el saldo restante.
  allowClampAbonoCapital: boolean = false,
) {
  console.log(
    "\n🔍 ========== INICIO insertPagosCreditoInversionistas =========="
  );
  console.log("📥 Parámetros:");
  console.log(`   pago_id: ${pago_id}`);
  console.log(`   credito_id: ${credito_id}`);
  console.log(`   excludeCube: ${excludeCube}`);

  // 1. Buscar inversionistas del crédito (ESPEJO)
  const inversionistasData = await db.query.creditos_inversionistas_espejo.findMany({
    where: (ci, { eq }) => eq(ci.credito_id, credito_id),
  });

  console.log(`\n📊 Inversionistas encontrados: ${inversionistasData.length}`);

  if (!inversionistasData.length) {
    console.error("❌ No hay inversionistas registrados para este crédito");
    throw new Error("No hay inversionistas registrados para este crédito");
  }

  const currentPago = await db.query.pagos_credito.findFirst({
    where: (p, { eq }) => eq(p.pago_id, pago_id),
  });

  console.log("\n💳 Pago actual encontrado:");
  console.log("   pago_id:", currentPago?.pago_id);
  console.log("   cuota:", currentPago?.cuota);

  const currentCredit = await db.query.creditos.findFirst({
    where: (c, { eq }) => eq(c.credito_id, credito_id),
  });

  console.log("\n🏦 Crédito actual:");
  console.log("   credito_id:", currentCredit?.credito_id);
  console.log("   membresias_pago:", currentCredit?.membresias_pago);
  console.log("   gps:", currentCredit?.gps);
  console.log("   seguro_10_cuotas:", currentCredit?.seguro_10_cuotas);

  const inversionistasWithName = await Promise.all(
    inversionistasData.map(async (inv) => {
      const [invRow] = await db
        .select({
          nombre: inversionistas.nombre,
          // 🆕 Traemos también el status para decidir si le devolvemos
          // todo su monto_aportado como abono_capital (pendiente_devolucion).
          status: inversionistas.status,
        })
        .from(inversionistas)
        .where(eq(inversionistas.inversionista_id, inv.inversionista_id));
      return {
        ...inv,
        nombre: invRow?.nombre ?? "",
        status_inversionista: invRow?.status ?? null,
      };
    })
  );

  console.log("\n👥 Inversionistas con nombres:");
  inversionistasWithName.forEach((inv, idx) => {
    console.log(`   ${idx + 1}. ${inv.nombre} (ID: ${inv.inversionista_id}) status=${inv.status_inversionista}`);
  });

  if (!inversionistasWithName.length) {
    console.error("❌ No se encontraron inversionistas");
    throw new Error("No se encontraron inversionistas");
  }

  let filteredInversionistas = excludeCube
    ? inversionistasWithName.filter(
        (inv) =>
          inv.nombre.trim().toLowerCase() !==
          "cube investments s.a.".toLowerCase()
      )
    : inversionistasWithName;

  console.log(
    `\n🔍 Inversionistas después de filtrar (excludeCube=${excludeCube}, inversionista_id=${inversionista_id ?? 'todos'}): ${filteredInversionistas.length}`
  );
  filteredInversionistas.forEach((inv, idx) => {
    console.log(`   ${idx + 1}. ${inv.nombre} | cuota_inversionista: [${inv.cuota_inversionista}] (type: ${typeof inv.cuota_inversionista}) | Big: ${new Big(inv.cuota_inversionista || 0).toString()}`);
  });

  if (filteredInversionistas.length === 0) {
    console.log(`\n⚠️ No hay inversionistas para procesar, saliendo...`);
    return;
  }

  const indexMayorCuota = filteredInversionistas.reduce(
    (maxIdx, inv, idx, arr) =>
      new Big(inv.cuota_inversionista || 0).gt(
        new Big(arr[maxIdx].cuota_inversionista || 0)
      )
        ? idx
        : maxIdx,
    0
  );
  const mayorCuotaInversionistaId =
    filteredInversionistas[indexMayorCuota].inversionista_id;

  console.log(`\n🏆 Mayor cuota encontrada:`);
  console.log(`   Índice: ${indexMayorCuota}`);
  console.log(
    `   Inversionista: ${filteredInversionistas[indexMayorCuota].nombre}`
  );
  console.log(
    `   Valor cuota: ${filteredInversionistas[indexMayorCuota].cuota_inversionista}`
  );
  console.log(
    `   inversionista_id: ${mayorCuotaInversionistaId}`
  );

  // Si se pasa inversionista_id, solo procesar ese inversionista
  if (inversionista_id) {
    filteredInversionistas = filteredInversionistas.filter(
      (inv) => inv.inversionista_id === inversionista_id
    );
    console.log(`\n🎯 Filtrando solo inversionista_id: ${inversionista_id}`);
  }

  // 3. Calcular e insertar el abono proporcional de cada inversionista
  const inserts = filteredInversionistas.map(async (inv, idx) => {
    console.log(
      `\n--- 💼 Procesando inversionista ${idx + 1}/${filteredInversionistas.length} ---`
    );
    console.log(`   Nombre: ${inv.nombre}`);
    console.log(`   inversionista_id: ${inv.inversionista_id}`);

    const isCube =
      inv.nombre.trim().toLowerCase() === "cube investments s.a.".toLowerCase();

    console.log(`   ¿Es Cube? ${isCube ? "SÍ ✅" : "NO ❌"}`);

    // Último snapshot del inversionista — determina período de referencia para compras
    const [lastHistoricoV1] = await db
      .select({
        monto_aportado: historico_liquidaciones_espejo.monto_aportado,
        fecha: historico_liquidaciones_espejo.fecha,
      })
      .from(historico_liquidaciones_espejo)
      .where(
        and(
          eq(historico_liquidaciones_espejo.credito_id, credito_id),
          eq(historico_liquidaciones_espejo.inversionista_id, inv.inversionista_id)
        )
      )
      .orderBy(desc(historico_liquidaciones_espejo.fecha))
      .limit(1);

    // fechaPeriodo viene del front (fecha explícita del período a liquidar).
    // Normalización: si llega como "2026-06-01" → new Date() lo parsea UTC 00:00,
    // que en hora local GT (UTC-6) es "2026-05-31 18:00" y getMonth() devuelve mayo.
    // Reconstruimos a partir del día calendario UTC para anclar el mes correcto
    // en hora local sin importar el TZ del server.
    const fechaDelPeriodo = fechaPeriodo
      ? new Date(
          fechaPeriodo.getUTCFullYear(),
          fechaPeriodo.getUTCMonth(),
          fechaPeriodo.getUTCDate(),
        )
      : new Date();

    const periodoMes = fechaDelPeriodo.getMonth();
    const periodoAnio = fechaDelPeriodo.getFullYear();

    let montoBaseCalculo = new Big(inv.monto_aportado);

    const espejoIgualHistoricoV1 =
      lastHistoricoV1 && new Big(inv.monto_aportado).eq(new Big(lastHistoricoV1.monto_aportado));

    // Siempre calcular ajuste — cubre compras pendientes aunque espejo == historico
    const { montoRestarValidacion, montoRestarCalculo } = await calcularAjusteCompras(
      credito_id,
      inv.inversionista_id,
      lastHistoricoV1 ? new Date(lastHistoricoV1.fecha) : null,
      periodoMes,
      periodoAnio,
    );

    // Validación solo cuando espejo != historico (hay compras que ya actualizaron espejo)
    if (!espejoIgualHistoricoV1) {
      const montoParaValidacion = new Big(inv.monto_aportado).minus(montoRestarValidacion);
      if (lastHistoricoV1 && !montoParaValidacion.eq(new Big(lastHistoricoV1.monto_aportado))) {
        throw new Error(
          `[MONTO_ESPEJO_INCONSISTENTE] Inv ${inv.inversionista_id} Cred ${credito_id}: ` +
          `espejo-compras_nuevas (${montoParaValidacion.toFixed(8)}) ≠ histórico (${lastHistoricoV1.monto_aportado})`
        );
      }
    }

    // Siempre aplicar resta — pendientes reducen base aunque espejo == historico
    if (montoRestarCalculo.gt(0)) {
      montoBaseCalculo = new Big(inv.monto_aportado).minus(montoRestarCalculo);
    }

    // Recalcular cuota cuando hay ajuste real
    let cuotaRecalculada: Big;
    if (montoRestarCalculo.gt(0)) {
      const capitalTotalBig  = new Big(currentCredit?.capital ?? 0);
      const cuotaTotalBig    = new Big(currentCredit?.cuota ?? 0);
      const seguroBig        = new Big(currentCredit?.seguro_10_cuotas ?? 0);
      const membresiasBig    = new Big(currentCredit?.membresias_pago ?? 0);
      const cuotaSinCargos   = cuotaTotalBig.minus(membresiasBig).minus(seguroBig);
      const pctParticipacion = capitalTotalBig.gt(0)
        ? montoBaseCalculo.div(capitalTotalBig).times(100)
        : new Big(0);
      const cuotaBaseRecalc  = cuotaSinCargos.times(pctParticipacion.div(100)).round(2);
      cuotaRecalculada = (inv.inversionista_id === mayorCuotaInversionistaId && !excludeCube)
        ? cuotaBaseRecalc.plus(seguroBig).plus(membresiasBig).round(2)
        : cuotaBaseRecalc;
    } else {
      cuotaRecalculada = new Big(inv.cuota_inversionista ?? 0);
    }

    // --- Calcular los 4 campos desde monto_aportado (misma lógica que processAndReplaceCreditInvestors) ---
    const porcentajeCashIn = new Big(inv.porcentaje_cash_in);
    const porcentajeInversion = new Big(inv.porcentaje_participacion_inversionista);
    const cuotaCalc = montoBaseCalculo
      .times(currentCredit?.porcentaje_interes ?? 0)
      .div(100)
      .round(2);

    const montoInversionistaCalc = cuotaCalc.times(porcentajeInversion).div(100).round(2);
    const montoCashInCalc = cuotaCalc.times(porcentajeCashIn).div(100).round(2);
    const ivaInversionistaCalc = montoInversionistaCalc.gt(0)
      ? montoInversionistaCalc.times(0.12).round(2)
      : new Big(0);
    const ivaCashInCalc = montoCashInCalc.gt(0)
      ? montoCashInCalc.times(0.12).round(2)
      : new Big(0);

    console.log(`   🔢 Valores calculados desde monto_aportado:`);
    console.log(`      monto_inversionista: ${montoInversionistaCalc.toString()}`);
    console.log(`      monto_cash_in: ${montoCashInCalc.toString()}`);
    console.log(`      iva_inversionista: ${ivaInversionistaCalc.toString()}`);
    console.log(`      iva_cash_in: ${ivaCashInCalc.toString()}`);

    // --- Interés proporcional si fecha_inicio_participacion es del mes anterior ---
    const fechaInicio = inv.fecha_inicio_participacion
      ? new Date(inv.fecha_inicio_participacion + "T00:00:00")
      : null;

    // Comparar contra la fecha del PERÍODO que se está liquidando (no contra "hoy").
    const mesAnterior = fechaDelPeriodo.getMonth() === 0 ? 11 : fechaDelPeriodo.getMonth() - 1;
    const anioMesAnterior = fechaDelPeriodo.getMonth() === 0
      ? fechaDelPeriodo.getFullYear() - 1
      : fechaDelPeriodo.getFullYear();

    const esMesAnterior =
      !isCube &&
      fechaInicio !== null &&
      fechaInicio.getMonth() === mesAnterior &&
      fechaInicio.getFullYear() === anioMesAnterior &&
      // Si inicia el día 1, participó el mes COMPLETO → interés normal (no proporcional).
      // Prorratear con (diasDelMes - 1) cobraría un día de menos y descuadra por centavos.
      fechaInicio.getDate() !== 1;

    let bigInteres: Big;
    let bigIVA: Big;
    // Desglose para auditoría: solo se setea cuando hay compras del mes anterior.
    let interesSinCompras: Big | null = null;
    let interesConCompras: Big | null = null;
    let ivaSinCompras: Big | null = null;
    let ivaConCompras: Big | null = null;

    if (esMesAnterior) {
      // Días totales del mes de la fecha de inicio (ej: enero = 31)
      const diasDelMes = new Date(
        fechaInicio!.getFullYear(),
        fechaInicio!.getMonth() + 1,
        0
      ).getDate();
      const diaInicio = fechaInicio!.getDate(); // ej: 7
      const diasProporcionales = diasDelMes - diaInicio; // ej: 31 - 7 = 24 días restantes

      // ¿El inversionista ya era partícipe y además hizo compras este mes?
      // Buscamos compras de tipo 'compra_cartera' completadas en el mes anterior.
      const sumaCompras = await obtenerSumaComprasMesAnterior(
        credito_id,
        inv.inversionista_id,
        fechaDelPeriodo,
      );

      // Las compras PENDIENTES ya ensuciaron el monto_aportado del espejo pero
      // todavía no son parte real del crédito → se restan para que no generen
      // interés (ni completo ni proporcional) hasta completarse.
      const sumaPendientes = await obtenerSumaComprasPendientes(
        credito_id,
        inv.inversionista_id,
      );

      // Base proporcional = espejo SIN las pendientes (que aportan 0).
      const montoAportadoBig = new Big(inv.monto_aportado || 0).minus(sumaPendientes);
      // monto viejo = lo que ya tenía antes de las compras del mes (cobra mes completo).
      // Si las compras igualan o superan el espejo, queda 0 → actúa como hoy (todo proporcional).
      const montoViejo = montoAportadoBig.minus(sumaCompras);

      if (sumaCompras.gt(montoAportadoBig)) {
        console.warn(
          `   ⚠️  [COMPRAS_EXCEDEN_MONTO_ESPEJO] Inv ${inv.inversionista_id} Cred ${credito_id}: ` +
          `suma_compras_mes_anterior (${sumaCompras.toFixed(8)}) > monto_aportado_espejo (${montoAportadoBig.toFixed(8)}). ` +
          `Se trata como caso proporcional puro (sin desglose sin/con compras).`
        );
      }

      // Hay monto viejo (mes completo) cuando queda saldo previo y hubo alguna
      // compra del mes (completada → proporcional, o pendiente → 0) que contaminó
      // la fecha_inicio. Sin ninguna compra, es un partícipe genuinamente nuevo
      // y todo va proporcional (rama else).
      const hayMontoViejo =
        montoViejo.gt(0) && (sumaCompras.gt(0) || sumaPendientes.gt(0));

      const porcentajeInteresBig = new Big(currentCredit?.porcentaje_interes ?? 0);

      if (hayMontoViejo) {
        // Tarifa mensual completa sobre el monto viejo.
        interesSinCompras = montoViejo
          .times(porcentajeInteresBig)
          .div(100)
          .times(porcentajeInversion)
          .div(100)
          .round(2);

        // Proporcional sobre lo aportado por las compras del mes.
        interesConCompras = sumaCompras
          .times(porcentajeInteresBig)
          .div(100)
          .times(porcentajeInversion)
          .div(100)
          .times(diasProporcionales)
          .div(diasDelMes)
          .round(2);

        ivaSinCompras = interesSinCompras.gt(0)
          ? interesSinCompras.times(0.12).round(2)
          : new Big(0);
        ivaConCompras = interesConCompras.gt(0)
          ? interesConCompras.times(0.12).round(2)
          : new Big(0);

        bigInteres = interesSinCompras.plus(interesConCompras);
        bigIVA = ivaSinCompras.plus(ivaConCompras);

        console.log(`   📅 INTERÉS PROPORCIONAL CON COMPRAS DEL MES ANTERIOR:`);
        console.log(`      fecha_inicio: ${inv.fecha_inicio_participacion}`);
        console.log(`      días del mes: ${diasDelMes}, días proporcionales: ${diasProporcionales}`);
        console.log(`      monto_aportado espejo: ${montoAportadoBig.toString()}`);
        console.log(`      suma compras mes anterior: ${sumaCompras.toString()}`);
        console.log(`      monto viejo (mes completo): ${montoViejo.toString()}`);
        console.log(`      interes_sin_compras: ${interesSinCompras.toString()}`);
        console.log(`      interes_con_compras: ${interesConCompras.toString()}`);
        console.log(`      iva_sin_compras: ${ivaSinCompras.toString()}`);
        console.log(`      iva_con_compras: ${ivaConCompras.toString()}`);
        console.log(`      bigInteres total: ${bigInteres.toString()}`);
        console.log(`      bigIVA total: ${bigIVA.toString()}`);
      } else {
        // Sin compras del mes anterior (o compras ≥ monto aportado): todo proporcional como hoy.
        bigInteres = montoInversionistaCalc
          .div(diasDelMes)
          .times(diasProporcionales)
          .round(2);
        bigIVA = bigInteres.times(0.12).round(2);

        console.log(`   📅 INTERÉS PROPORCIONAL (sin compras separables):`);
        console.log(`      fecha_inicio: ${inv.fecha_inicio_participacion}`);
        console.log(`      días del mes: ${diasDelMes}, días proporcionales: ${diasProporcionales}`);
        console.log(`      interés proporcional: ${bigInteres.toString()}`);
        console.log(`      IVA proporcional: ${bigIVA.toString()}`);
      }
    } else {
      bigInteres = isCube ? montoCashInCalc : montoInversionistaCalc;
      bigIVA = isCube ? ivaCashInCalc : ivaInversionistaCalc;
    }

    console.log(
      `   💵 Interés a usar: ${bigInteres.toString()} (${esMesAnterior ? "PROPORCIONAL" : isCube ? "monto_cash_in" : "monto_inversionista"})`
    );
    console.log(
      `   🧾 IVA a usar: ${bigIVA.toString()} (${esMesAnterior ? "PROPORCIONAL" : isCube ? "iva_cash_in" : "iva_inversionista"})`
    );

    console.log(
      `   💰 cuota_inversionista original: ${inv.cuota_inversionista}`
    );

    let abono_capital = new Big(inv.monto_aportado || 0).eq(0)
      ? new Big(0)
      : cuotaRecalculada;
    console.log(`   💰 abono_capital inicial (cuota recalculada desde capital ajustado): ${abono_capital.toString()}`);

    const totalMontos = montoCashInCalc.plus(montoInversionistaCalc);
    const totalIVA = ivaCashInCalc.plus(ivaInversionistaCalc);

    console.log(
      `   📊 totalMontos (cash_in + inversionista): ${totalMontos.toString()}`
    );
    console.log(
      `   📊 totalIVA (cash_in + inversionista): ${totalIVA.toString()}`
    );

    const aplicarDevolucionCube = currentCredit?.estado_devolucion === 'VERIFICADO';

    if (aplicarDevolucionCube || inv.status_inversionista === "pendiente_devolucion") {
      // 🆕 CASO ESPECIAL:
      // - crédito con devolucion_cube=true, o
      // - inversionista en pendiente_devolucion.
      // En ambos casos se devuelve TODO su monto_aportado como abono_capital
      // (sin restar interés, IVA ni cargos fijos). El interés/IVA del período
      // se sigue calculando y registrando normal en sus campos.
      abono_capital = new Big(inv.monto_aportado || 0);
      console.log(
        `   ⭐ DEVOLUCIÓN COMPLETA (${aplicarDevolucionCube ? "devolucion_cube" : "pendiente_devolucion"}) - abono_capital = monto_aportado completo: ${abono_capital.toString()}`
      );
    } else if (inv.inversionista_id === mayorCuotaInversionistaId && !excludeCube) {
      console.log(
        `   🏆 ES EL MAYOR INVERSIONISTA - Aplicando descuentos completos`
      );
      console.log(`   📉 Restando:`);
      console.log(`      - totalIVA: ${totalIVA.toString()}`);
      console.log(`      - totalMontos: ${totalMontos.toString()}`);
      console.log(
        `      - membresias_pago: ${currentCredit?.membresias_pago ?? 0}`
      );
      console.log(`      - gps: ${currentCredit?.gps ?? 0}`);
      console.log(
        `      - seguro_10_cuotas: ${currentCredit?.seguro_10_cuotas ?? 0}`
      );

      abono_capital = abono_capital
        .minus(totalIVA)
        .minus(totalMontos)
        .minus(new Big(currentCredit?.membresias_pago ?? 0))
        .minus(new Big(currentCredit?.gps ?? 0))
        .minus(new Big(currentCredit?.seguro_10_cuotas ?? 0));

      if (abono_capital.lt(0)) abono_capital = new Big(0);

      console.log(
        `   ✅ abono_capital después de restas: ${abono_capital.toString()}`
      );
    } else {
      console.log(`   📌 Inversionista regular - Solo resta interés e IVA`);
      console.log(`   📉 Restando:`);
      console.log(`      - totalIVA: ${totalIVA.toString()}`);
      console.log(`      - totalMontos: ${totalMontos.toString()}`);

      abono_capital = abono_capital.minus(totalIVA).minus(totalMontos);

      if (abono_capital.lt(0)) abono_capital = new Big(0);

      console.log(
        `   ✅ abono_capital después de restas: ${abono_capital.toString()}`
      );
    }

    if (updateCredito) {
      console.log(`\n   🔄 Llamando a processAndReplaceCreditInvestors:`);
      console.log(`      credito_id: ${credito_id}`);
      console.log(`      abono_capital: ${abono_capital.toNumber()}`);
      console.log(`      addition: false (RESTA)`);
      console.log(`      inversionista_id: ${inv.inversionista_id}`);

      await processAndReplaceCreditInvestors(
        credito_id,
        abono_capital.toNumber(),
        false,
        inv.inversionista_id,
        true
      );
    } else {
      console.log(`\n   ⏭️  updateCredito=false → omitiendo UPDATE a creditos_inversionistas_espejo`);
    }

    console.log(`   📊 Porcentajes:`);
    console.log(`      porcentaje_cash_in: ${inv.porcentaje_cash_in}`);
    console.log(
      `      porcentaje_participacion_inversionista: ${inv.porcentaje_participacion_inversionista}`
    );

    // ── Buscar abonos a capital NO liquidados para este crédito/inversionista ──
    const abonosNoLiquidados = await db
      .select()
      .from(abonos_capital)
      .where(
        and(
          eq(abonos_capital.credito_id, credito_id),
          eq(abonos_capital.inversionista_id, inv.inversionista_id),
          eq(abonos_capital.liquidado, false)
        )
      );

    let abonoCapitalId: number | null = null;
    if (abonosNoLiquidados.length > 0) {
      if (inv.status_inversionista === "pendiente_devolucion" || aplicarDevolucionCube) {
        // 🆕 Si está en pendiente_devolucion o el crédito usa devolucion_cube,
        // su abono_capital ya es el monto_aportado completo del espejo.
        // Sumar abonos pendientes provocaría doble conteo.
        console.log(
          `   ⏭️  DEVOLUCIÓN COMPLETA: saltando ${abonosNoLiquidados.length} ` +
            `abono(s) a capital pendiente(s) (no se suman al abono_capital ` +
            `ni se linkea abono_capital_id)`
        );
      } else {
        let montoAbono = new Big(0);
        for (const abono of abonosNoLiquidados) {
          if (abono.tipo === "CAPITAL") {
            montoAbono = montoAbono.plus(abono.monto);
          } else if (abono.tipo === "CANCELACION") {
            // colocar el monto aportado del espejo como abono a capital, para que se liquide aunque el abono sea de cancelación
            abono_capital = new Big(inv.monto_aportado || 0);
          }
        }
        if (!montoAbono.eq(0)) {
          abono_capital = abono_capital.plus(montoAbono);
        }
        abonoCapitalId = abonosNoLiquidados[0].abono_id;

        console.log(`   💰 Abono a capital encontrado (id: ${abonoCapitalId}): +${montoAbono.toFixed(6)} (tipo: ${abonosNoLiquidados[0].tipo})`);
        console.log(`      abono_capital con abono sumado: ${abono_capital.toString()}`);
      }
    }

    // Validation 2: abono_capital must not exceed monto_aportado (prevents negative balance)
    if (abono_capital.gt(new Big(inv.monto_aportado || 0))) {
      if (allowClampAbonoCapital) {
        // Crédito casi liquidado: la cuota mensual completa supera el saldo restante.
        // Devolvemos al inversionista solo lo que le queda → espejo terminará en 0.
        console.warn(
          `   ⚠️  [CLAMP_ABONO] Inv ${inv.inversionista_id} Cred ${credito_id}: ` +
          `abono_capital (${abono_capital.toString()}) > monto_aportado (${inv.monto_aportado}). ` +
          `Clamp aplicado → abono_capital = monto_aportado.`
        );
        abono_capital = new Big(inv.monto_aportado || 0);
      } else {
        throw new Error(
          `[ABONO_SUPERA_MONTO] Inv ${inv.inversionista_id} Cred ${credito_id}: abono_capital (${abono_capital.toString()}) > monto_aportado (${inv.monto_aportado})`
        );
      }
    }

    const resultado = {
      pago_id,
      inversionista_id: inv.inversionista_id,
      credito_id,
      abono_capital: abono_capital.toString(),
      abono_interes: bigInteres.toString(),
      abono_iva_12: bigIVA.toString(),
      abono_interes_sin_compras: interesSinCompras?.toString() ?? null,
      abono_interes_con_compras: interesConCompras?.toString() ?? null,
      abono_iva_12_sin_compras: ivaSinCompras?.toString() ?? null,
      abono_iva_12_con_compras: ivaConCompras?.toString() ?? null,
      porcentaje_participacion: isCube
        ? inv.porcentaje_cash_in
        : inv.porcentaje_participacion_inversionista,
      cuota: currentPago?.cuota ?? "0",
      estado_liquidacion: "NO_LIQUIDADO" as const,
      abono_capital_id: abonoCapitalId,
      fecha_pago: fechaDelPeriodo,
    };

    console.log(`   ✅ Resultado final para ${inv.nombre}:`, {
      abono_capital: resultado.abono_capital,
      abono_interes: resultado.abono_interes,
      abono_iva_12: resultado.abono_iva_12,
      porcentaje_participacion: resultado.porcentaje_participacion,
    });

    return resultado;
  });

  console.log(
    "\n✅ ========== FIN insertPagosCreditoInversionistas ==========\n"
  );

  // 4. Insertar todos los registros (ESPEJO)
  const resolvedInserts = await Promise.all(inserts);

  await db
    .insert(pagos_credito_inversionistas_espejo)
    .values(resolvedInserts);

  return resolvedInserts;
}

export async function insertPagosCreditoInversionistasV2(
  pago_id: number,
  credito_id: number,
  fechaPeriodo?: Date,
) {
  // 1. Obtener el pago
  const currentPago = await db.query.pagos_credito.findFirst({
    where: (p, { eq }) => eq(p.pago_id, pago_id),
  });

  if (!currentPago) {
    throw new Error(`No se encontró el pago con id ${pago_id}`);
  }

  // 2. Obtener inversionistas del crédito
  const inversionistasData = await db.query.creditos_inversionistas.findMany({
    where: (ci, { eq }) => eq(ci.credito_id, credito_id),
  });

  if (!inversionistasData.length) {
    throw new Error("No hay inversionistas registrados para este crédito");
  }

  // 3. Obtener nombres para identificar a Cube
  const inversionistasWithName = await Promise.all(
    inversionistasData.map(async (inv) => {
      const [invRow] = await db
        .select({ nombre: inversionistas.nombre })
        .from(inversionistas)
        .where(eq(inversionistas.inversionista_id, inv.inversionista_id));
      return { ...inv, nombre: invRow?.nombre ?? "" };
    })
  );

  // 4. Sumar todos los monto_aportado
  const sumMontosAportados = inversionistasWithName.reduce(
    (acc, inv) => acc.plus(new Big(inv.monto_aportado ?? 0)),
    new Big(0)
  );

  if (sumMontosAportados.eq(0)) {
    throw new Error("La suma de montos aportados es 0, no se puede distribuir");
  }

  // 5. Abonos totales del pago
  const pagoAbonoCapital = new Big(currentPago.abono_capital ?? 0);
  const pagoAbonoInteres = new Big(currentPago.abono_interes ?? 0);
  const pagoAbonoIva = new Big(currentPago.abono_iva_12 ?? 0);

  // 6. Calcular distribución por inversionista
  const inserts = [];
  for (const inv of inversionistasWithName) {
    const isCube =
      inv.nombre.trim().toLowerCase() === "cube investments s.a.".toLowerCase();

    const montoBaseCalculoV2 = new Big(inv.monto_aportado ?? 0);

    // Porcentaje general: base_calculo / SUM(monto_aportado)
    const porcentajeGeneral = montoBaseCalculoV2.div(sumMontosAportados);

    // Porcentaje de participación según tipo (dividir entre 100 porque se guarda como %)
    const porcentajeParticipacion = isCube
      ? new Big(inv.porcentaje_cash_in ?? 0).div(100)
      : new Big(inv.porcentaje_participacion_inversionista ?? 0).div(100);

    // Distribuir abonos: primero por participación, luego por porcentaje general
    const abonoCapitalInv = pagoAbonoCapital.times(porcentajeGeneral);
    const abonoInteresInv = pagoAbonoInteres.times(porcentajeParticipacion).times(porcentajeGeneral);
    const abonoIvaInv = pagoAbonoIva.times(porcentajeParticipacion).times(porcentajeGeneral);

    // Solo actualizar monto_aportado si hubo abono a capital
    if (abonoCapitalInv.gt(0)) {
      await processAndReplaceCreditInvestors(
        credito_id,
        abonoCapitalInv.toNumber(),
        false,
        inv.inversionista_id
      );
    }

    inserts.push({
      pago_id,
      inversionista_id: inv.inversionista_id,
      credito_id,
      abono_capital: abonoCapitalInv.toString(),
      abono_interes: abonoInteresInv.toString(),
      abono_iva_12: abonoIvaInv.toString(),
      porcentaje_participacion: isCube
        ? inv.porcentaje_cash_in
        : inv.porcentaje_participacion_inversionista,
      cuota: currentPago.cuota ?? "0",
      estado_liquidacion: "NO_LIQUIDADO" as const,
    });
  }

  // 7. Insertar/upsert en pagos_credito_inversionistas
  await db
    .insert(pagos_credito_inversionistas)
    .values(inserts)
    .onConflictDoUpdate({
      target: [
        pagos_credito_inversionistas.pago_id,
        pagos_credito_inversionistas.inversionista_id,
      ],
      set: {
        abono_capital: sql`EXCLUDED.abono_capital`,
        abono_interes: sql`EXCLUDED.abono_interes`,
        abono_iva_12: sql`EXCLUDED.abono_iva_12`,
        porcentaje_participacion: sql`EXCLUDED.porcentaje_participacion`,
        cuota: sql`EXCLUDED.cuota`,
        fecha_pago: sql`EXCLUDED.fecha_pago`,
        estado_liquidacion: sql`EXCLUDED.estado_liquidacion`,
        credito_id: sql`EXCLUDED.credito_id`,
      },
    });

  return inserts;
}

/**
 * Updates the estado_liquidacion to "LIQUIDADO" for all payments matching the criteria.
 *
 * @param pago_id - The payment ID
 * @param credito_id - The credit ID
 * @param cuota - (Optional) The cuota value to further filter the records
 * @returns The number of records updated
 */
export async function liquidatePagosCreditoInversionistas(
  pago_id: number,
  credito_id: number,
  cuota: string | number
) {
  console.log(
    `Liquidating payments for pago_id: ${pago_id}, credito_id: ${credito_id}, cuota: ${cuota}`
  );

  // Update the estado_liquidacion to "LIQUIDADO"
  const result = await db
    .update(pagos_credito_inversionistas)
    .set({
      estado_liquidacion: "LIQUIDADO",
    })
    .where(
      and(
        eq(pagos_credito_inversionistas.pago_id, pago_id),
        eq(pagos_credito_inversionistas.credito_id, credito_id),
        eq(pagos_credito_inversionistas.cuota, cuota.toString())
      )
    );

  // 🚨 Si no se actualizó ningún registro, lanza error controlado
  if (!result.rowCount || result.rowCount === 0) {
    throw new Error("No payment found to liquidate with the given criteria");
  }

  return {
    message: "Payments liquidated successfully",
    updatedCount: result.rowCount ?? 0,
  };
}

/**
 * Updates the estado_liquidacion to "LIQUIDADO" for all payments matching the criteria.
 *
 * @param pago_id - The payment ID
 * @param credito_id - The credit ID
 * @param cuota - (Optional) The cuota value to further filter the records
 * @returns The number of records updated
 */
export async function liquidateByInvestor(
  pago_id: number,
  credito_id: number,
  cuota: string | number
) {
  console.log(
    `Liquidating payments for pago_id: ${pago_id}, credito_id: ${credito_id}, cuota: ${cuota}`
  );

  // Update the estado_liquidacion to "LIQUIDADO"
  const result = await db
    .update(pagos_credito_inversionistas)
    .set({
      estado_liquidacion: "LIQUIDADO",
    })
    .where(
      and(
        eq(pagos_credito_inversionistas.pago_id, pago_id),
        eq(pagos_credito_inversionistas.credito_id, credito_id),
        eq(pagos_credito_inversionistas.cuota, cuota.toString())
      )
    );

  // 🚨 Si no se actualizó ningún registro, lanza error controlado
  if (!result.rowCount || result.rowCount === 0) {
    throw new Error("No payment found to liquidate with the given criteria");
  }

  return {
    message: "Payments liquidated successfully",
    updatedCount: result.rowCount ?? 0,
  };
}

// Interfaz para los parámetros
interface InsertarPagoParams {
  numero_credito_sifco: string;
  numero_cuota: number; // opcional si no se especifica
  mora: number;
  otros: number;
  boleta: number;
  urlBoletas: string[]; // opcional si no se especifica
  pagado: boolean;

  // Puedes agregar otros si los necesitas
}

export async function insertarPago({
  numero_credito_sifco,
  numero_cuota,
  mora,
  otros,
  boleta,
  urlBoletas = [],
  pagado = true,
}: InsertarPagoParams) {
  console.log(
    `Insertando pago para crédito SIFCO: ${numero_credito_sifco}, cuota: ${numero_cuota}, mora: ${mora}, otros: ${otros}`
  );
  const [credito] = await db
    .select()
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
    .limit(1);

  if (!credito) {
    throw new Error("No existe el crédito con ese número SIFCO.");
  }
  const [cuotaDelMes] = await db
    .select()
    .from(cuotas_credito)
    .where(
      and(
        eq(cuotas_credito.credito_id, credito.credito_id),
        eq(cuotas_credito.numero_cuota, numero_cuota)
      )
    )
    .limit(1);
  // 1. Buscar el crédito y la data actual
  const pagos = await db
    .select({
      pago_id: pagos_credito.pago_id,
      credito_id: pagos_credito.credito_id,
      cuota_id: pagos_credito.cuota_id,
      cuota: pagos_credito.cuota,
      numero_cuota: cuotas_credito.numero_cuota,
      cuota_interes: pagos_credito.cuota_interes,
      abono_capital: pagos_credito.abono_capital,
      abono_interes: pagos_credito.abono_interes,
      abono_iva_12: pagos_credito.abono_iva_12,
      abono_interes_ci: pagos_credito.abono_interes_ci,
      abono_iva_ci: pagos_credito.abono_iva_ci,
      abono_seguro: pagos_credito.abono_seguro,
      abono_gps: pagos_credito.abono_gps,
      pago_del_mes: pagos_credito.pago_del_mes,
      monto_boleta: pagos_credito.monto_boleta,
      capital_restante: pagos_credito.capital_restante,
      interes_restante: pagos_credito.interes_restante,
      iva_12_restante: pagos_credito.iva_12_restante,
      seguro_restante: pagos_credito.seguro_restante,
      gps_restante: pagos_credito.gps_restante,
      total_restante: pagos_credito.total_restante,
      llamada: pagos_credito.llamada,
      fecha_pago: pagos_credito.fecha_pago,
      fecha_vencimiento: pagos_credito.fecha_vencimiento,
      renuevo_o_nuevo: pagos_credito.renuevo_o_nuevo,
      membresias: pagos_credito.membresias,
      membresias_pago: pagos_credito.membresias_pago,
      membresias_mes: pagos_credito.membresias_mes,
      otros: pagos_credito.otros,
      mora: pagos_credito.mora,
      monto_boleta_cuota: pagos_credito.monto_boleta_cuota,
      seguro_total: pagos_credito.seguro_total,
      pagado: pagos_credito.pagado,
      facturacion: pagos_credito.facturacion,
      mes_pagado: pagos_credito.mes_pagado,
      seguro_facturado: pagos_credito.seguro_facturado,
      gps_facturado: pagos_credito.gps_facturado,
      reserva: pagos_credito.reserva,
      observaciones: pagos_credito.observaciones,
      usuario_id: creditos.usuario_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      usuario_nombre: usuarios.nombre,
      usuario_categoria: usuarios.categoria,
      usuario_nit: usuarios.nit,
      // Agrega más si lo necesitas
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      gps: creditos.gps,
      iva_12: creditos.iva_12,
      deudatotal: creditos.deudatotal,
    })
    .from(pagos_credito)
    .innerJoin(creditos, eq(pagos_credito.credito_id, creditos.credito_id))
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .leftJoin(
      cuotas_credito,
      eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
    )
    .where(
      and(
        eq(creditos.numero_credito_sifco, numero_credito_sifco),
        eq(pagos_credito.cuota_id, cuotaDelMes.cuota_id ?? 0)
      )
    )
    .orderBy(pagos_credito.pago_id);

  if (!pagos.length) {
    throw new Error("No existe el crédito con ese número SIFCO.");
  }

  const creditData = pagos[pagos.length - 1];
  if (creditData.credito_id == null) {
    throw new Error("El crédito no tiene un ID válido.");
  }
  const monthPayments = await getPagosDelMesActual(creditData.credito_id);
  const monthPaymentsBig = new Big(monthPayments ?? 0).add(boleta ?? 0);
  const [nuevoPago] = await db
    .insert(pagos_credito)
    .values({
      credito_id: creditData.credito_id,
      cuota_id: creditData.cuota_id ?? 0,
      cuota: creditData.cuota?.toString() ?? "0",
      cuota_interes: creditData.cuota_interes?.toString() ?? "0",

      abono_capital: "0",
      abono_interes: "0",
      abono_iva_12: "0",
      abono_interes_ci: "0",
      abono_iva_ci: "0",
      abono_seguro: "0",
      abono_gps: "0",
      pago_del_mes: monthPaymentsBig.toString() ?? "0",
      monto_boleta: boleta.toString(),

      capital_restante: creditData.capital_restante?.toString() ?? "0",
      interes_restante: creditData.cuota_interes?.toString() ?? "0",
      iva_12_restante: creditData.iva_12?.toString() ?? "0",
      seguro_restante: creditData.seguro_10_cuotas?.toString() ?? "0",
      gps_restante: creditData.gps?.toString() ?? "0",
      total_restante: creditData.deudatotal?.toString() ?? "0",

      llamada: "",

      renuevo_o_nuevo: "renuevo",

      membresias: creditData.membresias_pago ?? "0",
      membresias_pago: creditData.membresias_pago?.toString() ?? "",
      membresias_mes: creditData.membresias_mes?.toString() ?? "",
      otros: otros.toString() ?? "0",
      mora: mora.toString(),
      monto_boleta_cuota: boleta.toString(),
      seguro_total: creditData.seguro_10_cuotas?.toString() ?? "0",
      pagado: pagado,
      facturacion: "si",
      mes_pagado: "",
      seguro_facturado: creditData.seguro_10_cuotas?.toString() ?? "0",
      gps_facturado: creditData.gps?.toString() ?? "0",
      reserva: "0",
      observaciones: "",
      registerBy: "ADMIN",
      pagoConvenio: "0",
      monto_aplicado: boleta.toString(),
    })
    .returning();
  if (mora && Number(mora) > 0) {
    await updateMora({
      credito_id: creditData.credito_id,
      monto_cambio: Number(mora),
      tipo: "DECREMENTO", // 👈 bajamos la mora porque el cliente ya pagó
    });
  }

  if (urlBoletas && urlBoletas.length > 0) {
    await db.insert(boletas).values(
      urlBoletas.map((url) => ({
        pago_id: nuevoPago?.pago_id,
        url_boleta: url,
      }))
    );
  }
  console.log("Nuevo pago insertado:", nuevoPago);

  return nuevoPago;
}

export async function insertPagosCreditoInversionistasSpecial(
  pago_id: number,
  credito_id: number
) {
  console.log(
    `Insertando pagos_credito_inversionistas para pago_id: ${pago_id}, credito_id: ${credito_id}`
  );
  // 1. Buscar inversionistas del crédito
  const inversionistasData = await db.query.creditos_inversionistas.findMany({
    where: (ci, { eq }) => eq(ci.credito_id, credito_id),
  });

  if (!inversionistasData.length) {
    throw new Error("No hay inversionistas registrados para este crédito");
  }
  const currentPago = await db.query.pagos_credito.findFirst({
    where: (p, { eq }) => eq(p.pago_id, pago_id),
  });

  const inversionistasWithName = await Promise.all(
    inversionistasData.map(async (inv) => {
      const [invRow] = await db
        .select({ nombre: inversionistas.nombre }) // Usa el nombre real de tu tabla
        .from(inversionistas)
        .where(eq(inversionistas.inversionista_id, inv.inversionista_id));
      return {
        ...inv,
        nombre: invRow?.nombre ?? "",
      };
    })
  );
  const indexMayorCuota = inversionistasWithName.reduce(
    (maxIdx, inv, idx, arr) =>
      new Big(inv.cuota_inversionista ?? 0).gt(
        new Big(arr[maxIdx].cuota_inversionista ?? 0)
      )
        ? idx
        : maxIdx,
    0
  );
  console.log(
    `Mayor cuota encontrada en el índice: ${indexMayorCuota}, valor: ${inversionistasWithName[indexMayorCuota].cuota_inversionista}`
  );
  const total_porcentaje_cash_in = inversionistasWithName.reduce(
    (sum, inv) => sum + Number(inv.porcentaje_cash_in),
    0
  );
  const total_porcentaje_inversion = inversionistasWithName.reduce(
    (sum, inv) => sum + Number(inv.porcentaje_participacion_inversionista),
    0
  );
  // 3. Calcular e insertar el abono proporcional de cada inversionista
  const inserts = inversionistasWithName.map(async (inv, idx) => {
    const isCube =
      inv.nombre.trim().toLowerCase() === "cube investments s.a.".toLowerCase();

    let abono_universo = new Big(0);
    let porcentaje = new Big(0);

    if (isCube) {
      porcentaje = new Big(inv.porcentaje_cash_in);
      // Usar Big.js en los cálculos
      abono_universo =
        total_porcentaje_cash_in > 0
          ? porcentaje
              .div(total_porcentaje_cash_in)
              .times(inv.porcentaje_cash_in)
          : new Big(0);
    } else {
      porcentaje = new Big(inv.porcentaje_participacion_inversionista);
      abono_universo =
        total_porcentaje_inversion > 0
          ? porcentaje
              .div(total_porcentaje_inversion)
              .times(inv.porcentaje_participacion_inversionista)
          : new Big(0);
    }

    const newAmount = new Big(inv.monto_inversionista ?? 0).minus(
      abono_universo
    );
    await db
      .update(creditos_inversionistas)
      .set({
        monto_aportado: newAmount.toString(),
      })
      .where(and(eq(creditos_inversionistas.credito_id, credito_id)));
    return {
      pago_id,
      inversionista_id: inv.inversionista_id,
      credito_id,
      abono_capital: abono_universo.toString(),
      abono_interes: "0",
      abono_iva_12: "0",
      porcentaje_participacion: isCube
        ? inv.porcentaje_cash_in
        : inv.porcentaje_participacion_inversionista,
      cuota: currentPago?.cuota ?? "0",
      estado_liquidacion: "NO_LIQUIDADO" as const,
    };
  });

  // 4. Insertar todos los registros
  const resolvedInserts = await Promise.all(inserts);
  await db.insert(pagos_credito_inversionistas).values(resolvedInserts);

  return resolvedInserts;
}
export async function falsePayment(pago_id: number, credito_id: number) {
  console.log(
    `Falsificando pago con ID: ${pago_id} para crédito ID: ${credito_id}`
  );
  // updateCredito=false → NO actualiza creditos_inversionistas_espejo (monto_aportado).
  // Falsear un pago no debe descontar el aporte del crédito/espejo.
  insertPagosCreditoInversionistas(pago_id, credito_id, true, false, false); // excludeCube=true, cuotaPagada=false, updateCredito=false
  // Actualizar el estado del pago a falso
  const result = await db
    .update(pagos_credito)
    .set({
      pagado: false,
      paymentFalse: true,
    })
    .where(
      and(
        eq(pagos_credito.pago_id, pago_id),
        eq(pagos_credito.credito_id, credito_id)
      )
    );

  // 🚨 Si no se actualizó ningún registro, lanza error controlado
  if (!result.rowCount || result.rowCount === 0) {
    throw new Error(
      "No payment found to mark as false with the given criteria"
    );
  }

  return {
    message: "Payment marked as false successfully",
    updatedCount: result.rowCount ?? 0,
  };
}

export async function getPagosDelMesActual(credito_id: number) {
  const hoy = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Guatemala" })
  );
  const mes = hoy.getMonth() + 1; // getMonth() es 0-based
  const anio = hoy.getFullYear();

  // Trae todos los pagos válidos de este mes y año
  const pagos = await db
    .select({ monto_boleta: pagos_credito.monto_boleta })
    .from(pagos_credito)
    .where(
      and(
        eq(pagos_credito.pagado, true),
        sql`EXTRACT(MONTH FROM ${pagos_credito.fecha_pago}) = ${mes}`,
        sql`EXTRACT(YEAR FROM ${pagos_credito.fecha_pago}) = ${anio}`,
        eq(pagos_credito.credito_id, credito_id)
      )
    );

  // Suma con Big.js
  let total = Big(0);
  for (const pago of pagos) {
    if (pago.monto_boleta !== null) {
      total = total.plus(pago.monto_boleta);
    }
  }

  return total.toFixed(2); // Devuelve como string, siempre dos decimales
}

interface GetPagosOptions {
  page?: number;
  pageSize?: number;
  numeroCredito?: string;
  dia?: number;
  mes?: number;
  anio?: number;
  fechaInicio?: string;
  fechaFin?: string;
  inversionistaId?: number;
  usuarioNombre?: string;
  validationStatus?: string;
  categoriaCredito?: string;
  tipoCredito?: string;
  formatoCredito?: string;
  soloAplicados?: boolean;
  fechaAplicado?: string;
  fechaBoleta?: string;
  fechaBoletaInicio?: string;
  fechaBoletaFin?: string;
}
/**
 * 📊 Obtiene los pagos junto con su información detallada de créditos, usuarios, cuotas e inversionistas.
 * - Incluye los nuevos campos del pago: mora, otros, reserva, membresías, observaciones.
 * - Usa subconsultas JSON para traer toda la info relacionada en una sola query.
 * - Si un pago no tiene registro en pagos_credito_inversionistas, igual aparece con inversionistas = [].
 */
/**
 * 📊 Obtiene los pagos junto con su información detallada de créditos, usuarios e inversionistas.
 * Incluye los abonos principales y campos adicionales de pago (mora, otros, reserva, membresías, observaciones).
 */
export async function getPagosConInversionistas(options: GetPagosOptions = {}) {
  const {
    page = 1,
    pageSize = 20,
    numeroCredito,
    dia,
    mes,
    anio,
    fechaInicio,
    fechaFin,
    inversionistaId,
    usuarioNombre,
    validationStatus,
    categoriaCredito,
    tipoCredito,
    formatoCredito,
    soloAplicados,
    fechaAplicado,
    fechaBoleta,
    fechaBoletaInicio,
    fechaBoletaFin,
  } = options;

  try {
    const offset = (page - 1) * pageSize;

    // 🔹 Construcción dinámica de filtros
    const whereClauses: string[] = [];

    if (numeroCredito)
      whereClauses.push(`c.numero_credito_sifco = '${numeroCredito}'`);
    if (usuarioNombre) whereClauses.push(`u.nombre ILIKE '%${usuarioNombre}%'`);

    // 📅 Rango de fechas (zona Guatemala UTC-6)
    if (fechaInicio) {
      whereClauses.push(
        `(p.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date >= '${fechaInicio}'::date`
      );
    }
    if (fechaFin) {
      whereClauses.push(
        `(p.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date <= '${fechaFin}'::date`
      );
    }

    // 📅 Filtros individuales de día/mes/año (legacy, compatibilidad)
    if (anio && !fechaInicio && !fechaFin) whereClauses.push(`EXTRACT(YEAR FROM p.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala') = ${anio}`);
    if (mes && !fechaInicio && !fechaFin) whereClauses.push(`EXTRACT(MONTH FROM p.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala') = ${mes}`);
    if (dia && !fechaInicio && !fechaFin) whereClauses.push(`EXTRACT(DAY FROM p.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala') = ${dia}`);

    if (validationStatus) {
      whereClauses.push(`p.validation_status = '${validationStatus}'`);
    } else {
      whereClauses.push(
        `p.validation_status IN ('validated', 'pending' ,'reset', 'capital')`
      );
    }

    if (inversionistaId) {
      whereClauses.push(`
        EXISTS (
          SELECT 1
          FROM cartera.pagos_credito_inversionistas pci2
          WHERE pci2.pago_id = p.pago_id
          AND pci2.inversionista_id = '${inversionistaId}'
        )
      `);
    }

    // 🏷️ Filtros de crédito
    if (categoriaCredito) whereClauses.push(`u.categoria = '${categoriaCredito}'`);
    if (tipoCredito) whereClauses.push(`c.tipo_credito = '${tipoCredito}'`);
    if (formatoCredito) whereClauses.push(`c.formato_credito = '${formatoCredito}'`);
    if (soloAplicados === true) whereClauses.push(`p.fecha_aplicado IS NOT NULL`);
    if (soloAplicados === false) whereClauses.push(`p.fecha_aplicado IS NULL`);
    if (fechaAplicado) {
      whereClauses.push(
        `(p.fecha_aplicado AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date = '${fechaAplicado}'::date`
      );
    }
    if (fechaBoleta) {
      whereClauses.push(
        `(p.fecha_boleta AT TIME ZONE 'America/Guatemala')::date = '${fechaBoleta}'::date`
      );
    }
    // 📅 Rango de fecha_boleta (zona Guatemala). Inclusivo en ambos extremos.
    // Se puede usar combinado o por separado con fechaBoleta (exacta).
    if (fechaBoletaInicio) {
      whereClauses.push(
        `(p.fecha_boleta AT TIME ZONE 'America/Guatemala')::date >= '${fechaBoletaInicio}'::date`
      );
    }
    if (fechaBoletaFin) {
      whereClauses.push(
        `(p.fecha_boleta AT TIME ZONE 'America/Guatemala')::date <= '${fechaBoletaFin}'::date`
      );
    }

    // ✅ Créditos activos y cancelados
    whereClauses.push(
      `c."statusCredit" IN ('ACTIVO', 'MOROSO','PENDIENTE_CANCELACION','EN_CONVENIO','CANCELADO','INCOBRABLE')`
    );
    const whereSQL = whereClauses.length
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";

    // 🔢 Query para contar el total de registros (SIN LIMIT)
    const countQuery = sql`
      SELECT COUNT(*) as total
      FROM cartera.pagos_credito p
      LEFT JOIN cartera.creditos c ON c.credito_id = p.credito_id
      LEFT JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
      ${sql.raw(whereSQL)}
    `;

    const countResult = await db.execute(countQuery);
    const totalRecords = Number(countResult.rows[0]?.total || 0);
    const totalPages = Math.ceil(totalRecords / pageSize);

    // 🧩 Query principal
    const query = sql`
      SELECT
        p.pago_id AS "pagoId",
        p.monto_boleta AS "montoBoleta",
        p.numeroAutorizacion AS "numeroAutorizacion",
        TO_CHAR(p.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD HH24:MI:SS') AS "fechaPago",

        -- 💸 Campos propios del pago
        p.mora AS "mora",
        p.pago_convenio AS "pagoConvenio",
        p.otros AS "otros",
        p.reserva AS "reserva",
        p.membresias_pago AS "membresias",
        p.observaciones AS "observaciones",
        p.registerBy AS "registerBy",
        p.numeroautorizacion AS "numeroautorizacion",
        b.nombre AS "bancoNombre",

        -- 🏦 Info de la cuenta de empresa (NUEVO) 👇
        ce.nombre_cuenta AS "cuentaEmpresaNombre",
        ce.banco AS "cuentaEmpresaBanco",
        ce.numero_cuenta AS "cuentaEmpresaNumero",

        -- 📅 Fecha boleta en zona Guatemala
        TO_CHAR(p.fecha_boleta AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD') AS "fechaBoleta",

        -- 📅 Fecha en que se aplicó el pago (zona Guatemala)
        TO_CHAR(p.fecha_aplicado AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD HH24:MI:SS') AS "fechaAplicado",

        -- 👤 Nombre del asesor que registró
        ase.nombre AS "registerByNombre",

        -- 💰 Abonos del pago
        p.cuota AS "cuotaMonto",
        p.pagado AS "pagado",
        p.abono_capital AS "abono_capital",
        p.abono_interes AS "abono_interes",
        p.abono_iva_12 AS "abono_iva_12",
        p.abono_seguro AS "abono_seguro",
        p.abono_gps AS "abono_gps",
        p.validation_status AS "validation_status",
        p.monto_aplicado AS "monto_aplicado",
        p.origen_pago AS "origenPago",

        -- 💳 Info del crédito
        json_build_object(
          'creditoId', c.credito_id,
          'numeroCreditoSifco', c.numero_credito_sifco,
          'capital', c.capital,
          'deudaTotal', c.deudatotal,
          'statusCredit', c."statusCredit",
          'porcentajeInteres', c.porcentaje_interes,
          'fechaCreacion', c.fecha_creacion,
          'banderaReinversion', c.bandera_reinversion
        ) AS "credito",

        -- 🚩 Bandera top-level: crédito con compra de cartera / reinversión pendiente
        c.bandera_reinversion AS "banderaReinversion",

        -- 📅 Info de la cuota
        (
          SELECT json_build_object(
            'cuotaId', cq.cuota_id,
            'numeroCuota', cq.numero_cuota,
            'fechaVencimiento', cq.fecha_vencimiento
          )
          FROM cartera.cuotas_credito cq
          WHERE cq.cuota_id = p.cuota_id
          LIMIT 1
        ) AS "cuota",

        -- 👤 Info del usuario
        json_build_object(
          'usuarioId', u.usuario_id,
          'nombre', u.nombre,
          'nit', u.nit,
          'categoria', u.categoria
        ) AS "usuario",

        -- 💰 Subconsulta de inversionistas
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'inversionistaId', i.inversionista_id,
              'nombreInversionista', i.nombre,
              'emiteFactura', i.emite_factura,
              'abonoCapital', pci.abono_capital,
              'abonoInteres', pci.abono_interes,
              'abonoIva', pci.abono_iva_12,
              'isr', ROUND(COALESCE(pci.abono_interes, 0) * 0.05, 2),
              'cuotaPago', pci.cuota,
              'montoAportado', ci.monto_aportado,
              'porcentajeParticipacion', ci.porcentaje_participacion_inversionista
            )
          )
          FROM cartera.pagos_credito_inversionistas pci
          LEFT JOIN cartera.inversionistas i ON i.inversionista_id = pci.inversionista_id
          LEFT JOIN cartera.creditos_inversionistas ci
            ON ci.credito_id = pci.credito_id
            AND ci.inversionista_id = pci.inversionista_id
          WHERE pci.pago_id = p.pago_id
        ), '[]'::json) AS "inversionistas",

        -- 📸 Boletas asociadas (todas)
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'boletaId', bol.id,
              'urlBoleta', bol.url_boleta
            )
          )
          FROM cartera.boletas bol
          WHERE bol.pago_id = p.pago_id
        ), '[]'::json) AS "boletas",

        -- 🔴 Cancelación del crédito (solo si validation_status = 'reset')
        CASE WHEN p.validation_status = 'reset' THEN (
          SELECT json_build_object(
            'id', cc.id,
            'motivo', cc.motivo,
            'observaciones', cc.observaciones,
            'fechaCancelacion', TO_CHAR(cc.fecha_cancelacion AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD HH24:MI:SS'),
            'montoCancelacion', cc.monto_cancelacion,
            'activo', cc.activo,
            'traspaso', cc.traspaso,
            'garantiaMobiliaria', cc.garantia_mobiliaria,
            'otros', cc.otros,
            'cuotasAtrasadas', cc.cuotas_atrasadas,
            'montosAdicionales', COALESCE((
              SELECT json_agg(
                json_build_object(
                  'concepto', ma.concepto,
                  'monto', ma.monto
                )
              )
              FROM cartera.montos_adicionales ma
              WHERE ma.credit_id = cc.credit_id
            ), '[]'::json)
          )
          FROM cartera.credit_cancelations cc
          WHERE cc.credit_id = p.credito_id
          ORDER BY cc.id DESC
          LIMIT 1
        ) ELSE NULL END AS "cancelacion"

      FROM cartera.pagos_credito p
      LEFT JOIN cartera.creditos c ON c.credito_id = p.credito_id
      LEFT JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
      LEFT JOIN cartera.bancos b ON b.banco_id = p.banco_id
      LEFT JOIN cartera.cuentas_empresa ce ON ce.cuenta_id = p.cuenta_empresa_id
      LEFT JOIN cartera.asesores ase ON ase.asesor_id = c.asesor_id
      ${sql.raw(whereSQL)}
      ORDER BY p.fecha_pago DESC
      LIMIT ${pageSize} OFFSET ${offset};
    `;

    const result = await db.execute(query);

    // 🧠 Transformación final del resultado
    const data = result.rows.map((r) => ({
      pagoId: r.pagoId,
      montoBoleta: r.montoBoleta,
      numeroAutorizacion: r.numeroAutorizacion,
      fechaPago: r.fechaPago,
      mora: r.mora,
      pagoConvenio: r.pagoConvenio,
      otros: r.otros,
      reserva: r.reserva,
      membresias: r.membresias,
      registerBy: r.registerBy,
      numeroautorizacion: r.numeroautorizacion,
      bancoNombre: r.bancoNombre,
      cuentaEmpresaNombre: r.cuentaEmpresaNombre, // 👈 NUEVO
      cuentaEmpresaBanco: r.cuentaEmpresaBanco, // 👈 NUEVO
      cuentaEmpresaNumero: r.cuentaEmpresaNumero,
      fechaBoleta: r.fechaBoleta,
      fechaAplicado: r.fechaAplicado,
      registerByNombre: r.registerByNombre,
      observaciones: r.observaciones,
      cuotaMonto: r.cuotaMonto,
      pagado: r.pagado,
      abono_capital: r.abono_capital,
      abono_interes: r.abono_interes,
      abono_iva_12: r.abono_iva_12,
      abono_seguro: r.abono_seguro,
      validationStatus: r.validation_status,
      abono_gps: r.abono_gps,
      monto_aplicado: r.monto_aplicado,
      origenPago: r.origenPago,
      credito: r.credito,
      banderaReinversion: r.banderaReinversion ?? false,
      cuota: r.cuota,
      usuario: r.usuario,
      inversionistas: Array.isArray(r.inversionistas)
        ? r.inversionistas
        : JSON.parse(
            typeof r.inversionistas === "string" ? r.inversionistas : "[]"
          ),
      boletas: Array.isArray(r.boletas)
        ? r.boletas
        : JSON.parse(
            typeof r.boletas === "string" ? r.boletas : "[]"
          ),
      cancelacion: r.cancelacion ?? null,
    }));

    interface TotalesGenerales {
      totalAbonoCapital: number;
      totalAbonoInteres: number;
      totalAbonoIva: number;
      totalAbonoSeguro: number;
      totalAbonoGps: number;
      totalMora: number;
      totalConvenio: number;
      totalOtros: number;
      totalReserva: number;
      totalMembresias: number;
    }

    const totalesGenerales = result.rows.reduce<TotalesGenerales>(
      (acc, r) => {
        acc.totalAbonoCapital += Number(r.abono_capital || 0);
        acc.totalAbonoInteres += Number(r.abono_interes || 0);
        acc.totalAbonoIva += Number(r.abono_iva_12 || 0);
        acc.totalAbonoSeguro += Number(r.abono_seguro || 0);
        acc.totalAbonoGps += Number(r.abono_gps || 0);
        acc.totalMora += Number(r.mora || 0);
        acc.totalOtros += Number(r.otros || 0);
        acc.totalReserva += Number(r.reserva || 0);
        acc.totalMembresias += Number(r.membresias || 0);
        acc.totalConvenio += Number(r.pagoConvenio || 0);
        return acc;
      },
      {
        totalAbonoCapital: 0,
        totalAbonoInteres: 0,
        totalAbonoIva: 0,
        totalAbonoSeguro: 0,
        totalAbonoGps: 0,
        totalMora: 0,
        totalOtros: 0,
        totalReserva: 0,
        totalMembresias: 0,
        totalConvenio: 0,
      }
    );

    // 💰 Redondear con Big.js SOLO al final (una vez)
    const totalesFinales = {
      totalAbonoCapital: new Big(totalesGenerales.totalAbonoCapital)
        .round(2)
        .toNumber(),
      totalAbonoInteres: new Big(totalesGenerales.totalAbonoInteres)
        .round(2)
        .toNumber(),
      totalAbonoIva: new Big(totalesGenerales.totalAbonoIva)
        .round(2)
        .toNumber(),
      totalAbonoSeguro: new Big(totalesGenerales.totalAbonoSeguro)
        .round(2)
        .toNumber(),
      totalAbonoGps: new Big(totalesGenerales.totalAbonoGps)
        .round(2)
        .toNumber(),
      totalMora: new Big(totalesGenerales.totalMora).round(2).toNumber(),
      totalOtros: new Big(totalesGenerales.totalOtros).round(2).toNumber(),
      totalReserva: new Big(totalesGenerales.totalReserva).round(2).toNumber(),
      totalMembresias: new Big(totalesGenerales.totalMembresias)
        .round(2)
        .toNumber(),
        totalConvenio: new Big(totalesGenerales.totalConvenio)
        .round(2)
        .toNumber(),
      totalGeneral: new Big(totalesGenerales.totalAbonoCapital)
        .plus(totalesGenerales.totalAbonoInteres)
        .plus(totalesGenerales.totalAbonoIva)
        .plus(totalesGenerales.totalAbonoSeguro)
        .plus(totalesGenerales.totalAbonoGps)
        .plus(totalesGenerales.totalMora)
        .plus(totalesGenerales.totalOtros)
        .plus(totalesGenerales.totalReserva)
        .plus(totalesGenerales.totalMembresias)
        .plus(totalesGenerales.totalConvenio)
        .round(2)
        .toNumber(),
    };
    // 💰 Totales de inversionistas (desde pagos_credito_inversionistas)
    const totalesInvQuery = sql`
      SELECT
        i.inversionista_id AS "inversionistaId",
        i.nombre AS "nombreInversionista",
        i.emite_factura AS "emiteFactura",
        COALESCE(SUM(pci.abono_capital::numeric), 0) AS "totalAbonoCapital",
        COALESCE(SUM(pci.abono_interes::numeric), 0) AS "totalAbonoInteres",
        COALESCE(SUM(pci.abono_iva_12::numeric), 0) AS "totalAbonoIva",
        ROUND(COALESCE(SUM(pci.abono_interes::numeric), 0) * 0.05, 2) AS "totalIsr",
        COALESCE(SUM(ci.monto_aportado::numeric), 0) AS "totalMontoAportado"
      FROM cartera.pagos_credito_inversionistas pci
      INNER JOIN cartera.pagos_credito p ON p.pago_id = pci.pago_id
      INNER JOIN cartera.creditos c ON c.credito_id = pci.credito_id
      INNER JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
      INNER JOIN cartera.inversionistas i ON i.inversionista_id = pci.inversionista_id
      LEFT JOIN cartera.creditos_inversionistas ci
        ON ci.credito_id = pci.credito_id
        AND ci.inversionista_id = pci.inversionista_id
      ${sql.raw(whereSQL)}
      ${sql.raw(inversionistaId ? `AND pci.inversionista_id = '${inversionistaId}'` : '')}
      GROUP BY i.inversionista_id, i.nombre, i.emite_factura
      ORDER BY i.nombre
    `;

    const totalesInvResult = await db.execute(totalesInvQuery);
    const totalesInversionistas = totalesInvResult.rows.map((r: any) => ({
      inversionistaId: r.inversionistaId,
      nombreInversionista: r.nombreInversionista,
      emiteFactura: r.emiteFactura ?? false,
      totalAbonoCapital: new Big(r.totalAbonoCapital).round(2).toNumber(),
      totalAbonoInteres: new Big(r.totalAbonoInteres).round(2).toNumber(),
      totalAbonoIva: new Big(r.totalAbonoIva).round(2).toNumber(),
      totalIsr: new Big(r.totalIsr).round(2).toNumber(),
      totalMontoAportado: new Big(r.totalMontoAportado).round(2).toNumber(),
    }));

    return {
      success: true,
      message: "📄 Datos de pagos obtenidos correctamente",
      page,
      pageSize,
      total: totalRecords,
      totalPages,
      data,
      totales: totalesFinales,
      totalesInversionistas,
    };
  } catch (error: any) {
    console.error("❌ Error en getPagosConInversionistas:", error);
    return {
      success: false,
      message: "❌ Error al obtener los pagos con inversionistas",
      page,
      pageSize,
      total: 0,
      totalPages: 0,
      data: [],
      error: error.message,
    };
  }
}
/**
 * 🔍 Obtiene todos los créditos con pagos pendientes de un inversionista específico
 *
 * @param inversionistaId - ID del inversionista a consultar
 * @param generateFalsePayment - Si es true, genera los pagos en pagos_credito_inversionistas
 * @returns Objeto con créditos, cuotas actuales y pagos pendientes
 *
 * Flujo:
 * 1. Busca todos los créditos del inversionista (ACTIVO/MOROSO)
 * 2. Por cada crédito, obtiene la cuota actual (próxima sin pagar)
 * 3. Por cada cuota, busca los pagos pendientes
 * 4. Si generateFalsePayment=true, llama a insertPagosCreditoInversionistas
 */

// 📅 Función helper para obtener el rango del mes actual
function obtenerRangoMesActual() {
  const hoy = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Guatemala" })
  );
  const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);

  return {
    inicio: primerDia.toISOString().slice(0, 10),
    fin: ultimoDia.toISOString().slice(0, 10),
    mes: primerDia.toLocaleString('es-GT', { month: 'long', year: 'numeric' })
  };
}
export async function obtenerCreditosConPagosPendientes(
  inversionistaId: number,
  generateFalsePayment: boolean = false
) {
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const rangoMesActual = obtenerRangoMesActual();

    console.log(`📆 Mes actual: ${rangoMesActual.inicio} - ${rangoMesActual.fin} (${rangoMesActual.mes})`);

    // 1️⃣ PASO 1: Obtener todos los créditos del inversionista (ESPEJO)
    const creditosInversionista = await db
      .select({
        creditoId: creditos_inversionistas_espejo.credito_id,
        inversionistaId: creditos_inversionistas_espejo.inversionista_id,
        montoAportado: creditos_inversionistas_espejo.monto_aportado,
        porcentajeParticipacion:
          creditos_inversionistas_espejo.porcentaje_participacion_inversionista,
        // Datos del crédito
        numeroCreditoSifco: creditos.numero_credito_sifco,
        capital: creditos.capital,
        deudaTotal: creditos.deudatotal,
        statusCredit: creditos.statusCredit,
        usuarioId: creditos.usuario_id,
        cuota: creditos.cuota,
        interes: creditos.cuota_interes,
        iva: creditos.iva_12,
      })
      .from(creditos_inversionistas_espejo)
      .innerJoin(
        creditos,
        eq(creditos_inversionistas_espejo.credito_id, creditos.credito_id)
      )
      .where(
        and(
          eq(creditos_inversionistas_espejo.inversionista_id, inversionistaId),
          inArray(creditos.statusCredit, ["ACTIVO", "MOROSO", "PENDIENTE_CANCELACION", "EN_CONVENIO","INCOBRABLE"]),
          eq(creditos_inversionistas_espejo.status, "completado"),
          lt(creditos_inversionistas_espejo.fecha_inicio_participacion, rangoMesActual.inicio)
        )
      );

    console.log(
      `📊 Créditos encontrados para inversionista ${inversionistaId}:`,
      creditosInversionista.length
    );

    // 2️⃣ PASO 2: Por cada crédito, buscar la PRIMERA cuota NO LIQUIDADA
    const creditosConPagos = await Promise.all(
      creditosInversionista.map(async (credito) => {

        // 🆕 PASO 0: Verificar si ESTE CRÉDITO tiene pagos pendientes de liquidar
        console.log(`\n🔍 ========== VERIFICANDO PAGOS PENDIENTES DEL CRÉDITO ${credito.creditoId} ==========`);

        const pagosPendientesCredito = await db
          .select()
          .from(pagos_credito_inversionistas_espejo)
          .where(
            and(
              eq(pagos_credito_inversionistas_espejo.credito_id, credito.creditoId),
              eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionistaId),
              eq(pagos_credito_inversionistas_espejo.estado_liquidacion, "NO_LIQUIDADO")
            )
          );

        if (pagosPendientesCredito.length > 0) {
          console.log(
            `⚠️ El crédito ${credito.creditoId} tiene ${pagosPendientesCredito.length} pago(s) pendientes de liquidar`
          );
          console.log(`   NO se procesará este crédito hasta que se liquiden`);
          console.log(`========================================\n`);

          // 🔥 SALTAR ESTE CRÉDITO
          return null;
        }

        console.log(`✅ El crédito ${credito.creditoId} NO tiene pagos pendientes, continuando...`);
        console.log(`========================================\n`);

        // 📅 Buscar la PRIMERA cuota NO LIQUIDADA con sus PAGOS
        const cuotaConPagos = await db
          .select({
            // Campos de la cuota
            cuotaId: cuotas_credito.cuota_id,
            numeroCuota: cuotas_credito.numero_cuota,
            fechaVencimiento: cuotas_credito.fecha_vencimiento,
            pagadoCuota: cuotas_credito.pagado,
            liquidadoInversionistas: cuotas_credito.liquidado_inversionistas,
            fechaLiquidacion: cuotas_credito.fecha_liquidacion_inversionistas,
            // Campos del pago
            pagoId: pagos_credito.pago_id,
            fechaPago: pagos_credito.fecha_pago,
            montoBoleta: pagos_credito.monto_boleta,
            abonoCapital: pagos_credito.abono_capital,
            abonoInteres: pagos_credito.abono_interes,
            abonoIva: pagos_credito.abono_iva_12,
            abonoSeguro: pagos_credito.abono_seguro,
            abonoGps: pagos_credito.abono_gps,
            validationStatus: pagos_credito.validationStatus,
            pagadoPago: pagos_credito.pagado,
          })
          .from(cuotas_credito)
          .innerJoin(
            pagos_credito,
            eq(cuotas_credito.cuota_id, pagos_credito.cuota_id)
          )
          .where(
            and(
              eq(cuotas_credito.credito_id, credito.creditoId),
              eq(cuotas_credito.liquidado_inversionistas, false) // 🔥 NO liquidada
            )
          )
          .orderBy(cuotas_credito.numero_cuota, pagos_credito.fecha_pago);

        console.log(
          `🔍 Crédito ${credito.creditoId}: Cuotas NO liquidadas encontradas:`,
          cuotaConPagos.length
        );

        // ⚠️ Si no hay registros, este crédito no tiene cuotas pendientes
        if (cuotaConPagos.length === 0) {
          console.log(
            `⚠️ Crédito ${credito.creditoId}: No hay cuotas pendientes con pagos`
          );
          return null;
        }

        // 🎯 Tomar la PRIMERA cuota (la de menor número sin liquidar)
        const primeraFila = cuotaConPagos[0];
        const numeroCuota = primeraFila.numeroCuota;
        const fechaVencimiento = primeraFila.fechaVencimiento;
        const cuotaId = primeraFila.cuotaId;

        console.log(
          `📅 Crédito ${credito.creditoId}, Cuota ${numeroCuota}: fecha_vencimiento = ${fechaVencimiento}`
        );


        console.log(
          `✅ Crédito ${credito.creditoId}, Cuota ${numeroCuota}: Es de mes anterior (${fechaVencimiento}), se PROCESA`
        );

        // Filtrar solo los pagos de la primera cuota
        const pagosDeLaCuota = cuotaConPagos.filter(
          (row) => row.numeroCuota === numeroCuota
        );

        console.log(
          `💰 Crédito ${credito.creditoId}, Cuota ${numeroCuota}: ${pagosDeLaCuota.length} pagos encontrados`
        );

        // 4️⃣ PASO 4: Si generateFalsePayment=true, generar distribución Y LIQUIDAR
        if (generateFalsePayment) {
          console.log(
            `🚀 Generando distribución de pagos para crédito ${credito.creditoId}...`
          );

          const primerPago = pagosDeLaCuota[0];
          const cuotaPagada = primeraFila.pagadoCuota ?? false;

          console.log(
            `  📊 Cuota ${numeroCuota} - Estado pagado: ${cuotaPagada ? 'SÍ' : 'NO'}`
          );

          try {
            console.log(
              `  📝 Procesando distribución con pago ${primerPago.pagoId} del crédito ${credito.creditoId}...`
            );

            await insertPagosCreditoInversionistas(
              primerPago.pagoId,
              credito.creditoId,
              false,
              false,
              true,
              inversionistaId
            );

            console.log(
              `  ✅ Distribución completada correctamente (cuota pagada: ${cuotaPagada})`
            );

            // 🆕 MARCAR LA CUOTA COMO LIQUIDADA
            console.log(
              `  🔄 Marcando cuota ${cuotaId} como liquidada...`
            );

            await db
              .update(cuotas_credito)
              .set({
                liquidado_inversionistas: true,
                fecha_liquidacion_inversionistas: new Date(),
              })
              .where(eq(cuotas_credito.cuota_id, cuotaId));

            console.log(
              `  ✅ Cuota ${numeroCuota} marcada como liquidada`
            );

          } catch (error) {
            console.error(
              `  ❌ Error procesando distribución del pago ${primerPago.pagoId}:`,
              error
            );
          }
        }

        // 5️⃣ PASO 5: Retornar información estructurada
        return {
          credito: {
            creditoId: credito.creditoId,
            numeroCreditoSifco: credito.numeroCreditoSifco,
            capital: credito.capital,
            deudaTotal: credito.deudaTotal,
            statusCredit: credito.statusCredit,
            montoAportado: credito.montoAportado,
            porcentajeParticipacion: credito.porcentajeParticipacion,
          },
          cuotaActual: {
            cuotaId: cuotaId,
            numeroCuota: numeroCuota,
            fechaVencimiento: fechaVencimiento,
            pagado: primeraFila.pagadoCuota,
            liquidadoInversionistas: primeraFila.liquidadoInversionistas,
            fechaLiquidacion: primeraFila.fechaLiquidacion,
            montoCuota: credito.cuota,
          },
          pagosEncontrados: pagosDeLaCuota.map((row) => ({
            pagoId: row.pagoId,
            creditoId: credito.creditoId,
            cuotaId: row.cuotaId,
            fechaPago: row.fechaPago,
            montoBoleta: row.montoBoleta,
            abonoCapital: row.abonoCapital,
            abonoInteres: row.abonoInteres,
            abonoIva: row.abonoIva,
            abonoSeguro: row.abonoSeguro,
            abonoGps: row.abonoGps,
            validationStatus: row.validationStatus,
            pagado: row.pagadoPago,
          })),
        };
      })
    );

    // 6️⃣ PASO 6: Filtrar nulls
    const creditosConCuotasPendientes = creditosConPagos.filter(
      (c) => c !== null
    );

    console.log(
      `✅ Total créditos con cuotas de meses anteriores pendientes: ${creditosConCuotasPendientes.length}`
    );

    return {
      success: true,
      inversionistaId,
      totalCreditosConCuotas: creditosConCuotasPendientes.length,
      data: creditosConCuotasPendientes,
      pagosGenerados: generateFalsePayment,
      mesActualExcluido: rangoMesActual,
    };
  } catch (error: any) {
    console.error("❌ Error en obtenerCreditosConPagosPendientes:", error);
    return {
      success: false,
      error: error.message,
      data: [],
    };
  }
}

// ============================================================
// calcularYRegistrarPagosEspejo
// ============================================================

/**
 * Calcula y registra los pagos espejo de un inversionista SIN actualizar
 * `creditos_inversionistas_espejo`.
 *
 * Diferencia clave vs `obtenerCreditosConPagosPendientes` con generateFalsePayment=true:
 *  - Llama a `insertPagosCreditoInversionistas` con `updateCredito = false`
 *    → Solo hace el upsert en `pagos_credito_inversionistas_espejo`
 *    → NO toca `creditos_inversionistas_espejo`
 *  - Sí marca la cuota como `liquidado_inversionistas = true` en `cuotas_credito`
 *    para evitar reprocesar la misma cuota en ejecuciones futuras.
 *
 * @param inversionistaId - ID del inversionista a procesar
 */
export async function calcularYRegistrarPagosEspejo(inversionistaId: number, fechaCalculo?: Date) {
  // Este proceso genera los pagos que le corresponden al inversionista por cada
  // crédito en el que participa, sin todavía descontar capital ni marcar nada como liquidado.
  // Es el primer paso antes de la liquidación formal.
  try {
    const rangoMesActual = obtenerRangoMesActual();
    console.log(
      `\n🚀 [calcularYRegistrarPagosEspejo] Iniciando para inversionista ${inversionistaId}`
    );
    console.log(
      `📆 Mes actual: ${rangoMesActual.inicio} - ${rangoMesActual.fin}`
    );
    if (fechaCalculo) {
      console.log(`📅 Fecha de cálculo override: ${fechaCalculo.toISOString()}`);
    }

    // Inicio del período a procesar: usa el mes de fechaCalculo si viene,
    // si no el mes actual. Solo participaciones anteriores a este inicio
    // deben generar pagos en este período (regla: compra del mes → paga desde el mes siguiente).
    const baseCalculo = fechaCalculo ?? new Date();
    const inicioPeriodo = new Date(
      baseCalculo.getUTCFullYear(),
      baseCalculo.getUTCMonth(),
      1
    ).toISOString().slice(0, 10);
    console.log(`📅 Inicio de período para filtro: ${inicioPeriodo}`);

    // Paso 1: Se buscan todos los créditos en los que este inversionista participa
    // y que aún están activos (pueden estar al día, en mora, en proceso de cancelación, etc.).
    const creditosInversionista = await db
      .select({
        creditoId: creditos_inversionistas_espejo.credito_id,
        inversionistaId: creditos_inversionistas_espejo.inversionista_id,
        montoAportado: creditos_inversionistas_espejo.monto_aportado,
        porcentajeParticipacion:
          creditos_inversionistas_espejo.porcentaje_participacion_inversionista,
        numeroCreditoSifco: creditos.numero_credito_sifco,
        capital: creditos.capital,
        deudaTotal: creditos.deudatotal,
        statusCredit: creditos.statusCredit,
        cuota: creditos.cuota,
      })
      .from(creditos_inversionistas_espejo)
      .innerJoin(
        creditos,
        eq(creditos_inversionistas_espejo.credito_id, creditos.credito_id)
      )
      .where(
        and(
          eq(creditos_inversionistas_espejo.inversionista_id, inversionistaId),
          lt(creditos_inversionistas_espejo.fecha_inicio_participacion, inicioPeriodo),
          inArray(creditos.statusCredit, [
            "ACTIVO",
            "MOROSO",
            "PENDIENTE_CANCELACION",
            "EN_CONVENIO",
            "CANCELADO",
            "INCOBRABLE",
          ])
        )
      );

    console.log(
      `📊 Créditos encontrados: ${creditosInversionista.length}`
    );

    // Paso 2: Por cada crédito encontrado, se busca la primera cuota que aún no
    // le ha sido pagada al inversionista. Se procesa una cuota a la vez para evitar
    // registrar pagos duplicados o fuera de orden.
    const resultados = await Promise.all(
      creditosInversionista.map(async (credito) => {
        console.log(
          `\n🔍 Verificando crédito ${credito.creditoId}...`
        );

        // Si ya existe un pago generado y pendiente de liquidar para este crédito,
        // se omite para no duplicarlo. Hay que liquidar primero antes de generar otro.
        const pagosPendientes = await db
          .select()
          .from(pagos_credito_inversionistas_espejo)
          .where(
            and(
              eq(
                pagos_credito_inversionistas_espejo.credito_id,
                credito.creditoId
              ),
              eq(
                pagos_credito_inversionistas_espejo.inversionista_id,
                inversionistaId
              ),
              eq(
                pagos_credito_inversionistas_espejo.estado_liquidacion,
                "NO_LIQUIDADO"
              )
            )
          );

        if (pagosPendientes.length > 0) {
          console.log(
            `⚠️  Crédito ${credito.creditoId} tiene ${pagosPendientes.length} pago(s) NO_LIQUIDADO → se omite`
          );
          return null;
        }

        const selectCuotaPagos = {
          cuotaId: cuotas_credito.cuota_id,
          numeroCuota: cuotas_credito.numero_cuota,
          fechaVencimiento: cuotas_credito.fecha_vencimiento,
          pagadoCuota: cuotas_credito.pagado,
          liquidadoInversionistas: cuotas_credito.liquidado_inversionistas,
          pagoId: pagos_credito.pago_id,
          fechaPago: pagos_credito.fecha_pago,
          montoBoleta: pagos_credito.monto_boleta,
          abonoCapital: pagos_credito.abono_capital,
          abonoInteres: pagos_credito.abono_interes,
          abonoIva: pagos_credito.abono_iva_12,
          validationStatus: pagos_credito.validationStatus,
        };

        // Buscar la primera cuota NO liquidada con sus pagos
        let cuotaConPagos = await db
          .select(selectCuotaPagos)
          .from(cuotas_credito)
          .innerJoin(
            pagos_credito,
            eq(cuotas_credito.cuota_id, pagos_credito.cuota_id)
          )
          .where(
            and(
              eq(cuotas_credito.credito_id, credito.creditoId),
              eq(cuotas_credito.liquidado_inversionistas, false)
            )
          )
          .orderBy(cuotas_credito.numero_cuota, pagos_credito.fecha_pago);

        // Fallback: si todas las cuotas ya están liquidadas, tomar la última cuota
        // con pagos (mayor numero_cuota). Esto permite reflejar pagos nuevos que
        // entraron a una cuota ya marcada como liquidada para el inversionista.
        let esFallback = false;
        if (cuotaConPagos.length === 0) {
          cuotaConPagos = await db
            .select(selectCuotaPagos)
            .from(cuotas_credito)
            .innerJoin(
              pagos_credito,
              eq(cuotas_credito.cuota_id, pagos_credito.cuota_id)
            )
            .where(eq(cuotas_credito.credito_id, credito.creditoId))
            .orderBy(desc(cuotas_credito.numero_cuota), desc(pagos_credito.fecha_pago));

          if (cuotaConPagos.length > 0) {
            esFallback = true;
            console.log(
              `↩️  Crédito ${credito.creditoId}: fallback → usando última cuota ${cuotaConPagos[0].numeroCuota} (todas liquidadas)`
            );
          }
        }

        if (cuotaConPagos.length === 0) {
          console.log(
            `⚠️  Crédito ${credito.creditoId}: sin cuotas con pagos`
          );
          return null;
        }

        const primeraFila = cuotaConPagos[0];
        const { numeroCuota } = primeraFila;
        const pagosDeLaCuota = cuotaConPagos.filter(
          (r) => r.numeroCuota === numeroCuota
        );

        console.log(
          `✅ Crédito ${credito.creditoId}, Cuota ${numeroCuota}: ${pagosDeLaCuota.length} pago(s) → procesando...`
        );

        // Paso 3: Se calcula el monto proporcional que le corresponde al inversionista
        // según su porcentaje de participación en este crédito, y se registra en la
        // tabla de pagos espejo. En este punto aún no se toca el balance del crédito
        // ni se marca la cuota como liquidada — eso ocurre en la liquidación formal.
        // También se valida que el monto aportado coincida con el histórico registrado
        // para detectar inconsistencias antes de confirmar el registro.
        try {
          await insertPagosCreditoInversionistas(
            pagosDeLaCuota[0].pagoId,
            credito.creditoId,
            false, // excludeCube
            false, // cuotaPagada
            false, // updateCredito ← omite el UPDATE a creditos_inversionistas_espejo
            inversionistaId,
            fechaCalculo,
            true, // allowClampAbonoCapital ← cualquier crédito casi liquidado cierra a 0
          );

          console.log(
            `  ✅ Upsert completado para crédito ${credito.creditoId}, cuota ${numeroCuota}`
          );

          return {
            creditoId: credito.creditoId,
            numeroCreditoSifco: credito.numeroCreditoSifco,
            cuotaProcesada: numeroCuota,
            pagosRegistrados: pagosDeLaCuota.length,
          };
        } catch (err: any) {
          console.error(
            `  ❌ Error procesando crédito ${credito.creditoId}:`,
            err
          );
          return {
            error: true as const,
            creditoId: credito.creditoId,
            numeroCreditoSifco: credito.numeroCreditoSifco,
            mensaje: err?.message ?? "Error desconocido",
          };
        }
      })
    );

    const procesados = resultados.filter((r) => r !== null && !("error" in r));
    const fallidos = resultados.filter((r) => r !== null && "error" in r);

    console.log(
      `\n✅ [calcularYRegistrarPagosEspejo] Completado. Procesados: ${procesados.length}, Fallidos: ${fallidos.length}`
    );

    return {
      success: true,
      inversionistaId,
      totalCreditosProcesados: procesados.length,
      totalCreditosFallidos: fallidos.length,
      pagosGenerados: true,
      data: procesados,
      fallidos,
    };
  } catch (error: any) {
    console.error("❌ Error en calcularYRegistrarPagosEspejo:", error);
    return {
      success: false,
      error: error.message,
      data: [],
    };
  }
}



/**
 * Actualiza los pagos NO_LIQUIDADO en pagos_credito_inversionistas_espejo
 * para un crédito dado (por numero_credito_sifco).
 * Recibe abono_capital, abono_interes, abono_iva y los aplica a todos
 * los registros NO_LIQUIDADO de ese crédito.
 */
export async function updatePagosEspejoPorCredito(
  numero_credito_sifco: string,
  nombre_inversionista: string,
  abono_capital?: number,
  abono_interes?: number,
  abono_iva?: number,
  nombre_cliente?: string
) {
  // 1. Buscar el crédito por numero_credito_sifco
  let [credito] = await db
    .select({
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
    })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco.trim()))
    .limit(1);

  // Fallback: buscar por nombre de cliente (fuzzy)
  if (!credito && nombre_cliente) {
    const clienteNorm = removeAccents(nombre_cliente.trim().toLowerCase());
    const palabras = clienteNorm.split(/\s+/).filter(p => p.length > 2);

    if (palabras.length > 0) {
      const candidatos = await db
        .select({
          credito_id: creditos.credito_id,
          numero_credito_sifco: creditos.numero_credito_sifco,
          nombre_cliente: usuarios.nombre,
        })
        .from(creditos)
        .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
        .where(
          sql`translate(lower(${usuarios.nombre}), 'áéíóúàèìòùäëïöüâêîôûñ', 'aeiouaeiouaeiouaeioun') ILIKE ${"%" + palabras.join("%") + "%"}`
        )
        .limit(5);

      if (candidatos.length === 1) {
        credito = candidatos[0];
      } else if (candidatos.length > 1) {
        // Elegir el que más palabras coincida
        let mejor = candidatos[0];
        let mejorScore = 0;
        for (const c of candidatos) {
          const nombreNorm = removeAccents((c.nombre_cliente ?? "").toLowerCase());
          const score = palabras.filter(p => nombreNorm.includes(p)).length;
          if (score > mejorScore) {
            mejorScore = score;
            mejor = c;
          }
        }
        credito = mejor;
      }
    }
  }

  if (!credito) {
    throw new Error(`No se encontró crédito con numero_credito_sifco: "${numero_credito_sifco}"${nombre_cliente ? ` ni por cliente: "${nombre_cliente}"` : ""}`);
  }

  // 2. Buscar inversionista por nombre (sin tildes, sin mayúsculas)
  const invNorm = removeAccents(nombre_inversionista.trim().toLowerCase());
  const [inversionista] = await db
    .select({ inversionista_id: inversionistas.inversionista_id, nombre: inversionistas.nombre })
    .from(inversionistas)
    .where(
      sql`translate(lower(${inversionistas.nombre}), 'áéíóúàèìòùäëïöüâêîôûñ', 'aeiouaeiouaeiouaeioun') ILIKE ${"%" + invNorm + "%"}`
    )
    .limit(1);

  if (!inversionista) {
    throw new Error(`No se encontró inversionista con nombre: "${nombre_inversionista}"`);
  }

  // Validar que el inversionista encontrado sea el correcto (evitar falsos positivos del ILIKE)
  const invNombreNorm = removeAccents(inversionista.nombre.toLowerCase());
  const inputNorm = removeAccents(nombre_inversionista.trim().toLowerCase());
  const palabrasInput = inputNorm.split(/\s+/).filter(p => p.length > 2);
  const matchCount = palabrasInput.filter(p => invNombreNorm.includes(p)).length;
  if (matchCount < Math.ceil(palabrasInput.length * 0.5)) {
    throw new Error(`Inversionista encontrado "${inversionista.nombre}" no coincide suficiente con "${nombre_inversionista}"`);
  }

  // 3. Armar el set dinámico solo con los campos que vienen
  const setData: Record<string, any> = {};
  if (abono_capital !== undefined) setData.abono_capital = abono_capital.toString();
  if (abono_interes !== undefined) setData.abono_interes = abono_interes.toString();
  if (abono_iva !== undefined) setData.abono_iva_12 = abono_iva.toString();

  if (Object.keys(setData).length === 0) {
    throw new Error("Debe enviar al menos un campo a actualizar (abono_capital, abono_interes, abono_iva)");
  }

  // 4. Intentar actualizar registros existentes
  setData.updated_at = new Date();
  const result = await db
    .update(pagos_credito_inversionistas_espejo)
    .set(setData)
    .where(
      and(
        eq(pagos_credito_inversionistas_espejo.credito_id, credito.credito_id),
        eq(pagos_credito_inversionistas_espejo.estado_liquidacion, "NO_LIQUIDADO"),
        eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionista.inversionista_id)
      )
    );

  const updatedCount = result.rowCount ?? 0;

  return {
    success: true,
    message: updatedCount > 0
      ? `Pagos espejo actualizados para SIFCO: ${credito.numero_credito_sifco}, inversionista "${inversionista.nombre}"`
      : `Sin registros espejo NO_LIQUIDADO para SIFCO: ${credito.numero_credito_sifco}, inversionista "${inversionista.nombre}" - saltado`,
    credito_id: credito.credito_id,
    numero_credito_sifco: credito.numero_credito_sifco,
    inversionista_id: inversionista.inversionista_id,
    nombre_inversionista: inversionista.nombre,
    registrosActualizados: updatedCount,
  };
}

/**
 * Obtiene los abonos de una cuota específica de un crédito por numero_credito_sifco.
 */
export async function getAbonosPorCuota(
  numero_credito_sifco: string,
  numero_cuota: number
) {
  // 1. Buscar el crédito por SIFCO
  const [credito] = await db
    .select({ credito_id: creditos.credito_id })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
    .limit(1);

  if (!credito) {
    throw new Error(`No se encontró el crédito con SIFCO: ${numero_credito_sifco}`);
  }

  // 2. Buscar la(s) cuota(s) con ese numero_cuota
  // Nota: pueden existir cuotas duplicadas con el mismo numero_cuota para un mismo
  // credito (p. ej. tras regeneraciones de calendario). Se consideran todas para
  // no perder pagos vinculados al cuota_id "viejo".
  const cuotasMatch = await db
    .select({ cuota_id: cuotas_credito.cuota_id })
    .from(cuotas_credito)
    .where(
      and(
        eq(cuotas_credito.credito_id, credito.credito_id),
        eq(cuotas_credito.numero_cuota, numero_cuota)
      )
    );

  if (cuotasMatch.length === 0) {
    throw new Error(`No se encontró la cuota ${numero_cuota} para el crédito ${numero_credito_sifco}`);
  }

  const cuotaIds = cuotasMatch.map((c) => c.cuota_id);

  // 3. Buscar los pagos de esas cuotas
  const pagos = await db
    .select({
      pago_id: pagos_credito.pago_id,
      abono_capital: pagos_credito.abono_capital,
      abono_iva_12: pagos_credito.abono_iva_12,
      abono_interes: pagos_credito.abono_interes,
      membresias_pago: pagos_credito.membresias_pago,
      abono_seguro: pagos_credito.abono_seguro,
      abono_gps: pagos_credito.abono_gps,
      fecha_pago: pagos_credito.fecha_pago,
    })
    .from(pagos_credito)
    .where(
      and(
        eq(pagos_credito.credito_id, credito.credito_id),
        inArray(pagos_credito.cuota_id, cuotaIds)
      )
    );

  // 4. Sumatoria de todos los pagos
  let total_abono_capital = Big(0);
  let total_abono_iva_12 = Big(0);
  let total_abono_interes = Big(0);
  let total_membresias_pago = Big(0);
  let total_abono_seguro = Big(0);
  let total_abono_gps = Big(0);

  for (const p of pagos) {
    total_abono_capital = total_abono_capital.plus(p.abono_capital || "0");
    total_abono_iva_12 = total_abono_iva_12.plus(p.abono_iva_12 || "0");
    total_abono_interes = total_abono_interes.plus(p.abono_interes || "0");
    total_membresias_pago = total_membresias_pago.plus(p.membresias_pago || "0");
    total_abono_seguro = total_abono_seguro.plus(p.abono_seguro || "0");
    total_abono_gps = total_abono_gps.plus(p.abono_gps || "0");
  }

  return {
    success: true,
    numero_credito_sifco,
    numero_cuota,
    total_pagos: pagos.length,
    abono_capital: total_abono_capital.toFixed(2),
    abono_iva_12: total_abono_iva_12.toFixed(2),
    abono_interes: total_abono_interes.toFixed(2),
    membresias_pago: total_membresias_pago.toFixed(2),
    abono_seguro: total_abono_seguro.toFixed(2),
    abono_gps: total_abono_gps.toFixed(2),
  };
}
