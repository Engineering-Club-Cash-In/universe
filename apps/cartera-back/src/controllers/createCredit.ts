import Big from "big.js";
import z from "zod";
import { db } from "../database";
import { 
  creditos, 
  creditos_rubros_otros, 
  creditos_inversionistas, 
  cuotas_credito, 
  pagos_credito 
} from "../database/db";
import { findOrCreateAdvisorByName } from "./advisor";
import { findOrCreateUserByName } from "./users";

// ========================================
// TIPOS E INTERFACES
// ========================================

interface Inversionista {
  inversionista_id: number;
  cuota_inversionista?: number;
  porcentaje_cash_in: number;
  porcentaje_inversion: number;
  monto_aportado: number;
}

interface Rubro {
  nombre_rubro: string;
  monto: number;
}

type CreditData = z.infer<typeof creditSchema>;

interface SetContext {
  status: number;
}

interface ValidationResult {
  success: boolean;
  error?: {
    message: string;
    [key: string]: unknown;
  };
}

interface CreditDataForInsert {
  usuario_id: number;
  otros: string;
  numero_credito_sifco: string;
  capital: string;
  porcentaje_interes: string;
  cuota: string;
  cuota_interes: string;
  deudatotal: string;
  seguro_10_cuotas: string;
  gps: string;
  observaciones: string;
  no_poliza: string;
  como_se_entero: string;
  asesor_id: number;
  plazo: number;
  iva_12: string;
  membresias_pago: string;
  membresias: string;
  formato_credito: string;
  porcentaje_royalti: string;
  royalti: string;
  tipoCredito: string;
  mora: string;
}

interface NewCredit {
  credito_id: number;
  [key: string]: unknown;
}

interface User {
  usuario_id: number;
}

interface Advisor {
  asesor_id: number;
}

interface InversionistaData {
  credito_id: number;
  inversionista_id: number;
  monto_aportado: string;
  porcentaje_cash_in: string;
  porcentaje_participacion_inversionista: string;
  monto_inversionista: string;
  monto_cash_in: string;
  iva_inversionista: string;
  iva_cash_in: string;
  fecha_creacion: Date;
  cuota_inversionista: string;
}

interface CuotaInsertada {
  cuota_id: number;
  numero_cuota: number;
  fecha_vencimiento: string;
}

interface PagoData {
  credito_id: number;
  cuota: string;
  cuota_interes: string;
  cuota_id?: number;
  fecha_pago?: string | null;
  abono_capital: string;
  abono_interes: string;
  abono_iva_12: string;
  abono_interes_ci: string;
  abono_iva_ci: string;
  abono_seguro?: string;
  abono_gps?: string;
  pago_del_mes: string;
  monto_boleta: string;
  fecha_vencimiento: string;
  renuevo_o_nuevo: string;
  capital_restante: string;
  interes_restante: string;
  iva_12_restante: string;
  seguro_restante: string;
  gps_restante: string;
  total_restante: string;
  membresias: string;
  membresias_pago: string;
  membresias_mes: string;
  otros: string;
  mora: string;
  monto_boleta_cuota: string;
  seguro_total: string;
  pagado: boolean;
  facturacion: string;
  mes_pagado: string;
  seguro_facturado: string;
  gps_facturado: string;
  reserva: string;
  observaciones: string;
  paymentFalse: boolean;
  pagoConvenio: string;
}

// ========================================
// SCHEMA DE VALIDACIÓN
// ========================================

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
        monto_aportado: z.number().positive(),
        porcentaje_cash_in: z.number().min(0).max(100),
        porcentaje_inversion: z.number().min(0).max(100),
        cuota_inversionista: z.number().min(0).optional(),
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

// ========================================
// 1. VALIDACIONES
// ========================================

const validateCreditData = (creditData: CreditData, set: SetContext): ValidationResult => {
  // Validar suma de cuotas inversionistas
  const totalCuotaInversionista = creditData.inversionistas.reduce(
    (acc: Big, inv: Inversionista) => acc.plus(inv.cuota_inversionista ?? 0),
    new Big(0)
  );

  const totalCuotaInversionistaRedondeado = totalCuotaInversionista.round(2);
  if (Number(creditData.cuota) !== totalCuotaInversionistaRedondeado.toNumber()) {
    set.status = 400;
    return {
      success: false,
      error: {
        message: "La suma de las cuotas asignadas a los inversionistas debe ser igual a la cuota del crédito.",
        cuotaEsperada: creditData.cuota,
        totalCuotaInversionista: totalCuotaInversionistaRedondeado.toNumber(),
      }
    };
  }

  // Validar porcentajes cash_in + inversion = 100
  for (const inv of creditData.inversionistas) {
    const sumaPorcentajes = Number(inv.porcentaje_cash_in ?? 0) + Number(inv.porcentaje_inversion ?? 0);
    if (sumaPorcentajes !== 100) {
      set.status = 400;
      return {
        success: false,
        error: {
          message: `El inversionista con ID ${inv.inversionista_id} no tiene porcentajes válidos. La suma debe ser 100.`,
          sumaPorcentajes,
        }
      };
    }
  }

  // Validar suma de montos aportados
  const totalMontoAportado = creditData.inversionistas.reduce(
    (acc: Big, inv: Inversionista) => acc.plus(inv.monto_aportado ?? 0),
    new Big(0)
  );

  if (Number(creditData.capital) !== totalMontoAportado.toNumber()) {
    set.status = 400;
    return {
      success: false,
      error: {
        message: "La suma de los montos aportados por los inversionistas debe ser igual al capital del crédito.",
        capitalEsperado: creditData.capital,
        totalMontoAportado: totalMontoAportado.toNumber(),
      }
    };
  }

  return { success: true };
};

// ========================================
// 2. INSERCIÓN DE CRÉDITO Y RELACIONADOS
// ========================================

const insertCreditAndRelated = async (creditData: CreditData): Promise<{
  newCredit: NewCredit;
  creditDataForInsert: CreditDataForInsert;
  total_monto_cash_in: Big;
  total_iva_cash_in: Big;
}> => {
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

  // Buscar o crear usuario y asesor
  const user: User = await findOrCreateUserByName(
    creditData.usuario,
    creditData.categoria,
    creditData.nit,
    creditData.como_se_entero
  );

  const advisor: Advisor = await findOrCreateAdvisorByName(creditData.asesor, true);

  const formatCredit = creditData.inversionistas.some(
    (inv: Inversionista) => Number(inv.porcentaje_inversion) > 1
  ) ? "Pool" : "Individual";

  const creditDataForInsert: CreditDataForInsert = {
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
    mora: "0",
  };

  console.log("Credit data to insert:", creditDataForInsert);

  // Insertar crédito principal
  const [newCredit] = await db
    .insert(creditos)
    .values(creditDataForInsert)
    .returning();

  console.log("Inserted credit:", newCredit);

  // Insertar rubros si existen
  if (creditData.rubros && creditData.rubros.length > 0) {
    const rubrosToInsert = creditData.rubros.map((r: Rubro) => ({
      credito_id: newCredit.credito_id,
      nombre_rubro: r.nombre_rubro,
      monto: r.monto.toString(),
    }));

    await db.insert(creditos_rubros_otros).values(rubrosToInsert);
    console.log("Inserted rubros:", rubrosToInsert);
  }

  // Insertar inversionistas
  const creditosInversionistasData: InversionistaData[] = creditData.inversionistas.map((inv: Inversionista) => {
    const montoAportado = new Big(inv.monto_aportado);
    const porcentajeCashIn = new Big(inv.porcentaje_cash_in);
    const porcentajeInversion = new Big(inv.porcentaje_inversion);
    const interes = new Big(creditDataForInsert.porcentaje_interes ?? 0);
    const newCuotaInteres = new Big(montoAportado ?? 0).times(interes.div(100));

    const montoInversionista = newCuotaInteres.times(porcentajeInversion).div(100).toFixed(2);
    const montoCashIn = newCuotaInteres.times(porcentajeCashIn).div(100).toFixed(2);

    const ivaInversionista = Number(montoInversionista) > 0 
      ? new Big(montoInversionista).times(0.12) 
      : new Big(0);
    const ivaCashIn = Number(montoCashIn) > 0 
      ? new Big(montoCashIn).times(0.12) 
      : new Big(0);

    const cuotaInv = inv.cuota_inversionista === 0
      ? creditData.cuota.toString()
      : inv.cuota_inversionista?.toString() ?? creditData.cuota.toString();

    return {
      credito_id: newCredit.credito_id,
      inversionista_id: inv.inversionista_id,
      monto_aportado: montoAportado.toString(),
      porcentaje_cash_in: porcentajeCashIn.toString(),
      porcentaje_participacion_inversionista: porcentajeInversion.toString(),
      monto_inversionista: montoInversionista.toString(),
      monto_cash_in: montoCashIn.toString(),
      iva_inversionista: ivaInversionista.toString(),
      iva_cash_in: ivaCashIn.toString(),
      fecha_creacion: new Date(),
      cuota_inversionista: cuotaInv,
    };
  });

  let total_monto_cash_in = new Big(0);
  let total_iva_cash_in = new Big(0);

  creditosInversionistasData.forEach(({ monto_cash_in, iva_cash_in }: InversionistaData) => {
    total_monto_cash_in = total_monto_cash_in.plus(monto_cash_in);
    total_iva_cash_in = total_iva_cash_in.plus(iva_cash_in);
  });

  if (creditosInversionistasData.length > 0) {
    await db.insert(creditos_inversionistas).values(creditosInversionistasData);
  }

  return {
    newCredit,
    creditDataForInsert,
    total_monto_cash_in,
    total_iva_cash_in,
  };
};

// ========================================
// 3. GENERACIÓN DE FECHAS
// ========================================

const generatePaymentDates = (plazo: number): string[] => {
  const fechas: string[] = [];
  const startDate = new Date();
  
  const fechaHoy = new Date();
  const fechaHoyGuate = fechaHoy.toLocaleDateString("sv-SE", {
    timeZone: "America/Guatemala",
  });
  
  fechas.push(fechaHoyGuate);

  for (let i = 0; i < plazo; i++) {
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

  return fechas;
};

// ========================================
// 4. INSERCIÓN DE CUOTAS
// ========================================

const insertInstallments = async (
  creditId: number,
  plazo: number,
  fechas: string[]
): Promise<{ cuotaInicial: number | undefined; cuotasInsertadas: CuotaInsertada[] }> => {
  // Insertar cuota inicial (cuota 0)
  const cuotaInicialArr = await db
    .insert(cuotas_credito)
    .values({
      credito_id: creditId,
      numero_cuota: 0,
      fecha_vencimiento: fechas[0],
      pagado: true,
    })
    .returning({ cuota_id: cuotas_credito.cuota_id });

  const cuotaInicial: number | undefined = Array.isArray(cuotaInicialArr) && cuotaInicialArr.length > 0
    ? cuotaInicialArr[0].cuota_id
    : undefined;

  // Insertar cuotas regulares
  const cuotas = [];
  for (let i = 0; i < plazo; i++) {
    cuotas.push({
      credito_id: creditId,
      numero_cuota: i + 1,
      fecha_vencimiento: fechas[i + 1] || fechas[fechas.length - 1],
      pagado: false,
    });
  }

  const cuotasInsertadas: CuotaInsertada[] = await db
    .insert(cuotas_credito)
    .values(cuotas)
    .returning({
      cuota_id: cuotas_credito.cuota_id,
      numero_cuota: cuotas_credito.numero_cuota,
      fecha_vencimiento: cuotas_credito.fecha_vencimiento,
    });

  return { cuotaInicial, cuotasInsertadas };
};
// ========================================
// 5. INSERCIÓN DE PAGOS CON AMORTIZACIÓN
// ========================================
const insertPayments = async (
  creditData: CreditData,
  newCredit: NewCredit,
  creditDataForInsert: CreditDataForInsert,
  total_monto_cash_in: Big,
  total_iva_cash_in: Big,
  cuotaInicial: number | undefined,
  cuotasInsertadas: CuotaInsertada[],
  fechas: string[]
): Promise<void> => {
  const pagos: PagoData[] = [];

  // Montos fijos por mes (NO cambian)
  const seguroFijoPorMes = new Big(creditData.seguro_10_cuotas ?? 0);
  const gpsFijoPorMes = new Big(creditData.gps ?? 0);
  const membresiasFijoPorMes = new Big(creditData.membresias_pago ?? 0);
  const porcentajeInteres = new Big(creditData.porcentaje_interes ?? 0).div(100);

  // Capital que va en memoria (se va restando hasta llegar a 0)
  let capitalEnMemoria = new Big(creditDataForInsert.capital);

  // Deuda total del crédito (se queda fija)
  const deudaTotalCredito = new Big(creditDataForInsert.deudatotal);

  // Pago inicial (cuota 0) - NO SE TOCA
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
    fecha_vencimiento: fechas[0],
    renuevo_o_nuevo: "",
    capital_restante: creditDataForInsert.capital,
    interes_restante: creditDataForInsert.cuota_interes,
    iva_12_restante: creditDataForInsert.iva_12,
    seguro_restante: seguroFijoPorMes.toString(),
    gps_restante: gpsFijoPorMes.toString(),
    total_restante: deudaTotalCredito.toString(),
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
    pagoConvenio: "0",
  });

  // Cuota mensual
  const cuotaMensual = new Big(creditDataForInsert.cuota);

  // Pagos para cada cuota regular (MES A MES)
  for (let i = 0; i < cuotasInsertadas.length; i++) {
    const cuota = cuotasInsertadas[i];

    // Calcular interés e IVA del MES basado en el capital en memoria
    const interesMes = capitalEnMemoria.times(porcentajeInteres).round(2);
    const ivaMes = interesMes.times(0.12).round(2);

    // Abonos fijos del mes
    const abonoSeguro = seguroFijoPorMes;
    const abonoGps = gpsFijoPorMes;
    const abonoMembresias = membresiasFijoPorMes;

    // Calcular abono a capital del MES
    // Cuota = Interés + IVA + Seguro + GPS + Membresías + Abono a Capital
    const montosExtras = interesMes.plus(ivaMes).plus(abonoSeguro).plus(abonoGps).plus(abonoMembresias);
    const abonoCapital = cuotaMensual.minus(montosExtras);

    // Restar el abono del capital en memoria
    capitalEnMemoria = capitalEnMemoria.minus(abonoCapital);
    if (capitalEnMemoria.lt(0)) capitalEnMemoria = new Big(0);

    // Restantes del MES (no acumulativos)
    const capitalRestanteMes = abonoCapital;  // Lo que falta pagar de capital en este mes
    const interesRestanteMes = interesMes;    // El interés del mes
    const ivaRestanteMes = ivaMes;            // El IVA del mes
    const seguroRestanteMes = abonoSeguro;    // El seguro del mes
    const gpsRestanteMes = abonoGps;          // El GPS del mes

    pagos.push({
      credito_id: newCredit.credito_id,
      cuota: creditDataForInsert.cuota,
      cuota_interes: creditDataForInsert.cuota_interes,
      cuota_id: cuota.cuota_id,
      fecha_pago: null,
      abono_capital: "0",
      abono_interes: "0",
      abono_iva_12: "0",
      abono_interes_ci: "0",
      abono_iva_ci: "0",
      abono_seguro:  "0",
      abono_gps:  "0",
      pago_del_mes: cuotaMensual.toString(),
      monto_boleta: "0",
      fecha_vencimiento: cuota.fecha_vencimiento,
      renuevo_o_nuevo: "",
      capital_restante: capitalRestanteMes.round(2).toString(),
      interes_restante: interesRestanteMes.round(2).toString(),
      iva_12_restante: ivaRestanteMes.round(2).toString(),
      seguro_restante: seguroRestanteMes.toString(),
      gps_restante: gpsRestanteMes.toString(),
      total_restante: capitalEnMemoria.round(2).toString(),  // El capital que falta en total
      membresias: membresiasFijoPorMes.toString(),
      membresias_pago: membresiasFijoPorMes.toString(),
      membresias_mes: membresiasFijoPorMes.toString(),
      otros: "",
      mora: "0",
      monto_boleta_cuota: "0",
      seguro_total:   "0",
      pagado: false,
      facturacion: "si",
      mes_pagado: "",
      seguro_facturado: creditData.seguro_10_cuotas?.toString() ?? "0",
      gps_facturado: creditData.gps?.toString() ?? "0",
      reserva: "0",
      observaciones: "",
      paymentFalse: false,
      pagoConvenio: "0",
    });
  }

  // Filtrar e insertar pagos válidos
  const pagosValidos = pagos.filter((p) => p.cuota_id !== undefined);
  const pagosValidosSinUndefined = pagosValidos.map((p) => ({
    ...p,
    cuota_id: p.cuota_id as number,
    fecha_pago: p.fecha_pago ? new Date(p.fecha_pago) : null,
    registerBy: "system",
  }));

  await db.insert(pagos_credito).values(pagosValidosSinUndefined);
};
// ========================================
// FUNCIÓN PRINCIPAL
// ========================================

export const insertCredit = async ({ body, set }: { body: unknown; set: SetContext }) => {
  try {
    // 1. Validar schema
    const parseResult = creditSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const creditData = parseResult.data;

    // 2. Validar datos del crédito
    const validation = validateCreditData(creditData, set);
    if (!validation.success) {
      return validation.error;
    }

    // 3. Insertar crédito y datos relacionados
    const { newCredit, creditDataForInsert, total_monto_cash_in, total_iva_cash_in } = 
      await insertCreditAndRelated(creditData);

    // 4. Generar fechas de pago
    const fechas = generatePaymentDates(creditData.plazo);

    // 5. Insertar cuotas
    const { cuotaInicial, cuotasInsertadas } = await insertInstallments(
      newCredit.credito_id,
      creditData.plazo,
      fechas
    );

    // 6. Insertar pagos
    await insertPayments(
      creditData,
      newCredit,
      creditDataForInsert,
      total_monto_cash_in,
      total_iva_cash_in,
      cuotaInicial,
      cuotasInsertadas,
      fechas
    );

    set.status = 201;
    return newCredit;
  } catch (error) {
    console.log("Error inserting credit:", error);
    set.status = 500;
    return { message: "Error inserting credit", error: String(error) };
  }
};