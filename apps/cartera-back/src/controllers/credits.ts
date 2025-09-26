import { db } from "../database/index";
import {
  asesores,
  bad_debts,
  boletas,
  credit_cancelations,
  creditos,
  creditos_inversionistas,
  creditos_rubros_otros,
  cuotas_credito,
  inversionistas,
  montos_adicionales,
  pagos_credito,
  pagos_credito_inversionistas,
  StatusCredit,
  usuarios,
} from "../database/db/schema";
import { z } from "zod";
import Big from "big.js";
import {
  and,
  desc,
  eq,
  sql,
  inArray,
  asc,
  lte,
  lt,
  gte,
  gt,
} from "drizzle-orm";
import { findOrCreateUserByName } from "./users";
import { findOrCreateAdvisorByName } from "./advisor";
import { getPagosDelMesActual } from "./payments";

// Only input fields, no calculated fields here!
const creditSchema = z.object({
  usuario: z.string().max(1000),
  numero_credito_sifco: z.string().max(1000),
  capital: z.number().nonnegative(),
  porcentaje_interes: z.number().min(0).max(100),
  seguro_10_cuotas: z.number().min(0),
  gps: z.number().min(0),
  observaciones: z.string().max(1000),
  no_poliza: z.string().max(1000),
  como_se_entero: z.string().max(100),
  asesor: z.string().max(1000),
  plazo: z.number().int().min(1).max(360),
  cuota: z.number().min(0),
  membresias_pago: z.number().min(0),
  porcentaje_royalti: z.number().min(0),
  royalti: z.number().min(0),

  categoria: z.string().max(1000),
  nit: z.string().max(1000),
  otros: z.number().min(0),
  reserva: z.number().min(0),
  inversionistas: z
    .array(
      z.object({
        inversionista_id: z.number().int().positive(),

        // Nuevo campo obligatorio
        monto_aportado: z.number().positive(),

        // Estos dos porcentajes deben sumar 100, pero eso se valida en la lógica
        porcentaje_cash_in: z.number().min(0).max(100),
        porcentaje_inversion: z.number().min(0).max(100),
        cuota_inversionista: z.number().min(0).optional(), // Nuevo campo opcional
      })
    )
    .min(0),
  rubros: z
    .array(
      z.object({
        nombre_rubro: z.string().max(100),
        monto: z.number().min(0),
      })
    )
    .optional()
    .default([]),
});

export interface CreditInsert {
  usuario_id: number;
  numero_credito_sifco: string;
  capital: string;
  porcentaje_interes: string;
  cuota_interes: string;
  iva_12: string;
  deudatotal: string;
  seguro_10_cuotas: string;
  gps: string;
  observaciones: string;
  no_poliza: string;
  como_se_entero: string;
  asesor_id: number;
  plazo: number;
  cuota: string;
  membresias_pago: string;
  membresias: string;
  formato_credito: string;
  porcentaje_royalti: string;
  royalti: string;
  tipoCredito: string;
  mora: string; // Valor por defecto
  reserva?: string; // Opcional, si no se usa, no se envía
  otros: string; // Otros cargos o pagos adicionales
}

export const insertCredit = async ({ body, set }: { body: any; set: any }) => {
  try {
    const parseResult = creditSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const creditData = parseResult.data;
    // Suma precisa con Big.js
    const totalCuotaInversionista = creditData.inversionistas.reduce(
      (acc: Big, inv: any) => acc.plus(inv.cuota_inversionista ?? 0),
      new Big(0)
    );

    // Redondea a dos decimales
    const totalCuotaInversionistaRedondeado = totalCuotaInversionista.round(2);
    if (
      Number(creditData.cuota) !== totalCuotaInversionistaRedondeado.toNumber()
    ) {
      set.status = 400;
      return {
        message:
          "La suma de las cuotas asignadas a los inversionistas debe ser igual a la cuota del crédito.",
        cuotaEsperada: creditData.cuota,
        totalCuotaInversionista: totalCuotaInversionistaRedondeado.toNumber(),
      };
    }
    const totalMontoAportado = creditData.inversionistas.reduce(
      (acc: Big, inv: any) => acc.plus(inv.monto_aportado ?? 0),
      new Big(0)
    );

    // Validar que cada aporte tenga cash_in + inversion = 100
    for (const inv of creditData.inversionistas) {
      const sumaPorcentajes =
        Number(inv.porcentaje_cash_in ?? 0) +
        Number(inv.porcentaje_inversion ?? 0);

      if (sumaPorcentajes !== 100) {
        set.status = 400;
        return {
          message: `El inversionista con ID ${inv.inversionista_id} no tiene porcentajes válidos. La suma debe ser 100.`,
          sumaPorcentajes,
        };
      }
    }

    // Validar que la suma de los montos aportados sea igual al capital
    if (Number(creditData.capital) !== totalMontoAportado.toNumber()) {
      set.status = 400;
      return {
        message:
          "La suma de los montos aportados por los inversionistas debe ser igual al capital del crédito.",
        capitalEsperado: creditData.capital,
        totalMontoAportado: totalMontoAportado.toNumber(),
      };
    }
    const capital = new Big(creditData.capital);
    const porcentaje_interes = new Big(creditData.porcentaje_interes ?? 0);

    const cuota_interes = capital.times(porcentaje_interes.div(100)).round(2);
    const iva_12 = cuota_interes.times(0.12).round(2);

    const deudatotal = capital
      .plus(cuota_interes)
      .plus(iva_12)
      .plus(creditData.seguro_10_cuotas ?? 0)
      .plus(creditData.gps ?? 0)
      .plus(creditData.membresias_pago ?? 0)
      .plus(creditData.otros ?? 0);

    const deudatotalRedondeado = deudatotal.round(2);
    const user = await findOrCreateUserByName(
      creditData.usuario,
      creditData.categoria,
      creditData.nit,
      creditData.como_se_entero
    );

    const advisor = await findOrCreateAdvisorByName(creditData.asesor, true);

    const formatCredit = creditData.inversionistas.some(
      (inv) => Number(inv.porcentaje_inversion) > 1
    )
      ? "Pool"
      : "Individual";

    const creditDataForInsert = {
      usuario_id: user.usuario_id,
      otros: creditData.otros?.toString() ?? "0",
      numero_credito_sifco: creditData.numero_credito_sifco,
      capital: capital.toString(),
      porcentaje_interes: porcentaje_interes.toString(),
      cuota: creditData.cuota.toString(),
      cuota_interes: cuota_interes.toString(),
      deudatotal: deudatotalRedondeado.toString(),
      seguro_10_cuotas: creditData.seguro_10_cuotas.toString(),
      gps: creditData.gps.toString(),
      observaciones: creditData.observaciones ?? "0",
      no_poliza: creditData.no_poliza ?? "",
      como_se_entero: creditData.como_se_entero ?? "",
      asesor_id: advisor.asesor_id,
      plazo: creditData.plazo,
      iva_12: iva_12.toString(),

      membresias_pago: creditData.membresias_pago.toString(),
      membresias: creditData.membresias_pago.toString(),
      formato_credito: formatCredit ?? "",
      porcentaje_royalti: creditData.porcentaje_royalti?.toString() ?? "0",
      royalti: creditData.royalti?.toString() ?? "0",
      tipoCredito: "Nuevo",
      mora: "0", // Valor por defecto
    };
    console.log("Credit data to insert:", creditDataForInsert);

    const [newCredit] = await db
      .insert(creditos)
      .values(creditDataForInsert)
      .returning();
      
    console.log("Inserted credit:", newCredit);
    if (creditData.rubros && creditData.rubros.length > 0) {
      const rubrosToInsert = creditData.rubros.map((r) => ({
        credito_id: newCredit.credito_id,
        nombre_rubro: r.nombre_rubro,
        monto: r.monto.toString(), // Convert number to string
      }));

      await db.insert(creditos_rubros_otros).values(rubrosToInsert);
      console.log("Inserted rubros:", rubrosToInsert);
    }

    // 👇 Insertar inversionistas múltiples

    const creditosInversionistasData = creditData.inversionistas.map(
      (inv: any) => {
        const montoAportado = new Big(inv.monto_aportado);
        const porcentajeCashIn = new Big(inv.porcentaje_cash_in); // Ej: 30
        const porcentajeInversion = new Big(inv.porcentaje_inversion); // Ej: 70
        const interes = new Big(creditDataForInsert.porcentaje_interes ?? 0);
        const newCuotaInteres = new Big(montoAportado ?? 0).times(
          interes.div(100)
        );
        // Montos proporcionales
        const montoInversionista = newCuotaInteres
          .times(porcentajeInversion)
          .div(100)
          .toFixed(2);
        const montoCashIn = newCuotaInteres
          .times(porcentajeCashIn)
          .div(100)
          .toFixed(2);
        // IVA respectivos
        const ivaInversionista =
          Number(montoInversionista) > 0
            ? new Big(montoInversionista).times(0.12)
            : new Big(0);
        const ivaCashIn =
          Number(montoCashIn) > 0
            ? new Big(montoCashIn).times(0.12)
            : new Big(0);
        const cuotaInv =
          inv.cuota_inversionista === 0
            ? creditData.cuota.toString()
            : inv.cuota_inversionista.toString();
        return {
          credito_id: newCredit.credito_id,
          inversionista_id: inv.inversionista_id,
          monto_aportado: montoAportado.toString(),
          porcentaje_cash_in: porcentajeCashIn.toString(),
          porcentaje_participacion_inversionista:
            porcentajeInversion.toString(),
          monto_inversionista: montoInversionista.toString(),
          monto_cash_in: montoCashIn.toString(),
          iva_inversionista: ivaInversionista.toString(),
          iva_cash_in: ivaCashIn.toString(),
          fecha_creacion: new Date(),
          cuota_inversionista: cuotaInv.toString(),
        };
      }
    );
    let total_monto_cash_in = new Big(0);
    let total_iva_cash_in = new Big(0);

    creditosInversionistasData.forEach(({ monto_cash_in, iva_cash_in }) => {
      total_monto_cash_in = total_monto_cash_in.plus(monto_cash_in);
      total_iva_cash_in = total_iva_cash_in.plus(iva_cash_in);
    }); // <-- Add this closing parenthesis and semicolon

    if (creditosInversionistasData.length > 0) {
      await db
        .insert(creditos_inversionistas)
        .values(creditosInversionistasData);
    }
    const pagos = [];
    const startDate = new Date(); // Primera fecha de pago: ahora

    const fechas = [];
    const fechaHoy = new Date();
    const fechaHoyGuate = fechaHoy.toLocaleDateString("sv-SE", {
      timeZone: "America/Guatemala",
    });
    fechas.push(fechaHoyGuate);
    for (let i = 0; i < creditData.plazo; i++) {
      const baseDate = new Date(startDate);
      baseDate.setMonth(baseDate.getMonth() + i + 1);

      const mes = baseDate.getMonth();
      const anio = baseDate.getFullYear();
      const ultimoDiaMes = new Date(anio, mes + 1, 0).getDate();
      const diaPago = ultimoDiaMes < 30 ? ultimoDiaMes : 30;
      const fechaLocal = new Date(anio, mes, diaPago, 12, 0, 0);
      const fechaGuateStr = fechaLocal.toLocaleDateString("sv-SE", {
        timeZone: "America/Guatemala",
      });
      fechas.push(fechaGuateStr);
    }
    const cuotas = [];
    const cuotaInicialArr = await db
      .insert(cuotas_credito)
      .values({
        credito_id: newCredit.credito_id,
        numero_cuota: 0,
        fecha_vencimiento: fechas[0],
        pagado: true,
      })
      .returning({ cuota_id: cuotas_credito.cuota_id });
    const cuotaInicial =
      Array.isArray(cuotaInicialArr) && cuotaInicialArr.length > 0
        ? cuotaInicialArr[0].cuota_id
        : undefined;

    for (let i = 0; i < creditData.plazo; i++) {
      cuotas.push({
        credito_id: newCredit.credito_id,
        numero_cuota: i + 1,
        fecha_vencimiento: fechas[i + 1] || fechas[fechas.length - 1],
        pagado: false,
      });
    }
    const cuotasInsertadas = await db
      .insert(cuotas_credito)
      .values(cuotas)
      .returning({
        cuota_id: cuotas_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
      });

    for (let i = 0; i < creditData.plazo; i++) {
      const baseDate = new Date(startDate);
      baseDate.setMonth(baseDate.getMonth() + i + 1);

      const mes = baseDate.getMonth();
      const anio = baseDate.getFullYear();
      const ultimoDiaMes = new Date(anio, mes + 1, 0).getDate();
      const diaPago = ultimoDiaMes < 30 ? ultimoDiaMes : 30;
      const fechaLocal = new Date(anio, mes, diaPago, 12, 0, 0);
      const fechaGuateStr = fechaLocal.toLocaleDateString("sv-SE", {
        timeZone: "America/Guatemala",
      });
      fechas.push(fechaGuateStr);
    }

    pagos.push({
      credito_id: newCredit.credito_id,
      cuota: "0",
      cuota_interes: "0",
      cuota_id: cuotaInicial,
      fecha_pago: fechas[0],
      abono_capital: "0",
      abono_interes: creditDataForInsert.cuota_interes,
      abono_iva_12: creditDataForInsert.iva_12,
      abono_interes_ci: total_monto_cash_in.toString(),
      abono_iva_ci: total_iva_cash_in.toString(),
      abono_seguro: creditData.seguro_10_cuotas ? "0" : undefined,
      abono_gps: creditData.gps ? "0" : undefined,
      pago_del_mes: "0",
      monto_boleta: "0",
      fecha_filtro: fechas[0],
      renuevo_o_nuevo: "",
      capital_restante: creditDataForInsert.capital,
      interes_restante: "0",
      iva_12_restante: "0",
      seguro_restante: "0",
      gps_restante: "0",
      total_restante: creditDataForInsert.deudatotal,
      membresias: creditDataForInsert.membresias?.toString() ?? "0",
      membresias_pago: creditDataForInsert.membresias_pago?.toString() ?? "",
      membresias_mes: creditDataForInsert.membresias?.toString() ?? "",
      otros: creditData.otros?.toString() ?? "0",
      mora: "0",
      monto_boleta_cuota: "0",
      seguro_total: creditData.seguro_10_cuotas?.toString() ?? "0",
      pagado: true,
      facturacion: "si",
      mes_pagado: "",
      seguro_facturado: creditData.seguro_10_cuotas?.toString() ?? "0",
      gps_facturado: creditData.gps?.toString() ?? "0",
      reserva: creditData.reserva?.toString() ?? "0",
      observaciones: "",
      paymentFalse: false,
    });

    // 4️⃣ Pagos para cada cuota real
    for (const cuota of cuotasInsertadas) {
      pagos.push({
        credito_id: newCredit.credito_id,
        cuota: creditDataForInsert.cuota,
        cuota_interes: creditDataForInsert.cuota_interes,
        cuota_id: cuota.cuota_id,
        fecha_pago: cuota.fecha_vencimiento,
        abono_capital: "0",
        abono_interes: "0",
        abono_iva_12: "0",
        abono_interes_ci: "0",
        abono_iva_ci: "0",
        abono_seguro: creditData.seguro_10_cuotas ? "0" : undefined,
        abono_gps: creditData.gps ? "0" : undefined,
        pago_del_mes: "0",
        monto_boleta: "0",
        fecha_filtro: cuota.fecha_vencimiento,
        renuevo_o_nuevo: "",
        capital_restante: creditDataForInsert.capital,
        interes_restante: creditDataForInsert.cuota_interes,
        iva_12_restante: creditDataForInsert.iva_12,
        seguro_restante: creditData.seguro_10_cuotas?.toString() ?? "0",
        gps_restante: creditData.gps?.toString() ?? "0",
        total_restante: creditDataForInsert.deudatotal,
        membresias: creditDataForInsert.membresias_pago?.toString() ?? "",
        membresias_pago: creditDataForInsert.membresias_pago?.toString() ?? "",
        membresias_mes: creditDataForInsert.membresias_pago?.toString() ?? "",
        otros: "",
        mora: "0",
        monto_boleta_cuota: "0",
        seguro_total: creditData.seguro_10_cuotas?.toString() ?? "0",
        pagado: false,
        facturacion: "si",
        mes_pagado: "",
        seguro_facturado: creditData.seguro_10_cuotas?.toString() ?? "0",
        gps_facturado: creditData.gps?.toString() ?? "0",
        reserva: "0",
        observaciones: "",
        paymentFalse: false,
      });
    }

    // 5️⃣ Insertar todos los pagos
    // Filtra pagos con cuota_id undefined para evitar errores de tipo
    const pagosValidos = pagos.filter(
      (p) => p.cuota_id !== undefined
    ) as typeof pagos;
    // Map to remove any undefined cuota_id (should not happen, but for type safety)
    const pagosValidosSinUndefined = pagosValidos.map((p) => ({
      ...p,
      cuota_id: p.cuota_id as number, // force type, since we filtered undefined above
    }));
    await db.insert(pagos_credito).values(pagosValidosSinUndefined);

    // Por cada pago insertado

    set.status = 201;
    return newCredit;
  } catch (error) {
    console.log("Error inserting credit:", error);
    set.status = 500;
    return { message: "Error inserting credit", error: String(error) };
  }
};

// All fields optional except credito_id
export const creditUpdateSchema = z.object({
  credito_id: z.number().int().positive(),
  cuota: z.number().min(0),
  plazo: z.number().min(0),
  mora: z.number().optional(),
  numero_credito_sifco: z.string().max(1000).optional(),
  inversionistas: z
    .array(
      z.object({
        inversionista_id: z.number().int().positive(),
        monto_aportado: z.number().positive(),
        porcentaje_cash_in: z.number().min(0).max(100),
        porcentaje_inversion: z.number().min(0).max(100),
        cuota_inversionista: z.number().min(0).optional(),
      })
    )
    .min(0),
  capital: z.number().nonnegative(),
  porcentaje_interes: z.number().min(0).max(100),
  seguro_10_cuotas: z.number().min(0),
  membresias_pago: z.number().min(0),
  otros: z.number().min(0),
});

/**
 * Calculates the debt summary including:
 * - principal (capital)
 * - interest (interes)
 * - subtotal before VAT (subtotalSinIVA)
 * - VAT amount (iva_12)
 * - total debt (totalDeuda)
 * - per-installment amount (cuota)
 *
 * Why Big.js?
 * - Prevents floating-point precision errors from native JS numbers.
 *
 * Rounding:
 * - All amounts are rounded to 2 decimals (Half Up).
 *
 * @param params.capital Principal amount.
 * @param params.porcentaje_interes Interest rate as percentage (e.g., 24 for 24%).
 * @param params.seguro_10_cuotas Insurance fee distributed over 10 installments.
 * @param params.membresias_pago Membership/processing fees.
 * @param params.otros Other additional fees.
 * @param params.iva_12 VAT amount already calculated externally.
 * @param numero_cuotas Number of installments for splitting the total (default = 10).
 *
 * @returns Object with all calculated fields as strings (rounded to 2 decimals).
 */
export function calcularDeudaTotal({
  capital,
  porcentaje_interes,
  seguro_10_cuotas,
  membresias_pago,
  otros,
  gps,
  cuota,
  plazo,
}: {
  capital: number;
  porcentaje_interes: number;
  seguro_10_cuotas: number;
  membresias_pago: number;
  otros: number;
  iva_12: number;
  gps: number;
  cuota: number;
  plazo: number;
}): {
  capital: string;
  interes: string;
  totalDeuda: string;
  cuota: string;
  iva_12: string;
  plazo: string;
  gps: string;
} {
  // Convert to Big for precision
  const bigCapital = new Big(capital);

  // --- Calculate interest ---
  const interes = bigCapital.times(new Big(porcentaje_interes).div(100));
  const iva_12 = interes.times(0.12).round(2);
  // --- Subtotal without VAT (capital + interest + other fees) ---
  const deudatotal = bigCapital
    .plus(interes)
    .plus(iva_12)
    .plus(seguro_10_cuotas ?? 0)
    .plus(gps ?? 0)
    .plus(membresias_pago ?? 0)
    .plus(otros ?? 0);

  // Return structured response (all as strings for display/storage)
  return {
    capital: bigCapital.round(2).toString(),
    interes: interes.round(2).toString(),
    iva_12: new Big(iva_12).round(2).toString(),
    totalDeuda: deudatotal.toString(),
    cuota: cuota.toString(),
    plazo: plazo.toString(),
    gps: gps.toString(),
  };
}
export const updateCredit = async ({
  body,
  set,
}: {
  body: unknown;
  set: any;
}) => {
  try {
    console.log("Updating credit with body:", body);
    const parseResult = creditUpdateSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const {
      credito_id,
      inversionistas = [],
      mora,
      cuota,
      numero_credito_sifco,
      ...fieldsToUpdate
    } = parseResult.data;

    // Buscar el crédito actual
    const [current] = await db
      .select()
      .from(creditos)
      .where(
        and(
          eq(creditos.credito_id, credito_id),
          eq(creditos.statusCredit, "ACTIVO")
        )
      )
      .limit(1);
    if (!current) {
      set.status = 400;
      return { message: "Credit not found" };
    }
    // Validación: suma de cash in + inversión debe ser 100
    for (const inv of inversionistas) {
      const total =
        Number(inv.porcentaje_cash_in) + Number(inv.porcentaje_inversion);
      if (total !== 100) {
        set.status = 400;
        return {
          message: `El cash-in y la inversión para el inversionista con ID ${inv.inversionista_id} deben sumar 100%`,
          detalle: { inversionista_id: inv.inversionista_id, total },
        };
      }
    }
    const totalCuotaInversionista = inversionistas.reduce(
      (acc: Big, inv: any) => acc.plus(inv.cuota_inversionista ?? 0),
      new Big(0)
    );
    const totalMontoAportado = inversionistas.reduce(
      (acc: Big, inv: any) => acc.plus(inv.monto_aportado ?? 0),
      new Big(0)
    );
    const totalMontoAportadoRedondeado = totalMontoAportado.round(2);
    // Redondea a dos decimales
    const totalCuotaInversionistaRedondeado = totalCuotaInversionista.round(2);

    console.log(
      "Comparando cuota esperada y total cuota inversionista:",
      "cuota:",
      current.cuota,
      "totalCuotaInversionista:",
      totalCuotaInversionistaRedondeado.toString()
    );

    if (Number(cuota) !== totalCuotaInversionistaRedondeado.toNumber()) {
      set.status = 400;
      return {
        message:
          "La suma de las cuotas asignadas a los inversionistas debe ser igual a la cuota del crédito.",
        cuotaEsperada: current.cuota,
        totalCuotaInversionista: totalCuotaInversionistaRedondeado.toNumber(),
      };
    }
    if (
      Number(fieldsToUpdate.capital) !== totalMontoAportadoRedondeado.toNumber()
    ) {
      set.status = 400;
      return {
        message:
          "La suma de los montos aportados de   los inversionistas debe ser igual aal capital del crédito.",
        cuotaEsperada: current.cuota,
        totalCuotaInversionista: totalMontoAportadoRedondeado.toNumber(),
      };
    }

    // Campos que al modificarse requieren recalcular deuda_total
    const camposQueModificanDeuda = [
      "capital",
      "porcentaje_interes",
      "seguro_10_cuotas",
      "membresias_pago",
      "otros",
      "capital",
      "cuota",
      "plazo",
    ];

    // Arma el objeto de update con todos los campos nuevos
    const updateFields: any = { ...fieldsToUpdate };
    const formatCredit = inversionistas.some(
      (inv) => Number(inv.porcentaje_inversion) > 0
    )
      ? "Pool"
      : "Individual";
    updateFields.formato_credito = formatCredit;
    if (mora !== undefined) updateFields.mora = mora.toString();
    if (cuota !== undefined) updateFields.cuota = cuota.toString();
    if (numero_credito_sifco !== undefined)
      updateFields.numero_credito_sifco = numero_credito_sifco; // Checa si cambió alguno de los campos relevantes para deuda_total
    const changes = camposQueModificanDeuda.some((campo) => {
      const nuevo = fieldsToUpdate[campo as keyof typeof fieldsToUpdate];
      const actual = current[campo as keyof typeof current];
      // Solo comparar si el campo fue enviado (no undefined)
      // Big.js para precisión en decimales
      // Solo comparar si ambos son string o number (no Date)
      const isValidBigSource = (v: unknown): v is string | number =>
        typeof v === "string" || typeof v === "number";
      return (
        nuevo !== undefined &&
        isValidBigSource(nuevo) &&
        isValidBigSource(actual) &&
        !new Big(nuevo).eq(new Big(actual))
      );
    });
    const otrosModificado =
      fieldsToUpdate.otros !== undefined &&
      !new Big(fieldsToUpdate.otros).eq(new Big(current.otros));
    console.log("Current credit data:", current);
    console.log("cuotaaaaa", cuota);
    const willChangeCuota =
      cuota !== undefined && !new Big(cuota).eq(new Big(current.cuota));
    const willChangePlazo =
      fieldsToUpdate.plazo !== undefined &&
      !new Big(fieldsToUpdate.plazo).eq(new Big(current.plazo));
    if (willChangeCuota || willChangePlazo) {
      console.log("Will change cuota or plazo");
      await syncScheduleOnTermsChange({
        creditoId: credito_id,
        newCuota: Number(cuota ?? current.cuota),
        newPlazo: Number(fieldsToUpdate.plazo ?? current.plazo),
        preloadCredit: current, // para evitar otro roundtrip
      });
    }
    if (changes) {
      console.log(
        "Changes detected in fields that affect deuda_total:",
        changes
      );

      // Calcula la nueva deuda_total usando los valores nuevos (o actuales si no se modificó ese campo)
      const nuevaDeudaTotal = calcularDeudaTotal({
        capital: fieldsToUpdate.capital ?? current.capital,
        porcentaje_interes:
          fieldsToUpdate.porcentaje_interes ?? current.porcentaje_interes,
        seguro_10_cuotas:
          fieldsToUpdate.seguro_10_cuotas ?? current.seguro_10_cuotas,
        membresias_pago:
          fieldsToUpdate.membresias_pago ?? current.membresias_pago,
        otros: fieldsToUpdate.otros ?? current.otros,
        iva_12: new Big(current.iva_12).toNumber(),
        gps: new Big(current.gps).toNumber(),
        cuota: cuota ?? current.cuota,
        plazo: fieldsToUpdate.plazo ?? current.plazo,
      });
      updateFields.deudatotal = nuevaDeudaTotal.totalDeuda;
      updateFields.cuota = nuevaDeudaTotal.cuota;
      updateFields.plazo = fieldsToUpdate.plazo ?? current.plazo;
      updateFields.otros = fieldsToUpdate.otros ?? current.otros;
      updateFields.iva_12 = nuevaDeudaTotal.iva_12;
      updateFields.gps = nuevaDeudaTotal.gps;
      updateFields.cuota_interes = nuevaDeudaTotal.interes;
      updateFields.membresias_pago =
        fieldsToUpdate.membresias_pago ?? current.membresias_pago;
      updateFields.seguro_10_cuotas =
        fieldsToUpdate.seguro_10_cuotas ?? current.seguro_10_cuotas;

      if (otrosModificado) {
        const cuotaInicial = await db
          .select({ id: cuotas_credito.cuota_id })
          .from(cuotas_credito)
          .where(
            and(
              eq(cuotas_credito.credito_id, credito_id),
              eq(cuotas_credito.numero_cuota, 0)
            )
          );
        if (cuotaInicial.length) {
          await db
            .update(pagos_credito)
            .set({ otros: fieldsToUpdate.otros?.toString() })
            .where(eq(pagos_credito.cuota_id, cuotaInicial[0].id));
        }
      }
    }
    updateFields.membresias =
      fieldsToUpdate.membresias_pago ?? current.membresias_pago;
    // Ahora sí, haz un solo update con todos los campos a la vez
    const [updatedCredit] = await db
      .update(creditos)
      .set(updateFields)
      .where(eq(creditos.credito_id, credito_id))
      .returning();

    // Si hay inversionistas, limpiar y actualizar
    if (inversionistas.length > 0) {
      await db
        .delete(creditos_inversionistas)
        .where(eq(creditos_inversionistas.credito_id, credito_id));

      const creditosInversionistasData = inversionistas.map((inv: any) => {
        const montoAportado = new Big(inv.monto_aportado);
        const porcentajeCashIn = new Big(inv.porcentaje_cash_in);
        const porcentajeInversion = new Big(inv.porcentaje_inversion);
        const interes = new Big(
          updateFields.porcentaje_interes ?? current?.porcentaje_interes ?? 0
        );
        const newCuotaInteres = new Big(montoAportado ?? 0)
          .times(interes.div(100))
          .round(2);

        const montoInversionista = newCuotaInteres
          .times(porcentajeInversion)
          .div(100)
          .round(2);
        const montoCashIn = newCuotaInteres
          .times(porcentajeCashIn)
          .div(100)
          .round(2);

        // IVA respectivos
        const ivaInversionista =
          montoInversionista.toNumber() > 0
            ? new Big(montoInversionista ?? "0").times(0.12).round(2)
            : new Big(0);
        const ivaCashIn =
          montoCashIn.toNumber() > 0
            ? new Big(montoCashIn ?? "0").times(0.12).round(2)
            : new Big(0);

        return {
          credito_id: credito_id,
          inversionista_id: inv.inversionista_id,
          monto_aportado: montoAportado.toString(),
          porcentaje_cash_in: porcentajeCashIn.toString(),
          porcentaje_participacion_inversionista:
            porcentajeInversion.toString(),
          monto_inversionista: montoInversionista.toString(),
          monto_cash_in: montoCashIn.toString(),
          iva_inversionista: ivaInversionista.toString(),
          iva_cash_in: ivaCashIn.toString(),
          fecha_creacion: new Date(),
          cuota_inversionista: inv.cuota_inversionista ?? "0",
          numero_credito_sifco: numero_credito_sifco ?? undefined,
        };
      });

      if (creditosInversionistasData.length > 0) {
        await db
          .insert(creditos_inversionistas)
          .values(creditosInversionistasData);
      }
    }

    set.status = 200;
    return updatedCredit;
  } catch (error) {
    console.error("Error al actualizar el crédito:", error);
    set.status = 500;
    return { message: "Error al actualizar el crédito" };
  }
};

export const getCreditoByNumero = async (numero_credito_sifco: string) => {
  try {
    // 1. Buscar el crédito con su usuario
    const creditoData = await db
      .select()
      .from(creditos)
      .where(
        and(
          eq(creditos.numero_credito_sifco, numero_credito_sifco),
          inArray(creditos.statusCredit, ["ACTIVO", "PENDIENTE_CANCELACION"])
        )
      )
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .limit(1);

    if (creditoData.length === 0) {
      return { message: "Crédito no encontrado" };
    }

    const currentCredit = creditoData[0];
    const creditoId = currentCredit.creditos.credito_id;
    // 2. Si el crédito está cancelado, traer la info de cancelación y retornar flujo especial
    if (
      currentCredit.creditos.statusCredit === "CANCELADO" ||
      currentCredit.creditos.statusCredit === "PENDIENTE_CANCELACION"
    ) {
      // Buscar la info de cancelación
      const cancelacion = await db
        .select()
        .from(credit_cancelations)
        .where(eq(credit_cancelations.credit_id, creditoId))
        .limit(1);

      return {
        credito: currentCredit.creditos,
        usuario: currentCredit.usuarios,
        cancelacion: cancelacion[0] || null,
        flujo: "CANCELADO",
      };
    }

    // 2. Consultar todas las cuotas pagadas (pagado = true)
    const cuotasPagadas = await db
      .select()
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),
          eq(cuotas_credito.pagado, true)
        )
      )
      .orderBy(cuotas_credito.numero_cuota);

    // 4. Calcular la cuota que toca este mes (según meses transcurridos desde fecha_creacion)
    const fechaInicio = new Date(currentCredit.creditos.fecha_creacion);
    const hoy = new Date();
    const mesesTranscurridos =
      (hoy.getFullYear() - fechaInicio.getFullYear()) * 12 +
      (hoy.getMonth() - fechaInicio.getMonth()) +
      1;

    // 5. Consultar cuotas pendientes (no pagadas y ya deberían haberse pagado)
    const cuotasAtrasadas = await db
      .select()
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),

          eq(cuotas_credito.pagado, false),
          lt(cuotas_credito.fecha_vencimiento, hoy.toISOString().slice(0, 10))
        )
      )
      .orderBy(asc(cuotas_credito.numero_cuota));

    const cuotasPendientes = await db
      .select()
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),

          eq(cuotas_credito.pagado, false)
        )
      )
      .orderBy(asc(cuotas_credito.numero_cuota));

    // 6. Consultar si la cuota actual ya fue pagada
    const [cuotaActualData] = await db
      .select()
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),
          gt(cuotas_credito.numero_cuota, 0),
          gte(cuotas_credito.fecha_vencimiento, hoy.toISOString().slice(0, 10))
        )
      )
      .orderBy(cuotas_credito.fecha_vencimiento)
      .limit(1);

    // ¿Está pagada la cuota actual?
    const cuotaActualPagada = !!(cuotaActualData && cuotaActualData.pagado);

    // La cuota actual del mes es la de número `mesesTranscurridos`
    const cuotaActual = cuotaActualData.numero_cuota;

    return {
      credito: currentCredit.creditos,
      usuario: currentCredit.usuarios,
      cuotaActual, // Cuota que debe pagar este mes (número)
      cuotaActualPagada, // true si ya la pagó, false si no
      cuotasPendientes: cuotasPendientes, // Todas las cuotas vencidas y no pagadas
      cuotasAtrasadas: cuotasAtrasadas,
      cuotasPagadas, // Todas las cuotas pagadas
    };
  } catch (error) {
    console.error("[getCreditoByNumero] Error:", error);
    return { message: "Error consultando crédito", error: String(error) };
  }
};

// Interfaces para cancelaciones/incobrables
export interface CreditCancelation {
  id: number;
  credit_id: number;
  motivo: string;
  observaciones?: string | null;
  fecha_cancelacion: Date | string;
  monto_cancelacion: number;
}

export interface BadDebt {
  id: number;
  credit_id: number;
  motivo: string;
  observaciones?: string | null;
  fecha_registro: Date | string;
  monto_incobrable: number;
}

export interface CreditoConInfo {
  creditos: typeof creditos.$inferSelect;
  usuarios: typeof usuarios.$inferSelect;
  asesores: typeof asesores.$inferSelect;
  inversionistas: {
    credito_id: number;
    inversionista_id: number;
    nombre: string;
    emite_factura: boolean;
    monto_aportado: string;
    monto_cash_in: string;
    monto_inversionista: string;
    iva_cash_in: string;
    iva_inversionista: string;
    porcentaje_participacion_inversionista: string;
    porcentaje_cash_in: string;
    cuota_inversionista: string;
  }[]; // Actualizado para reflejar la estructura real
  resumen: {
    total_cash_in_monto: number;
    total_cash_in_iva: number;
    total_inversion_monto: number;
    total_inversion_iva: number;
  };
  cancelacion?: CreditCancelation | null;
  incobrable?: BadDebt | null;
  rubros?: { nombre_rubro: string; monto: number }[];
}

export async function getCreditosWithUserByMesAnio(
  mes: number,
  anio: number,
  page: number = 1,
  perPage: number = 10,
  numero_credito_sifco?: string,
  estado?: "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION"
): Promise<{
  data: CreditoConInfo[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
}> {
  console.log(
    `Fetching credits for month: ${mes}, year: ${anio}, page: ${page}, perPage: ${perPage}, estado: ${estado}`
  );
  const offset = (page - 1) * perPage;
  const conditions: any[] = [];

  if (numero_credito_sifco && numero_credito_sifco.length > 0) {
    conditions.push(eq(creditos.numero_credito_sifco, numero_credito_sifco));
  } else {
    if (mes !== 0 && anio !== 0) {
      conditions.push(
        sql`EXTRACT(MONTH FROM ${creditos.fecha_creacion}) = ${mes}`,
        sql`EXTRACT(YEAR FROM ${creditos.fecha_creacion}) = ${anio}`
      );
    }
  }
  if (estado && estado.length > 0) {
    conditions.push(
      eq(
        creditos.statusCredit,
        estado as
          | "ACTIVO"
          | "CANCELADO"
          | "INCOBRABLE"
          | "PENDIENTE_CANCELACION"
      )
    );
  }

  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

  // 1. Buscar los créditos y usuarios
  const rows = await db
    .select({
      creditos,
      usuarios,
      asesores,
    })
    .from(creditos)
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
    .where(whereCondition)
    .limit(perPage)
    .offset(offset)
    .orderBy(desc(creditos.fecha_creacion));

  console.log(`Found ${rows.length} records for the given month and year.`);

  const creditosIds = rows.map((r) => r.creditos.credito_id);
  const rubrosPorCredito = await db
  .select({
    credito_id: creditos_rubros_otros.credito_id,
    nombre_rubro: creditos_rubros_otros.nombre_rubro,
    monto: creditos_rubros_otros.monto,
  })
  .from(creditos_rubros_otros)
  .where(inArray(creditos_rubros_otros.credito_id, creditosIds));
  const rubrosMap = creditosIds.reduce(
  (acc, creditoId) => {
    acc[creditoId] = rubrosPorCredito
      .filter((r) => r.credito_id === creditoId)
      .map(r => ({ 
        nombre_rubro: r.nombre_rubro, 
        monto: Number(r.monto) 
      }));
    return acc;
  },
  {} as Record<number, { nombre_rubro: string; monto: number }[]>
);

  // 2. Traer los inversionistas relacionados a esos créditos (con todos los campos)
  const inversionistasPorCredito = await db
    .select({
      credito_id: creditos_inversionistas.credito_id,
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
      monto_aportado: creditos_inversionistas.monto_aportado,
      monto_cash_in: creditos_inversionistas.monto_cash_in,
      monto_inversionista: creditos_inversionistas.monto_inversionista,
      iva_cash_in: creditos_inversionistas.iva_cash_in,
      iva_inversionista: creditos_inversionistas.iva_inversionista,
      porcentaje_participacion_inversionista:
        creditos_inversionistas.porcentaje_participacion_inversionista,
      porcentaje_cash_in: creditos_inversionistas.porcentaje_cash_in,
      cuota_inversionista: creditos_inversionistas.cuota_inversionista,
    })
    .from(creditos_inversionistas)
    .innerJoin(
      inversionistas,
      eq(
        creditos_inversionistas.inversionista_id,
        inversionistas.inversionista_id
      )
    )
    .where(inArray(creditos_inversionistas.credito_id, creditosIds));

  // 3. Agrupar inversionistas y calcular totales por crédito
  const inversionistasMap = creditosIds.reduce(
    (acc, creditoId) => {
      const aportes = inversionistasPorCredito.filter(
        (inv) => inv.credito_id === creditoId
      );

      const total_cash_in_monto = aportes.reduce(
        (sum, cur) => sum + Number(cur.monto_cash_in ?? 0),
        0
      );
      const total_cash_in_iva = aportes.reduce(
        (sum, cur) => sum + Number(cur.iva_cash_in ?? 0),
        0
      );
      const total_inversion_monto = aportes.reduce(
        (sum, cur) => sum + Number(cur.monto_inversionista ?? 0),
        0
      );
      const total_inversion_iva = aportes.reduce(
        (sum, cur) => sum + Number(cur.iva_inversionista ?? 0),
        0
      );

      acc[creditoId] = {
        aportes,
        resumen: {
          total_cash_in_monto,
          total_cash_in_iva,
          total_inversion_monto,
          total_inversion_iva,
        },
      };

      return acc;
    },
    {} as Record<
      number,
      {
        aportes: typeof inversionistasPorCredito;
        resumen: {
          total_cash_in_monto: number;
          total_cash_in_iva: number;
          total_inversion_monto: number;
          total_inversion_iva: number;
        };
      }
    >
  );

  // --- NUEVO: Cancelaciones e incobrables ---
  const canceladosIds = rows
    .filter((r) => r.creditos.statusCredit === "CANCELADO")
    .map((r) => r.creditos.credito_id);
  const incobrablesIds = rows
    .filter((r) => r.creditos.statusCredit === "INCOBRABLE")
    .map((r) => r.creditos.credito_id);

  let cancelaciones: CreditCancelation[] = [];
  if (canceladosIds.length > 0) {
    const cancelacionesRaw = await db
      .select()
      .from(credit_cancelations)
      .where(inArray(credit_cancelations.credit_id, canceladosIds));
    cancelaciones = cancelacionesRaw.map((row) => ({
      ...row,
      fecha_cancelacion: row.fecha_cancelacion ?? "",
      monto_cancelacion: Number(row.monto_cancelacion),
    }));
  }

  let incobrables: BadDebt[] = [];
  if (incobrablesIds.length > 0) {
    const incobrablesRaw = await db
      .select()
      .from(bad_debts)
      .where(inArray(bad_debts.credit_id, incobrablesIds));
    incobrables = incobrablesRaw.map((row) => ({
      ...row,
      fecha_registro: row.fecha_registro ?? "",
      monto_incobrable: Number(row.monto_incobrable),
    }));
  }

  const cancelacionesMap: Record<number, CreditCancelation> = {};
  cancelaciones.forEach((row) => {
    cancelacionesMap[row.credit_id] = row;
  });
  const incobrablesMap: Record<number, BadDebt> = {};
  incobrables.forEach((row) => {
    incobrablesMap[row.credit_id] = row;
  });

  // 4. Mapear la respuesta final
  const data: CreditoConInfo[] = rows.map((row) => {
    const info = inversionistasMap[row.creditos.credito_id] || {
      aportes: [],
      resumen: {
        total_cash_in_monto: 0,
        total_cash_in_iva: 0,
        total_inversion_monto: 0,
        total_inversion_iva: 0,
      },
    };
    const rubros = rubrosMap[row.creditos.credito_id] || [];

    const cancelacion =
      row.creditos.statusCredit === "CANCELADO"
        ? cancelacionesMap[row.creditos.credito_id] || null
        : undefined;
    const incobrable =
      row.creditos.statusCredit === "INCOBRABLE"
        ? incobrablesMap[row.creditos.credito_id] || null
        : undefined;

    return {
      creditos: row.creditos,
      usuarios: row.usuarios,
      asesores: row.asesores,
      inversionistas: info.aportes,
      resumen: info.resumen,
      cancelacion,
      rubros,
      incobrable,
    };
  });

  // 5. Total de registros para la paginación
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(creditos)
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .where(whereCondition);

  console.log(`Total records found: ${count}`);

  return {
    data,
    page,
    perPage,
    totalCount: Number(count),
    totalPages: Math.ceil(Number(count) / perPage),
  };
}

type Aporte = {
  monto_cash_in: string; // viene como string desde la DB
  monto_inversionista: string;
};

type ResultadoDistribucion = {
  cuota_cash_in: Big;
  iva_cash_in: Big;
  cuota_inversionistas: Big;
  iva_inversionistas: Big;
};

export function calcularDistribucionCuota({
  capital,
  cuota_interes,
  aportes,
}: {
  capital: Big;
  cuota_interes: Big;
  aportes: Aporte[];
}): ResultadoDistribucion {
  const totalCashIn = aportes.reduce(
    (acc, cur) => acc.plus(cur.monto_cash_in),
    new Big(0)
  );

  const totalInversion = aportes.reduce(
    (acc, cur) => acc.plus(cur.monto_inversionista),
    new Big(0)
  );

  const cuota_cash_in = totalCashIn.div(capital).times(cuota_interes).round(2);
  const iva_cash_in = cuota_cash_in.times(0.12).round(2);

  const cuota_inversionistas = totalInversion
    .div(capital)
    .times(cuota_interes)
    .round(2);
  const iva_inversionistas = cuota_inversionistas.times(0.12).round(2);

  return {
    cuota_cash_in,
    iva_cash_in,
    cuota_inversionistas,
    iva_inversionistas,
  };
}

export async function cancelCredit(creditId: number) {
  try {
    // 1. Obtener el crédito
    const [credit] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, creditId))
      .limit(1);

    if (!credit) {
      return { message: "Crédito no encontrado." };
    }
    const hoy = new Date();

    // 2. Obtener cuotas pendientes
    const cuotasPendientes = await db
      .select()
      .from(pagos_credito)
      .where(
        and(
          eq(pagos_credito.credito_id, creditId),
          eq(pagos_credito.pagado, false),
          lte(pagos_credito.fecha_pago, hoy.toISOString().slice(0, 10))
        )
      );

    const numeroCuotasPendientes = cuotasPendientes.length;

    // 3. Calcular montos
    const capitalActual = new Big(credit.capital ?? 0);
    const cuotaInteres = new Big(credit.cuota_interes ?? 0);
    const membresiasPago = new Big(credit.membresias_pago ?? 0);
    const seguro10Cuotas = new Big(credit.seguro_10_cuotas ?? 0);
    const iva12 = new Big(credit.iva_12 ?? 0);

    const totalInteresesPendientes = cuotaInteres.times(numeroCuotasPendientes);
    const totalMembresiasPendientes = membresiasPago.times(
      numeroCuotasPendientes
    );
    const totalSeguroPendiente = seguro10Cuotas.times(numeroCuotasPendientes);
    const totalIvaPendiente = iva12.times(numeroCuotasPendientes);

    // 4. Devolver la info
    return {
      message: "Resumen del crédito a cancelar",
      credito: {
        capital_actual: capitalActual.toFixed(2),
        total_intereses_pendientes: totalInteresesPendientes.toFixed(2),
        total_membresias_pendientes: totalMembresiasPendientes.toFixed(2),
        total_seguro_pendiente: totalSeguroPendiente.toFixed(2),
        total_iva_pendiente: totalIvaPendiente.toFixed(2),
        cuotas_pendientes: numeroCuotasPendientes,
      },
    };
  } catch (error) {
    console.error("Error cancelando crédito:", error);
    return { message: "Error cancelando crédito", error: String(error) };
  }
}

const MontoAdicionalSchema = z.object({
  concepto: z.string().min(1),
  monto: z.number(), // positivo suma / negativo descuenta
});
// Define the inferred type from the schema
type MontoAdicional = z.infer<typeof MontoAdicionalSchema>;

const AccionCreditoParamsSchema = z.object({
  creditId: z.number(),
  motivo: z.string().optional(),
  observaciones: z.string().optional(),
  monto_cancelacion: z.number().optional(),
  accion: z.enum([
    "CANCELAR",
    "ACTIVAR",
    "INCOBRABLE",
    "PENDIENTE_CANCELACION",
  ]),
  montosAdicionales: z.array(MontoAdicionalSchema).optional(),
});

const STATUS_MAP = {
  CANCELAR: "CANCELADO",
  PENDIENTE_CANCELACION: "PENDIENTE_CANCELACION",
  // Puedes agregar más acciones aquí si las necesitas
};

/**
 * Actualiza el estado de un crédito: cancela o activa según el parámetro 'accion'.
 */
export type AccionCreditoParams = z.infer<typeof AccionCreditoParamsSchema>;

export async function actualizarEstadoCredito(input: AccionCreditoParams) {
  // Validate input
  const {
    creditId,
    motivo,
    observaciones,
    monto_cancelacion,
    accion,
    montosAdicionales,
  } = AccionCreditoParamsSchema.parse(input);

  // Guard rails for actions that require motivo + monto
  const needsReasonAndAmount =
    accion === "CANCELAR" ||
    accion === "PENDIENTE_CANCELACION" ||
    accion === "INCOBRABLE";
  if (needsReasonAndAmount && (!motivo || monto_cancelacion == null)) {
    return {
      ok: false,
      message: "Debes enviar 'motivo' y 'monto_cancelacion' para esta acción.",
    };
  }

  try {
    const result = await db.transaction(async (tx) => {
      /** 1) OPCIONAL: insertar montos adicionales ANTES del cambio de estado */
      if (montosAdicionales?.length) {
        await tx.insert(montos_adicionales).values(
          montosAdicionales.map((m) => ({
            credit_id: creditId,
            concepto: m.concepto,
            monto: m.monto.toString(), // numeric -> string
          }))
        );
      }

      /** 2) Cambios según acción */
      if (accion === "CANCELAR" || accion === "PENDIENTE_CANCELACION") {
        const newStatus =
          STATUS_MAP[accion as keyof typeof STATUS_MAP] ||
          "PENDIENTE_CANCELACION";

        // a) Update credit status
        await tx
          .update(creditos)
          .set({
            statusCredit: newStatus as
              | "CANCELADO"
              | "ACTIVO"
              | "INCOBRABLE"
              | "PENDIENTE_CANCELACION",
          })
          .where(eq(creditos.credito_id, creditId));

        // b) Register cancelation (idempotent insert; assume one row per credit)
        await tx.insert(credit_cancelations).values({
          credit_id: creditId,
          motivo: motivo!, // validated above
          observaciones: observaciones ?? "",
          monto_cancelacion: monto_cancelacion!.toString(),
        });

        return {
          ok: true,
          message: `Crédito ${newStatus.toLowerCase().replace("_", " ")} correctamente`,
        };
      }

      if (accion === "ACTIVAR") {
        // a) Set ACTIVE
        await tx
          .update(creditos)
          .set({ statusCredit: "ACTIVO" })
          .where(eq(creditos.credito_id, creditId));

        // b) Remove cancelation & bad debt records
        await tx
          .delete(credit_cancelations)
          .where(eq(credit_cancelations.credit_id, creditId));
        await tx.delete(bad_debts).where(eq(bad_debts.credit_id, creditId));
        await tx
          .delete(montos_adicionales)
          .where(eq(montos_adicionales.credit_id, creditId));

        return {
          ok: true,
          message: "Crédito reactivado y registros de cierre eliminados",
        };
      }

      // accion === "INCOBRABLE"
      // a) Set UNCOLLECTIBLE
      await tx
        .update(creditos)
        .set({ statusCredit: "INCOBRABLE" })
        .where(eq(creditos.credito_id, creditId));

      // b) Register bad debt
      await tx.insert(bad_debts).values({
        credit_id: creditId,
        motivo: motivo!, // validated above
        observaciones: observaciones ?? "",
        monto_incobrable: monto_cancelacion!.toString(),
      });

      return {
        ok: true,
        message: "Crédito marcado como incobrable correctamente",
      };
    });

    return result;
  } catch (err) {
    console.error("[ERROR] actualizarEstadoCredito:", err);
    return {
      ok: false,
      message: "[ERROR] No fue posible actualizar el estado del crédito",
    };
  }
}
/**
 * Obtiene todos los créditos marcados como incobrables, junto con su usuario e información relevante.
 * Permite paginación para evitar respuestas demasiado grandes.
 * Si se pasa el número de crédito SIFCO, filtra solo ese crédito.
 * @param page Página (empieza en 1)
 * @param perPage Registros por página (default 20)
 * @param numero_credito_sifco (opcional) Número de crédito SIFCO para filtrar
 */
export async function getCreditosIncobrables(
  page: number = 1,
  perPage: number = 20,
  numero_credito_sifco?: string
) {
  try {
    console.log(
      "[getCreditosIncobrables] Iniciando consulta de créditos incobrables..."
    );
    const offset = (page - 1) * perPage;

    // Condición de filtro opcional por número de crédito SIFCO
    const whereCondition =
      numero_credito_sifco && numero_credito_sifco.length > 0
        ? and(
            eq(creditos.statusCredit, "INCOBRABLE"),
            eq(creditos.numero_credito_sifco, numero_credito_sifco)
          )
        : eq(creditos.statusCredit, "INCOBRABLE");

    // Buscar créditos incobrables paginados
    const creditosIncobrables = await db
      .select({
        creditos,
        usuarios,
        asesores,
        bad_debt: bad_debts,
      })
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
      .innerJoin(bad_debts, eq(creditos.credito_id, bad_debts.credit_id))
      .where(eq(creditos.statusCredit, "INCOBRABLE"))
      .orderBy(desc(creditos.fecha_creacion))
      .limit(perPage)
      .offset(offset);

    // Total para paginación
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(creditos)
      .where(eq(creditos.statusCredit, "INCOBRABLE"));

    console.log(
      `[getCreditosIncobrables] Créditos incobrables encontrados: ${creditosIncobrables.length}`
    );
    return {
      ok: true,
      data: creditosIncobrables,
      page,
      perPage,
      totalCount: Number(count),
      totalPages: Math.ceil(Number(count) / perPage),
    };
  } catch (error) {
    console.error(
      "[getCreditosIncobrables] Error al obtener créditos incobrables:",
      error
    );
    return {
      ok: false,
      message: "Error al obtener créditos incobrables",
      error: String(error),
    };
  }
}

export async function reiniciarCredito(
  creditId: number,
  montoIncobrable?: number
) {
  await db
    .update(creditos)
    .set({
      capital: "0",
      porcentaje_interes: "0",
      deudatotal: montoIncobrable !== undefined ? String(montoIncobrable) : "0",
      cuota_interes: "0",
      cuota: "0",
      iva_12: "0",
      seguro_10_cuotas: "0",
      gps: "0",
      membresias_pago: "0",
      membresias: "0",
      porcentaje_royalti: "0",
      royalti: "0",
      mora: "0",
      otros: "0",
      statusCredit: "ACTIVO",
    })
    .where(eq(creditos.credito_id, creditId));
}

function construirUrlBoletas(url_boletas: string[], r2BaseUrl: string) {
  return url_boletas.map((url_boleta) => `${r2BaseUrl}${url_boleta}`);
}
export async function resetCredit({
  creditId,
  montoIncobrable,
  montoBoleta,
  url_boletas,
  cuota,
}: {
  creditId: number;
  montoIncobrable?: number;
  montoBoleta: number | string;
  url_boletas: string[];
  cuota: number;
}) {
  try {
    const statusCredit =
      typeof montoIncobrable !== "undefined" &&
      montoIncobrable > 0 &&
      montoBoleta !== undefined
        ? "INCOBRABLE"
        : "CANCELADO";
    // 1. Reinicia el crédito poniendo todos los montos a cero y el estado como ACTIVO
    await db
      .update(creditos)
      .set({
        capital: "0",
        porcentaje_interes: "0",
        deudatotal:
          montoIncobrable !== undefined ? String(montoIncobrable) : "0",
        cuota_interes: "0",
        cuota: "0",
        iva_12: "0",
        seguro_10_cuotas: "0",
        gps: "0",
        membresias_pago: "0",
        membresias: "0",
        porcentaje_royalti: "0",
        royalti: "0",
        mora: "0",
        otros: "0",
        statusCredit: statusCredit,
      })
      .where(eq(creditos.credito_id, creditId));

    // 2. Consulta el crédito para validar que existe
    const [credito] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, creditId));
    if (!credito) {
      throw new Error("Crédito no encontrado.");
    }

    // 3. Construye las URLs completas para las boletas usando la base R2 (de tu env)
    const r2BaseUrl = import.meta.env.URL_PUBLIC_R2 ?? "";
    const urlCompletas = construirUrlBoletas(url_boletas, r2BaseUrl);

    // 4. Obtiene el monto pagado del mes actual y suma el monto de boleta actual
    const pago_del_mes = await getPagosDelMesActual(credito.credito_id);
    const pago_del_mesBig = new Big(pago_del_mes ?? 0).add(montoBoleta ?? 0);
    // Buscar la cuota_id correspondiente al número de cuota recibido en el parámetro 'cuota'
    const [cuotaEncontrada] = await db
      .select({ cuota_id: cuotas_credito.cuota_id })
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, credito.credito_id),
          eq(cuotas_credito.numero_cuota, cuota)
        )
      )
      .limit(1);

    const cuotaId = cuotaEncontrada?.cuota_id;

    // 5. Inserta el nuevo pago para el crédito reiniciado
    const [nuevoPago] = await db
      .insert(pagos_credito)
      .values({
        credito_id: credito.credito_id,
        cuota_id: cuotaId,
        cuota: credito.cuota?.toString() ?? "0",
        cuota_interes: credito.cuota_interes?.toString() ?? "0",
        abono_capital: "0",
        abono_interes: "0",
        abono_iva_12: "0",
        abono_interes_ci: "0",
        abono_iva_ci: "0",
        abono_seguro: "0",
        abono_gps: "0",
        pago_del_mes: pago_del_mesBig.toString(),
        monto_boleta: montoBoleta.toString(),
        capital_restante: credito.capital?.toString() ?? "0",
        interes_restante: credito.cuota_interes?.toString() ?? "0",
        iva_12_restante: credito.iva_12?.toString() ?? "0",
        seguro_restante: credito.seguro_10_cuotas?.toString() ?? "0",
        gps_restante: credito.gps?.toString() ?? "0",
        total_restante: credito.deudatotal?.toString() ?? "0",
        llamada: "",
        renuevo_o_nuevo: "renuevo",
        membresias: credito.membresias_pago?.toString() ?? "",
        membresias_pago: credito.membresias_pago?.toString() ?? "",
        membresias_mes: credito.membresias_pago?.toString() ?? "",
        otros: "0",
        mora: "0",
        monto_boleta_cuota: montoBoleta.toString(),
        seguro_total: credito.seguro_10_cuotas?.toString() ?? "0",
        pagado: true,
        facturacion: "si",
        mes_pagado: "",
        seguro_facturado: credito.seguro_10_cuotas?.toString() ?? "0",
        gps_facturado: credito.gps?.toString() ?? "0",
        reserva: "0",
        observaciones: "",
      })
      .returning();

    await db
      .delete(pagos_credito)
      .where(
        and(
          eq(pagos_credito.credito_id, credito.credito_id),
          eq(pagos_credito.pagado, false)
        )
      );

    // 6. Si hay URLs de boletas, las asocia al nuevo pago
    if (
      urlCompletas &&
      urlCompletas.length > 0 &&
      nuevoPago &&
      nuevoPago?.pago_id
    ) {
      await db.insert(boletas).values(
        urlCompletas.map((url) => ({
          pago_id: nuevoPago?.pago_id,
          url_boleta: url,
        }))
      );
    }

    // 7. Retorna OK
    return {
      ok: true,
      message: "Crédito reiniciado y pago creado exitosamente.",
    };
  } catch (error) {
    console.error("[ERROR] reiniciarCreditoYCrearPago:", error);
    throw new Error("Error al reiniciar el crédito y crear el pago.");
  }
}

type SyncTermsInput = {
  creditoId: number;
  newCuota: number; // incoming updated cuota
  newPlazo: number; // incoming updated plazo (months)
  // Optional: pass preloaded credit to save a roundtrip (if you already fetched it)
  preloadCredit?: {
    cuota: string | number;
    plazo: number;
    capital: string | number;
    porcentaje_interes: string | number;
    iva_12: string | number;
    deudatotal: string | number;
    seguro_10_cuotas: string | number;
    gps: string | number;
    membresias_pago: string | number;
    formato_credito?: string | null;
  };
};

export async function syncScheduleOnTermsChange({
  creditoId,
  newCuota,
  newPlazo,
  preloadCredit,
}: SyncTermsInput) {
  return await db.transaction(async (tx) => {
    // 1) Load current credit
    const [credit] = preloadCredit
      ? [{ credito_id: creditoId, ...preloadCredit }]
      : await tx
          .select({
            credito_id: creditos.credito_id,
            cuota: creditos.cuota,
            plazo: creditos.plazo,
            capital: creditos.capital,
            porcentaje_interes: creditos.porcentaje_interes,
            iva_12: creditos.iva_12,
            deudatotal: creditos.deudatotal,
            seguro_10_cuotas: creditos.seguro_10_cuotas,
            gps: creditos.gps,
            membresias_pago: creditos.membresias_pago,
            formato_credito: creditos.formato_credito,
          })
          .from(creditos)
          .where(eq(creditos.credito_id, creditoId));

    if (!credit) {
      throw new Error("[ERROR] Credit not found");
    }

    const oldCuotaNum = Number(credit.cuota ?? 0);
    const oldPlazoNum = Number(credit.plazo ?? 0);
    const changedCuota = Number(newCuota) !== oldCuotaNum;
    const changedPlazo = Number(newPlazo) !== oldPlazoNum;

    if (!changedCuota && !changedPlazo) {
      // Nothing to do
      return { updated: false, reason: "No changes" };
    }

    // --- helper: generate due dates like your creation logic (30th or last day) ---
    function generateNextDates(fromDateISO: string, count: number): string[] {
      // fromDateISO = 'YYYY-MM-DD'
      const [y, m, d] = fromDateISO.split("-").map((v) => Number(v));
      const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon UTC
      const dates: string[] = [];

      for (let i = 0; i < count; i++) {
        const dt = new Date(base);
        // move month + i + 1 (next months)
        dt.setUTCMonth(dt.getUTCMonth() + i + 1);

        const month = dt.getUTCMonth();
        const year = dt.getUTCFullYear();
        // last day of month
        const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const day = lastDay < 30 ? lastDay : 30;

        const final = new Date(Date.UTC(year, month, day, 12, 0, 0));
        // Return in 'sv-SE' like your logic (YYYY-MM-DD)
        const iso = final
          .toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" })
          .toString();
        dates.push(iso);
      }
      return dates;
    }

    // --- 2) If only cuota changed: update cuota in UNPAID payments ---
    if (changedCuota && !changedPlazo) {
      await tx
        .update(pagos_credito)
        .set({
          // only cuota changes, everything else stays as-is
          cuota: new Big(newCuota).round(2).toString(),
        })
        .where(
          and(
            eq(pagos_credito.credito_id, creditoId),
            eq(pagos_credito.pagado, false)
          )
        );

      // Reflect new cuota in creditos row (keeping your other totals untouched)
      await tx
        .update(creditos)
        .set({ cuota: new Big(newCuota).round(2).toString() })
        .where(eq(creditos.credito_id, creditoId));

      return { updated: true, changedCuota: true, changedPlazo: false };
    }

    // --- 3) If plazo changed: add/remove schedule, and also handle cuota change if applies ---
    // Load current cuotas (excluding numero_cuota = 0 "cuota inicial")
    const cuotasRows = await tx
      .select({
        cuota_id: cuotas_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
      })
      .from(cuotas_credito)
      .where(eq(cuotas_credito.credito_id, creditoId));

    const cuotasReal = cuotasRows.filter((c) => c.numero_cuota > 0);
    const maxNumero = cuotasReal.reduce(
      (acc, r) => Math.max(acc, Number(r.numero_cuota)),
      0
    );

    // Update cuota for unpaid rows if cuota also changed
    if (changedCuota) {
      await tx
        .update(pagos_credito)
        .set({
          cuota: new Big(newCuota).round(2).toString(),
        })
        .where(
          and(
            eq(pagos_credito.credito_id, creditoId),
            eq(pagos_credito.pagado, false)
          )
        );
    }

    if (newPlazo > oldPlazoNum) {
      // --- 3.a) Increase plazo: append missing cuotas & pagos ---
      const toAppend = newPlazo - oldPlazoNum;

      // last scheduled date to continue from:
      const lastCuota = cuotasReal.sort(
        (a, b) => a.numero_cuota - b.numero_cuota
      )[cuotasReal.length - 1];
      const lastDateISO = lastCuota
        ? (lastCuota.fecha_vencimiento as string)
        : // fallback: if for some reason there is no cuota > 0, base from today like insert
          new Date()
            .toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" })
            .toString();

      const newDates = generateNextDates(lastDateISO, toAppend);

      // Insert cuotas_credito batch
      const newCuotasToInsert = newDates.map((fecha, idx) => ({
        credito_id: creditoId,
        numero_cuota: maxNumero + idx + 1,
        fecha_vencimiento: fecha,
        pagado: false,
      }));

      const insertedCuotas = await tx
        .insert(cuotas_credito)
        .values(newCuotasToInsert)
        .returning({
          cuota_id: cuotas_credito.cuota_id,
          numero_cuota: cuotas_credito.numero_cuota,
          fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        });

      // Build pagos for each new cuota, mirroring your creation template
      const cuotaStr = new Big(changedCuota ? newCuota : oldCuotaNum)
        .round(2)
        .toString();

      const pagosToInsert = insertedCuotas.map((c) => ({
        credito_id: creditoId,
        cuota: cuotaStr,
        // keep interest per your credit row (unchanged here)
        cuota_interes: new Big(credit.porcentaje_interes ?? 0)
          .times(new Big(credit.capital ?? 0).div(100))
          .round(2)
          .toString(), // same formula you used on create (capital * rate%)
        cuota_id: c.cuota_id,
        fecha_pago: c.fecha_vencimiento,
        abono_capital: "0",
        abono_interes: "0",
        abono_iva_12: "0",
        abono_interes_ci: "0",
        abono_iva_ci: "0",
        abono_seguro:
          Number(credit.seguro_10_cuotas ?? 0) > 0 ? "0" : undefined,
        abono_gps: Number(credit.gps ?? 0) > 0 ? "0" : undefined,
        pago_del_mes: "0",
        monto_boleta: "0",
        fecha_filtro: c.fecha_vencimiento,
        renuevo_o_nuevo: "",
        capital_restante: new Big(credit.capital ?? 0).toString(),
        interes_restante: new Big(credit.porcentaje_interes ?? 0)
          .times(new Big(credit.capital ?? 0).div(100))
          .round(2)
          .toString(),
        iva_12_restante: new Big(credit.porcentaje_interes ?? 0)
          .times(new Big(credit.capital ?? 0).div(100))
          .times(0.12)
          .round(2)
          .toString(),
        seguro_restante: new Big(credit.seguro_10_cuotas ?? 0).toString(),
        gps_restante: new Big(credit.gps ?? 0).toString(),
        total_restante: new Big(credit.deudatotal ?? 0).toString(),
        membresias: new Big(credit.membresias_pago ?? 0).toString(),
        membresias_pago: new Big(credit.membresias_pago ?? 0).toString(),
        membresias_mes: new Big(credit.membresias_pago ?? 0).toString(),
        otros: "",
        mora: "0",
        monto_boleta_cuota: "0",
        seguro_total: new Big(credit.seguro_10_cuotas ?? 0).toString(),
        pagado: false,
        facturacion: "si",
        mes_pagado: "",
        seguro_facturado: new Big(credit.seguro_10_cuotas ?? 0).toString(),
        gps_facturado: new Big(credit.gps ?? 0).toString(),
        reserva: "0",
        observaciones: "",
        paymentFalse: false,
      }));

      await tx.insert(pagos_credito).values(pagosToInsert);
    } else if (newPlazo < oldPlazoNum) {
      // --- 3.b) Decrease plazo: remove extra unpaid quotas & their payments ---
      const extra = cuotasReal.filter((c) => Number(c.numero_cuota) > newPlazo);

      // Safety: if any of the "extra" are paid, abort
      const paidExtra = extra.filter((c) => c.pagado);
      if (paidExtra.length > 0) {
        throw new Error(
          "[ERROR] Cannot reduce plazo below a paid cuota. Please reverse or adjust paid cuotas first."
        );
      }

      const extraCuotaIds = extra.map((c) => c.cuota_id);
      if (extraCuotaIds.length > 0) {
        // delete related pagos first
        await tx
          .delete(pagos_credito)
          .where(inArray(pagos_credito.cuota_id, extraCuotaIds));
        // then delete cuotas
        await tx
          .delete(cuotas_credito)
          .where(inArray(cuotas_credito.cuota_id, extraCuotaIds));
      }
    }

    // --- 4) Persist credit row fields actually changed (only cuota/plazo) ---
    const updateSet: Record<string, any> = {};
    if (changedCuota) updateSet.cuota = new Big(newCuota).round(2).toString();
    if (changedPlazo) updateSet.plazo = Number(newPlazo);

    if (Object.keys(updateSet).length > 0) {
      await tx
        .update(creditos)
        .set(updateSet)
        .where(eq(creditos.credito_id, creditoId));
    }

    return { updated: true, changedCuota, changedPlazo };
  });
}
