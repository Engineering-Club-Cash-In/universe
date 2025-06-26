import { db } from "../database/index";
import {
  creditos,
  pagos_credito,
  usuarios,
  inversionistas,
} from "../database/db/schema";

import Big from "big.js";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";

export const pagoSchema = z.object({
  credito_id: z.number().int().positive(),
  usuario_id: z.number().int().positive(),
  monto_boleta: z.number().min(0.01),
  fecha_pago: z.string(), // "YYYY-MM-DD"
  llamada: z.string().max(100).optional(),
  renuevo_o_nuevo: z.string().max(50).optional(),
  otros: z.string().optional(),
  mora: z.number().optional(),
  monto_boleta_cuota: z.number().optional(),
  numero_cuota: z.number().int().positive() ,
 observaciones: z.string().max(500).optional(),
  credito_sifco: z.string().max(50).optional(),
});
export const insertPayment = async ({ body, set }: { body: any; set: any }) => {
  // Step 1: Validate input
  const parseResult = pagoSchema.safeParse(body);
  if (!parseResult.success) {
    set.status = 400;
    return {
      message: "Validation failed",
      errors: parseResult.error.flatten().fieldErrors,
    };
  }
  const {
    credito_id,
    usuario_id,
    monto_boleta,
    fecha_pago,
    llamada,
    renuevo_o_nuevo,
    otros,
    mora,
    monto_boleta_cuota,
    numero_cuota,
    observaciones
  } = parseResult.data;

  // Step 2: Get credit and user
  const now = new Date();
    const mes_pagado = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [credito] = await db
    .select({
      credito_id: creditos.credito_id,
      cuota: creditos.cuota,
      capital: creditos.capital,
      porcentaje_interes: creditos.porcentaje_interes,
      iva_12: creditos.iva_12,
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      gps: creditos.gps,
      deudatotal: creditos.deudatotal,
      usuario_id: creditos.usuario_id,
      membresias: creditos.plazo, // Ajusta si tienes membresías separadas
      seguro_total: creditos.seguro_10_cuotas,
      seguro_facturado: creditos.seguro_10_cuotas, // Cambia si es diferente
      gps_facturado: creditos.gps,
      reserva: creditos.seguro_10_cuotas,
      inversionista_id: creditos.inversionista_id,
      cuota_interes:creditos.cuota_interes, // Asegúrate de que este campo exista
      cuota_interes_ci: creditos.cuota_cash_in, // Asegúrate de que este campo exista
      iva_ci: creditos.iva_cash_in, // Asegúrate de que este campo exista
      monto_asignado_inversionista: creditos.monto_asignado_inversionista, // Asegúrate de que este campo exista
      iva_inversionista: creditos.iva_inversionista, // Asegúrate de que este campo exista
    })
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id))
    .limit(1);

  if (!credito) {
    set.status = 404;
    return { message: "Credit not found" };
  }

  // Step 3: Get user saldo_a_favor
  const [usuario] = await db
    .select({ saldo_a_favor: usuarios.saldo_a_favor })
    .from(usuarios)
    .where(eq(usuarios.usuario_id,usuario_id));
  if (!usuario) {
    set.status = 404;
    return { message: "User not found" };
  }

  const saldo_a_favor = new Big(usuario.saldo_a_favor ?? 0);
  const montoBoleta = new Big(monto_boleta);
  const cuota = new Big(credito.cuota);
  const moraBig = new Big(mora ?? 0);
  const otrosBig = new Big(otros ?? 0);

  // Step 4: Only apply abonos if (monto_boleta - mora - otros) === cuota
  const montoEfectivo = montoBoleta.minus(moraBig).minus(otrosBig);

  let abono_capital = new Big(0);
  let abono_interes = new Big(0);
  let abono_iva_12 = new Big(0);
  let abono_interes_ci = new Big(0);
  let abono_iva_ci = new Big(0);
  let abono_seguro = new Big(0);
  let abono_gps = new Big(0);
  let pago_del_mes = new Big(0);
  let capital_restante = new Big(credito.capital);
  let interes_restante = new Big(credito.cuota_interes);
  let iva_12_restante = new Big(credito.iva_12);
  let seguro_restante = new Big(credito.seguro_10_cuotas);
  let gps_restante = new Big(credito.gps);
  let total_restante = new Big(credito.deudatotal);
  
  let pagado = false;
console.log("montoEfectivo:", montoEfectivo.toString());
  console.log("cuota:", cuota.toString());
  const montoDisponible = saldo_a_favor.plus(montoBoleta);
  if (montoDisponible.gte(cuota)) {
    console.log("Payment matches cuota, applying abonos...");
    // Real abonos from credit
    abono_interes = new Big(credito.cuota_interes_ci).add(credito.monto_asignado_inversionista); // Define your logic for interest
    abono_iva_12 = new Big(credito.iva_ci).add(credito.iva_inversionista); // Define your logic for IVA 12
    abono_seguro = new Big(credito.seguro_10_cuotas);
    abono_gps = new Big(credito.gps);
    abono_interes_ci = new Big(credito.cuota_interes_ci);
    abono_iva_ci = new Big(credito.iva_ci);
   abono_capital = cuota
  .minus(abono_interes)
  .minus(abono_iva_12)
  .minus(abono_seguro)
  .minus(abono_gps)
  .minus(credito.membresias ?? 0); // Define your logic for capital
  

    capital_restante = capital_restante.minus(abono_capital);
    interes_restante = interes_restante.minus(abono_interes);
    iva_12_restante = iva_12_restante.minus(abono_iva_12);
    seguro_restante = seguro_restante.minus(abono_seguro);
    gps_restante = gps_restante.minus(abono_gps);
    total_restante = total_restante.minus(montoBoleta);
    pagado = true;

    pago_del_mes = abono_capital
      .plus(abono_interes)
      .plus(abono_iva_12)
      .plus(abono_interes_ci)
      .plus(abono_iva_ci)
      .plus(abono_seguro)
      .plus(abono_gps); // Recomendado: guarda como string
  }
  if (capital_restante.lt(0)) {
    capital_restante = new Big(credito.capital);
  }
  // Step 5: Set facturacion based on inversionista
  let facturacion = "si";
  if (credito.inversionista_id) {
    const [inv] = await db
      .select({ emite_factura: inversionistas.emite_factura })
      .from(inversionistas)
      .where(eq(inversionistas.inversionista_id, credito.inversionista_id))
      .limit(1);
    if (inv && inv.emite_factura === false) {
      facturacion = "no";
    }
  }
  
// Usa el tipo inferido de Drizzle
type PagoCreditoInsert = typeof pagos_credito.$inferInsert;


const pagoInsert: PagoCreditoInsert = {
  credito_id: credito.credito_id,
  cuota: cuota.toString(),
  cuota_interes: credito.cuota_interes.toString(),  
  abono_capital: abono_capital.toString(),  
  abono_interes: abono_interes.toString(),
  abono_iva_12: abono_iva_12.toString(),
  abono_interes_ci: abono_interes_ci.toString(),
  abono_iva_ci: abono_iva_ci.toString(),
  abono_seguro: abono_seguro.toString(),
  abono_gps: abono_gps.toString(),
  pago_del_mes: pago_del_mes.toString(),
  monto_boleta: montoBoleta.toString(),
  capital_restante: capital_restante.toString(),
  interes_restante: interes_restante.toString(),
  iva_12_restante: iva_12_restante.toString(),
  seguro_restante: seguro_restante.toString(),
  gps_restante: gps_restante.toString(),
  total_restante: total_restante.toString(),
  numero_cuota:numero_cuota,
  llamada: llamada ?? "",
  fecha_pago,
  fecha_filtro: fecha_pago,
  renuevo_o_nuevo: renuevo_o_nuevo ?? "",
  tipoCredito: "",
  membresias: credito.membresias ?? 0,
  membresias_pago: credito.membresias ?? 0,
  membresias_mes: credito.membresias ?? 0,
  otros: otros ?? "",
  mora: mora?.toString() ?? "0",
  monto_boleta_cuota: montoBoleta?.toString() ?? "0",
  seguro_total: credito.seguro_total?.toString() ?? "0",
  pagado,
  facturacion,
  mes_pagado: mes_pagado ?? "",
  seguro_facturado: credito.seguro_facturado?.toString() ?? "0",
  gps_facturado: credito.gps_facturado?.toString() ?? "0",
  reserva: credito.reserva?.toString() ?? "0",
  observaciones: observaciones ?? "",
 
};

console.log("Pago a insertar:", pagoInsert);
const [pagoInsertado] = await db
  .insert(pagos_credito)
  .values(pagoInsert)
  .returning();
  console.log("")
  await db
  .update(creditos)
  .set({ deudatotal: total_restante.toString() , capital: capital_restante.toString() })
  .where(eq(creditos.credito_id,credito_id));


  // Step 7: Update user saldo_a_favor
  // If paid, subtract cuota from saldo_a_favor; else just add the pago
  let nuevoSaldoAFavor = saldo_a_favor.plus(montoBoleta);
  if (pagado) {
    nuevoSaldoAFavor = nuevoSaldoAFavor.minus(cuota);
  }
  await db
    .update(usuarios)
    .set({ saldo_a_favor: nuevoSaldoAFavor.toString() })
    .where(eq(usuarios.usuario_id, usuario_id));

  set.status = 201;
  return {
    message: pagado
      ? "Payment registered and abonos applied"
      : "Partial payment registered (saldo a favor updated)",
    pago: pagoInsertado,
    saldo_a_favor: nuevoSaldoAFavor.toString(),
  };
};
/**
 * Get all payments for a credit by SIFCO number, optionally filtered by payment date.
 * Always wrapped in a try/catch for robust error handling.
 * @param numero_credito_sifco Credit SIFCO number (string)
 * @param fecha_pago (optional) Payment date in 'YYYY-MM-DD'
 */
export async function getPagosByCreditoAndFecha(numero_credito_sifco: string, fecha_pago?: string) {
  try {
    // 1. Find the credit by SIFCO number
    const credito = await db.query.creditos.findFirst({
      where: (creditos, { eq }) => eq(creditos.numero_credito_sifco, numero_credito_sifco),
    });

    if (!credito) {
      return []; // Or return a custom object/message if preferred
    }

    // 2. Get payments by credit_id, filter by fecha_pago if provided
    const pagos = await db.query.pagos_credito.findMany({
      where: (pago, { eq, and }) =>
        fecha_pago
          ? and(
              eq(pago.credito_id, credito.credito_id),
              eq(pago.fecha_pago, fecha_pago)
            )
          : eq(pago.credito_id, credito.credito_id),
      orderBy: (pago, { asc }) => [asc(pago.fecha_pago)],
    });

    return pagos;
  } catch (error) {
    console.error("[getPagosByCreditoAndFecha] Error:", error);
    throw new Error("Error fetching payments for the given credit SIFCO number.");
  }
}

export async function getPayments(
  mes: number,
  anio: number,
  page: number = 1,
  perPage: number = 10
) {
  const offset = (page - 1) * perPage;

  // Consulta principal
  const rows = await db
    .select({
      pagos_credito, // trae todas las columnas de pagos_Credito
      numero_credito_sifco: creditos.numero_credito_sifco, // solo este campo de creditos
    })
    .from(pagos_credito)
    .innerJoin(
      creditos,
      eq(pagos_credito.credito_id, creditos.credito_id)
    )
    .where(
      and(
        sql`EXTRACT(MONTH FROM ${pagos_credito.fecha_pago}) = ${mes}`,
        sql`EXTRACT(YEAR FROM ${pagos_credito.fecha_pago}) = ${anio}`
      )
    )
    .limit(perPage)
    .offset(offset);

  // Para el total de filas (conteo)
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(pagos_credito)
    .innerJoin(
      creditos,
      eq(pagos_credito.credito_id, creditos.credito_id)
    )
    .where(
      and(
        sql`EXTRACT(MONTH FROM ${pagos_credito.fecha_pago}) = ${mes}`,
        sql`EXTRACT(YEAR FROM ${pagos_credito.fecha_pago}) = ${anio}`
      )
    );

  return {
    data: rows,
    page,
    perPage,
    totalCount: Number(count),
    totalPages: Math.ceil(Number(count) / perPage),
  };
}
