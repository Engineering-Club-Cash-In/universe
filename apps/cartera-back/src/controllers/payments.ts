import { db } from "../database/index";
import {
  creditos,
  pagos_credito,
  usuarios,
  inversionistas,
  creditos_inversionistas,
  pagos_credito_inversionistas,
  boletas,
  cuotas_credito,
} from "../database/db/schema";
import { desc, gte } from "drizzle-orm";
import Big from "big.js";
import { z } from "zod";
import { and, eq, lt, sql, asc, lte, inArray } from "drizzle-orm";
import {
  processAndReplaceCreditInvestors,
  processAndReplaceCreditInvestorsReverse,
} from "./investor";
import { updateMora } from "./latefee";
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
      })
      .from(pagos_credito)
      .innerJoin(creditos, eq(pagos_credito.credito_id, creditos.credito_id))
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(
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
  cuotaPagada:boolean = false
) {
  console.log(
    "\n🔍 ========== INICIO insertPagosCreditoInversionistas =========="
  );
  console.log("📥 Parámetros:");
  console.log(`   pago_id: ${pago_id}`);
  console.log(`   credito_id: ${credito_id}`);
  console.log(`   excludeCube: ${excludeCube}`);

  // 1. Buscar inversionistas del crédito
  const inversionistasData = await db.query.creditos_inversionistas.findMany({
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
        .select({ nombre: inversionistas.nombre })
        .from(inversionistas)
        .where(eq(inversionistas.inversionista_id, inv.inversionista_id));
      return {
        ...inv,
        nombre: invRow?.nombre ?? "",
      };
    })
  );

  console.log("\n👥 Inversionistas con nombres:");
  inversionistasWithName.forEach((inv, idx) => {
    console.log(`   ${idx + 1}. ${inv.nombre} (ID: ${inv.inversionista_id})`);
  });

  if (!inversionistasWithName.length) {
    console.error("❌ No se encontraron inversionistas");
    throw new Error("No se encontraron inversionistas");
  }

  const filteredInversionistas = excludeCube
    ? inversionistasWithName.filter(
        (inv) =>
          inv.nombre.trim().toLowerCase() !==
          "cube investments s.a.".toLowerCase()
      )
    : inversionistasWithName;

  console.log(
    `\n🔍 Inversionistas después de filtrar (excludeCube=${excludeCube}): ${filteredInversionistas.length}`
  );
  filteredInversionistas.forEach((inv, idx) => {
    console.log(`   ${idx + 1}. ${inv.nombre}`);
  });

  const indexMayorCuota = filteredInversionistas.reduce(
    (maxIdx, inv, idx, arr) =>
      new Big(inv.cuota_inversionista ?? 0).gt(
        new Big(arr[maxIdx].cuota_inversionista ?? 0)
      )
        ? idx
        : maxIdx,
    0
  );

  console.log(`\n🏆 Mayor cuota encontrada:`);
  console.log(`   Índice: ${indexMayorCuota}`);
  console.log(
    `   Inversionista: ${filteredInversionistas[indexMayorCuota].nombre}`
  );
  console.log(
    `   Valor cuota: ${filteredInversionistas[indexMayorCuota].cuota_inversionista}`
  );

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

    const bigInteres = isCube
      ? new Big(inv.monto_cash_in ?? 0)
      : new Big(inv.monto_inversionista);

    const bigIVA = isCube
      ? new Big(inv.iva_cash_in ?? 0)
      : new Big(inv.iva_inversionista);

    console.log(
      `   💵 Interés a usar: ${bigInteres.toString()} (${isCube ? "monto_cash_in" : "monto_inversionista"})`
    );
    console.log(
      `   🧾 IVA a usar: ${bigIVA.toString()} (${isCube ? "iva_cash_in" : "iva_inversionista"})`
    );

    console.log(
      `   💰 cuota_inversionista original: ${inv.cuota_inversionista}`
    );

    let abono_capital = isCube
      ? new Big(inv?.cuota_inversionista ?? 0)
      : new Big(inv.cuota_inversionista ?? 0);

    console.log(`   💰 abono_capital inicial: ${abono_capital.toString()}`);

    const totalMontos = new Big(inv.monto_cash_in ?? 0).plus(
      new Big(inv.monto_inversionista ?? 0)
    );
    const totalIVA = new Big(inv.iva_cash_in ?? 0).plus(
      new Big(inv.iva_inversionista ?? 0)
    );

    console.log(
      `   📊 totalMontos (cash_in + inversionista): ${totalMontos.toString()}`
    );
    console.log(
      `   📊 totalIVA (cash_in + inversionista): ${totalIVA.toString()}`
    );

    if (idx === indexMayorCuota && !excludeCube) {
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

      console.log(
        `   ✅ abono_capital después de restas: ${abono_capital.toString()}`
      );
    } else {
      console.log(`   📌 Inversionista regular - Solo resta interés e IVA`);
      console.log(`   📉 Restando:`);
      console.log(`      - totalIVA: ${totalIVA.toString()}`);
      console.log(`      - totalMontos: ${totalMontos.toString()}`);

      abono_capital = abono_capital.minus(totalIVA).minus(totalMontos);

      console.log(
        `   ✅ abono_capital después de restas: ${abono_capital.toString()}`
      );
    }

    console.log(`\n   🔄 Llamando a processAndReplaceCreditInvestors:`);
    console.log(`      credito_id: ${credito_id}`);
    console.log(`      abono_capital: ${abono_capital.toNumber()}`);
    console.log(`      addition: false (RESTA)`);
    console.log(`      inversionista_id: ${inv.inversionista_id}`);

  if (!cuotaPagada) {  await processAndReplaceCreditInvestors(
      credito_id,
      abono_capital.toNumber(),
      false,
      inv.inversionista_id
    );}

    console.log(`   📊 Porcentajes:`);
    console.log(`      porcentaje_cash_in: ${inv.porcentaje_cash_in}`);
    console.log(
      `      porcentaje_participacion_inversionista: ${inv.porcentaje_participacion_inversionista}`
    );

    const resultado = {
      pago_id,
      inversionista_id: inv.inversionista_id,
      credito_id,
      abono_capital: abono_capital.toString(),
      abono_interes: bigInteres.toString(),
      abono_iva_12: bigIVA.toString(),
      porcentaje_participacion: isCube
        ? inv.porcentaje_cash_in
        : inv.porcentaje_participacion_inversionista,
      cuota: currentPago?.cuota ?? "0",
      estado_liquidacion: "NO_LIQUIDADO" as const,
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

  // 4. Insertar todos los registros
  const resolvedInserts = await Promise.all(inserts);
await db
  .insert(pagos_credito_inversionistas)
  .values(resolvedInserts)
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

  return resolvedInserts;
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
  insertPagosCreditoInversionistas(pago_id, credito_id, true); // Excluir Cube Investments
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
  const hoy = new Date();
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
  inversionistaId?: number;
  usuarioNombre?: string; // 🆕 nuevo filtro
  validationStatus?: string; // 🆕 nuevo filtro
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
    inversionistaId,
    usuarioNombre,
    validationStatus,
  } = options;

  try {
    const offset = (page - 1) * pageSize;

    // 🔹 Construcción dinámica de filtros
    const whereClauses: string[] = [];

    if (numeroCredito)
      whereClauses.push(`c.numero_credito_sifco = '${numeroCredito}'`);
    if (usuarioNombre) whereClauses.push(`u.nombre ILIKE '%${usuarioNombre}%'`);
    console.log("dia", dia);
    console.log("mes", mes);
    console.log("anio", anio);

    // ✅ Convertir a zona horaria de Guatemala (America/Guatemala = UTC-6)
    if (anio) whereClauses.push(`EXTRACT(YEAR FROM p.fecha_pago) = ${anio}`);
    if (mes) whereClauses.push(`EXTRACT(MONTH FROM p.fecha_pago) = ${mes}`);
    if (dia) whereClauses.push(`EXTRACT(DAY FROM p.fecha_pago) = ${dia}`);
    whereClauses.push(
      `p.validation_status IN ('validated', 'pending' ,'reset', 'capital')`
    );

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

    // ✅ Solo créditos activos
    whereClauses.push(
      `c."statusCredit" IN ('ACTIVO', 'MOROSO','PENDIENTE_CANCELACION','EN_CONVENIO')`
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
        TO_CHAR(p.fecha_pago, 'YYYY-MM-DD HH24:MI:SS') AS "fechaPago",

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
        TO_CHAR(p.fecha_boleta::timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD') AS "fechaBoleta",

        -- 👤 Nombre del asesor que registró
        ase.nombre AS "registerByNombre",

        -- 💰 Abonos del pago
        p.abono_capital AS "abono_capital",
        p.abono_interes AS "abono_interes",
        p.abono_iva_12 AS "abono_iva_12",
        p.abono_seguro AS "abono_seguro",
        p.abono_gps AS "abono_gps",
        p.validation_status AS "validation_status",

        -- 💳 Info del crédito
        json_build_object(
          'creditoId', c.credito_id,
          'numeroCreditoSifco', c.numero_credito_sifco,
          'capital', c.capital,
          'deudaTotal', c.deudatotal,
          'statusCredit', c."statusCredit",
          'porcentajeInteres', c.porcentaje_interes,
          'fechaCreacion', c.fecha_creacion
        ) AS "credito",

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

        -- 📸 Boleta asociada
        (
          SELECT json_build_object(
            'boletaId', b.id,
            'urlBoleta', b.url_boleta
          )
          FROM cartera.boletas b
          WHERE b.pago_id = p.pago_id
          LIMIT 1
        ) AS "boleta"

      FROM cartera.pagos_credito p
      LEFT JOIN cartera.creditos c ON c.credito_id = p.credito_id
      LEFT JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
      LEFT JOIN cartera.bancos b ON b.banco_id = p.banco_id
      LEFT JOIN cartera.cuentas_empresa ce ON ce.cuenta_id = p.cuenta_empresa_id
      LEFT JOIN cartera.asesores ase ON ase.email_cash_in = p.registerby
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
      registerByNombre: r.registerByNombre,
      observaciones: r.observaciones,
      abono_capital: r.abono_capital,
      abono_interes: r.abono_interes,
      abono_iva_12: r.abono_iva_12,
      abono_seguro: r.abono_seguro,
      validationStatus: r.validation_status,
      abono_gps: r.abono_gps,
      credito: r.credito,
      cuota: r.cuota,
      usuario: r.usuario,
      inversionistas: Array.isArray(r.inversionistas)
        ? r.inversionistas
        : JSON.parse(
            typeof r.inversionistas === "string" ? r.inversionistas : "[]"
          ),
      boleta: r.boleta,
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
        acc.totalConvenio += Number(r.pago_convenio || 0);
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
    console.log("Totales finales calculados:", totalesFinales);

    return {
      success: true,
      message: "📄 Datos de pagos obtenidos correctamente",
      page,
      pageSize,
      total: totalRecords,
      totalPages,
      data,
      totales: totalesFinales,
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
  const hoy = new Date();
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

    // 1️⃣ PASO 1: Obtener todos los créditos del inversionista
    const creditosInversionista = await db
      .select({
        creditoId: creditos_inversionistas.credito_id,
        inversionistaId: creditos_inversionistas.inversionista_id,
        montoAportado: creditos_inversionistas.monto_aportado,
        porcentajeParticipacion:
          creditos_inversionistas.porcentaje_participacion_inversionista,
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
      .from(creditos_inversionistas)
      .innerJoin(
        creditos,
        eq(creditos_inversionistas.credito_id, creditos.credito_id)
      )
      .where(
        and(
          eq(creditos_inversionistas.inversionista_id, inversionistaId),
          inArray(creditos.statusCredit, ["ACTIVO", "MOROSO", "PENDIENTE_CANCELACION", "EN_CONVENIO"])
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
          .from(pagos_credito_inversionistas)
          .where(
            and(
              eq(pagos_credito_inversionistas.credito_id, credito.creditoId),
              eq(pagos_credito_inversionistas.estado_liquidacion, "NO_LIQUIDADO")
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
              false
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
 