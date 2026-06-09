import Big from "big.js";
import { eq, and, inArray, asc, gt, lte, gte, sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  cuotas_credito,
  pagos_credito,
  usuarios,
  historial_devolucion_credito,
} from "../database/db";
import z from "zod";
import type { WSCrEstadoCuentaResponse } from "../services/sifco.interface";
import { consultarEstadoCuentaPrestamo } from "../services/sifcoIntegrations";
import { withAuditContext } from "../utils/withAuditContext";

interface UpdateInstallmentsParams {
  numero_credito_sifco: string;
  nueva_cuota: number;
  all?: boolean;
}

const updateInstallments = async ({
  numero_credito_sifco,
  nueva_cuota,

  all = false,
}: UpdateInstallmentsParams): Promise<void> => {
  // 1️⃣ Obtener crédito y pagos en paralelo (en lugar de secuencial)
  const [creditoResult, todosPagos] = await Promise.all([
    db
      .select({
        credito_id: creditos.credito_id,
        capital: creditos.capital,
        deudatotal: creditos.deudatotal,
        porcentaje_interes: creditos.porcentaje_interes,
        cuota_interes: creditos.cuota_interes,
        iva_12: creditos.iva_12,
        seguro_10_cuotas: creditos.seguro_10_cuotas,
        gps: creditos.gps,
        membresias_pago: creditos.membresias_pago,
      })
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
      .limit(1),

    // Solo traer cuotas NO pagadas, ordenadas por numero_cuota (no por cuota_id)
    db
      .select()
      .from(pagos_credito)
      .innerJoin(
        cuotas_credito,
        eq(pagos_credito.cuota_id, cuotas_credito.cuota_id),
      )
      .where(
        and(
          eq(
            pagos_credito.credito_id,
            db
              .select({ id: creditos.credito_id })
              .from(creditos)
              .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
              .limit(1),
          ),
          eq(pagos_credito.pagado, all),
        ),
      )
      .orderBy(asc(cuotas_credito.numero_cuota))
      .then((rows) => rows.map((r) => r.pagos_credito)),
  ]);

  const credito = creditoResult[0];

  // 2️⃣ Validaciones
  if (!credito) {
    throw new Error(
      `No se encontró el crédito con número SIFCO: ${numero_credito_sifco}`,
    );
  }

  if (todosPagos.length === 0) {
    throw new Error("No hay cuotas pendientes por actualizar");
  }

  // 3️⃣ Pre-calcular constantes una sola vez (fuera del loop)
  const capitalInicial = new Big(credito.capital);
  const seguroFijoPorMes = new Big(credito.seguro_10_cuotas ?? 0);
  const gpsFijoPorMes = new Big(credito.gps ?? 0);
  const membresiasFijoPorMes = new Big(credito.membresias_pago ?? 0);
  const porcentajeInteres = new Big(credito.porcentaje_interes ?? 0).div(100);
  const cuotaMensual = new Big(nueva_cuota);
  const cuotaInteresCredito = credito.cuota_interes;

  // Capital en memoria (saldo actual)
  let capitalEnMemoria = capitalInicial;

  // 4️⃣ Amortización real: interés calculado sobre capital que va quedando
  const actualizaciones = todosPagos.map((pago) => {
    const interesMes = capitalEnMemoria.times(porcentajeInteres).round(2);
    const ivaMes = interesMes.times(0.12).round(2);

    const montosExtras = interesMes
      .plus(ivaMes)
      .plus(seguroFijoPorMes)
      .plus(gpsFijoPorMes)
      .plus(membresiasFijoPorMes);
    const abonoCapital = cuotaMensual.minus(montosExtras);

    capitalEnMemoria = capitalEnMemoria.minus(abonoCapital);
    if (capitalEnMemoria.lt(0)) capitalEnMemoria = new Big(0);

    return {
      pago_id: pago.pago_id,
      datos: {
        cuota: cuotaMensual.toString(),
        cuota_interes: cuotaInteresCredito,
        capital_restante: abonoCapital.round(2).toString(),
        interes_restante: interesMes.round(2).toString(),
        iva_12_restante: ivaMes.round(2).toString(),
        seguro_restante: seguroFijoPorMes.toString(),
        gps_restante: gpsFijoPorMes.toString(),
        total_restante: capitalEnMemoria.round(2).toString(),
        membresias: membresiasFijoPorMes.toString(),
        membresias_pago: pago.validationStatus === "pending" ? pago.membresias_pago : "0",
        membresias_mes: pago.validationStatus === "pending" ? pago.membresias_mes : "0",
      },
    };
  });

  // 5️⃣ Ejecutar TODAS las actualizaciones en paralelo (batch update)
  await Promise.all([
    // Actualizar todos los pagos pendientes
    ...actualizaciones.map(({ pago_id, datos }) =>
      db
        .update(pagos_credito)
        .set(datos)
        .where(eq(pagos_credito.pago_id, pago_id)),
    ),
    // Actualizar el crédito
    db
      .update(creditos)
      .set({ cuota: cuotaMensual.toString() })
      .where(eq(creditos.credito_id, credito.credito_id)),
  ]);

  console.log(
    `✅ Se actualizaron ${todosPagos.length} cuotas para el crédito ${numero_credito_sifco}`,
  );
};

export { updateInstallments };

// ========================================
// RECALCULAR CUOTA CON FÓRMULA PMT
// ========================================

function calculateMonthlyPayment(
  principal: number,
  monthlyRate: number,
  termMonths: number,
  insuranceCost: number,
  gpsCost: number,
  membresiasCost: number,
): number {
  const r = (monthlyRate / 100) * 1.12;
  if (r === 0)
    return principal / termMonths + insuranceCost + gpsCost + membresiasCost;
  const factor = (1 + r) ** termMonths;
  const baseMonthlyPayment = (principal * (r * factor)) / (factor - 1);
  return baseMonthlyPayment + insuranceCost + gpsCost + membresiasCost;
}

const recalculateQuotaSchema = z.object({
  numero_credito_sifco: z.string().min(1),
});

export const recalculateQuota = async ({ body, set }: any) => {
  try {
    const parseResult = recalculateQuotaSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const { numero_credito_sifco } = parseResult.data;

    // 1. Buscar el crédito
    const [credito] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
      .limit(1);

    if (!credito) {
      set.status = 404;
      return { message: "Crédito no encontrado" };
    }

    const capital = Number(credito.capital);
    const monthlyRate = Number(credito.porcentaje_interes);

    // Contamos cuotas DISTINTAS por numero_cuota: una misma cuota puede tener
    // varias filas (p. ej. un abono extraordinario que crea otra fila con el
    // mismo numero_cuota). count(distinct numero_cuota) evita inflar el plazo.
    // Excluimos numero_cuota 0: la numeración real arranca en 1, la 0 es una
    // fila fantasma que no representa una cuota del plan.
    const [{ cuotasPagadas }] = await db
      .select({
        cuotasPagadas: sql<number>`count(distinct ${cuotas_credito.numero_cuota})::int`,
      })
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, credito.credito_id),
          eq(cuotas_credito.pagado, true),
          gt(cuotas_credito.numero_cuota, 0),
        ),
      );

    const termMonths = Number(credito.plazo) - Number(cuotasPagadas);

    if (termMonths <= 0) {
      set.status = 400;
      return {
        message:
          "No hay cuotas pendientes para recalcular (plazo - cuotas pagadas <= 0)",
      };
    }

    const insuranceCost = Number(credito.seguro_10_cuotas ?? 0);
    const gpsCost = Number(credito.gps ?? 0);
    const membresiasCost = Number(credito.membresias_pago ?? 0);

    // 2. Calcular nueva cuota con PMT
    const nuevaCuota = Number(
      new Big(
        calculateMonthlyPayment(
          capital,
          monthlyRate,
          termMonths,
          insuranceCost,
          gpsCost,
          membresiasCost,
        ),
      ).round(2),
    );

    // 3. Actualizar el crédito con la nueva cuota
    await db
      .update(creditos)
      .set({
        cuota: nuevaCuota.toString(),
      })
      .where(eq(creditos.credito_id, credito.credito_id));

    // 4. Actualizar las cuotas pendientes con updateInstallments
    await updateInstallments({
      numero_credito_sifco,
      nueva_cuota: nuevaCuota,
    });

    // 5. Recalcular cuotas de inversionistas (padre + espejo) con la nueva cuota total
    const updateFieldsRecalc = {
      cuota: nuevaCuota.toString(),
      porcentaje_interes: credito.porcentaje_interes,
      seguro_10_cuotas: credito.seguro_10_cuotas,
      gps: credito.gps,
      membresias_pago: credito.membresias_pago,
    };

    const invsPadre = await db
      .select()
      .from(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, credito.credito_id));

    const invsEspejo = await db
      .select()
      .from(creditos_inversionistas_espejo)
      .where(eq(creditos_inversionistas_espejo.credito_id, credito.credito_id));

    const mapToInvestorInput = (inv: any) => ({
      inversionista_id: inv.inversionista_id,
      monto_aportado: inv.monto_aportado,
      porcentaje_cash_in: inv.porcentaje_cash_in,
      porcentaje_inversion: inv.porcentaje_participacion_inversionista,
      fecha_inicio_participacion: inv.fecha_inicio_participacion,
    });

    let parentCuotas: Map<number, string> = new Map();
    if (invsPadre.length > 0) {
      parentCuotas = await updateInvestors(
        credito.credito_id,
        invsPadre.map(mapToInvestorInput) as any,
        updateFieldsRecalc,
        credito,
        numero_credito_sifco,
        Number(credito.seguro_10_cuotas ?? 0),
        Number(credito.membresias_pago ?? 0),
        Number(credito.gps ?? 0),
        creditos_inversionistas,
      );
    }

    if (invsEspejo.length > 0) {
      const espejoSincronizado = invsEspejo.map((inv) => ({
        ...mapToInvestorInput(inv),
        cuota_inversionista: parentCuotas.get(inv.inversionista_id),
      }));

      await updateInvestors(
        credito.credito_id,
        espejoSincronizado as any,
        updateFieldsRecalc,
        credito,
        numero_credito_sifco,
        Number(credito.seguro_10_cuotas ?? 0),
        Number(credito.membresias_pago ?? 0),
        Number(credito.gps ?? 0),
        creditos_inversionistas_espejo,
        parentCuotas,
      );
    }

    // 6. Traer los inversionistas ya recalculados para devolverlos
    const invsPadreActualizado = await db
      .select()
      .from(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, credito.credito_id));

    const invsEspejoActualizado = await db
      .select()
      .from(creditos_inversionistas_espejo)
      .where(eq(creditos_inversionistas_espejo.credito_id, credito.credito_id));

    set.status = 200;
    return {
      success: true,
      message: "Cuota recalculada y cuotas actualizadas correctamente",
      data: {
        numero_credito_sifco,
        capital: capital.toString(),
        nueva_cuota: nuevaCuota.toString(),
        porcentaje_interes: monthlyRate.toString(),
        plazo: termMonths,
        inversionistas: invsPadreActualizado.map((inv) => ({
          inversionista_id: inv.inversionista_id,
          monto_aportado: inv.monto_aportado,
          porcentaje_participacion_inversionista:
            inv.porcentaje_participacion_inversionista,
          porcentaje_cash_in: inv.porcentaje_cash_in,
          cuota_inversionista: inv.cuota_inversionista,
          monto_inversionista: inv.monto_inversionista,
          monto_cash_in: inv.monto_cash_in,
          iva_inversionista: inv.iva_inversionista,
          iva_cash_in: inv.iva_cash_in,
        })),
        inversionistas_espejo: invsEspejoActualizado.map((inv) => ({
          inversionista_id: inv.inversionista_id,
          monto_aportado: inv.monto_aportado,
          porcentaje_participacion_inversionista:
            inv.porcentaje_participacion_inversionista,
          porcentaje_cash_in: inv.porcentaje_cash_in,
          cuota_inversionista: inv.cuota_inversionista,
          monto_inversionista: inv.monto_inversionista,
          monto_cash_in: inv.monto_cash_in,
          iva_inversionista: inv.iva_inversionista,
          iva_cash_in: inv.iva_cash_in,
          status: inv.status,
          tipo_reinversion: inv.tipo_reinversion,
        })),
      },
    };
  } catch (error) {
    console.error("Error en recalculateQuota:", error);
    set.status = 500;
    return {
      message: "Error al recalcular la cuota",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// ========================================
// TIPOS E INTERFACES
// ========================================

const creditUpdateSchema = z.object({
  credito_id: z.number().int().positive(),
  cuota: z.number().min(0),
  plazo: z.number().min(0),
  mora: z.number().optional(),
  numero_credito_sifco: z.string().max(1000).optional(),
  asesor_id: z.number().int().positive().optional(),
  inversionistas: z
    .array(
      z.object({
        inversionista_id: z.number().int().positive(),
        monto_aportado: z.number().nonnegative(),
        porcentaje_cash_in: z.number().min(0).max(100),
        porcentaje_inversion: z.number().min(0).max(100),
        fecha_inicio_participacion: z.string().optional(),
        cuota_inversionista: z.number().min(0).optional(),
      }),
    )
    .min(0)
    .optional(),
  inversionistas_espejo: z
    .array(
      z.object({
        inversionista_id: z.number().int().positive(),
        monto_aportado: z.number().nonnegative(),
        porcentaje_cash_in: z.number().min(0).max(100),
        porcentaje_inversion: z.number().min(0).max(100),
        fecha_inicio_participacion: z.string().optional(),
        cuota_inversionista: z.number().min(0).optional(),
      }),
    )
    .min(0)
    .optional(),
  capital: z.number().nonnegative(),
  porcentaje_interes: z.number().min(0).max(100),
  seguro_10_cuotas: z.number().min(0),
  membresias_pago: z.number().min(0),
  otros: z.number().min(0),
  // Campos de usuario
  nombre: z.string().max(200).optional(),
  nit: z.string().max(30).optional(),
  direccion: z.string().max(300).optional(),
  saldo_a_favor: z.number().min(0).optional(),
  // Formato de crédito manual
  formato_credito: z.string().max(50).optional(),
  permite_abono_capital: z.boolean().optional(),
  estado_devolucion: z.enum(['NO_APLICA', 'PENDIENTE_AUTORIZACION', 'VERIFICADO', 'RECHAZADO']).optional(),
  motivo_devolucion: z.string().optional(),
  bandera_reinversion: z.boolean().optional(),
});

type CreditUpdateData = z.infer<typeof creditUpdateSchema>;

interface ValidationResult {
  success: boolean;
  error?: {
    message: string;
    [key: string]: unknown;
  };
}

interface SetContext {
  status: number;
}

// ========================================
// 1. VALIDACIONES
// ========================================

/**
 * Valida que los porcentajes de inversionistas sumen 100%
 */
const validateInvestorsPercentages = (
  inversionistas: CreditUpdateData["inversionistas"],
  set: SetContext,
): ValidationResult => {
  if (!inversionistas) return { success: true };
  for (const inv of inversionistas) {
    const total =
      Number(inv.porcentaje_cash_in) + Number(inv.porcentaje_inversion);
    if (total !== 100) {
      set.status = 400;
      return {
        success: false,
        error: {
          message: `El cash-in y la inversión para el inversionista con ID ${inv.inversionista_id} deben sumar 100%`,
          detalle: { inversionista_id: inv.inversionista_id, total },
        },
      };
    }
  }
  return { success: true };
};

/**
 * Valida que la suma de montos aportados coincida con el capital
 */
const validateInvestorsCapital = (
  inversionistas: CreditUpdateData["inversionistas"],
  capital: number,
  set: SetContext,
): ValidationResult => {
  if (!inversionistas) return { success: true };
  const totalMontoAportado = inversionistas.reduce(
    (acc: Big, inv) => acc.plus(inv.monto_aportado ?? 0),
    new Big(0),
  );
  const totalMontoAportadoRedondeado = totalMontoAportado.round(2);

  if (Number(capital) !== totalMontoAportadoRedondeado.toNumber()) {
    set.status = 400;
    return {
      success: false,
      error: {
        message:
          "La suma de los montos aportados de los inversionistas debe ser igual al capital del crédito.",
        capitalEsperado: capital,
        totalMontoAportado: totalMontoAportadoRedondeado.toNumber(),
      },
    };
  }
  return { success: true };
};

// ========================================
// 2. CÁLCULO DE DEUDA TOTAL
// ========================================

/**
 * Calcula la deuda total del crédito basándose en los parámetros
 */
function calcularDeudaTotal({
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
  const bigCapital = new Big(capital);
  const interes = bigCapital.times(new Big(porcentaje_interes).div(100));
  const iva_12 = interes.times(0.12).round(2);

  const deudatotal = bigCapital
    .plus(interes)
    .plus(iva_12)
    .plus(seguro_10_cuotas ?? 0)
    .plus(gps ?? 0)
    .plus(membresias_pago ?? 0)
    .plus(otros ?? 0);

  return {
    capital: bigCapital.round(2).toString(),
    interes: interes.round(2).toString(),
    iva_12: iva_12.toString(),
    totalDeuda: deudatotal.toString(),
    cuota: cuota.toString(),
    plazo: plazo.toString(),
    gps: gps.toString(),
  };
}

// ========================================
// 3. DETECCIÓN DE CAMBIOS QUE AFECTAN LA DEUDA
// ========================================

/**
 * Detecta si hubo cambios en campos que afectan la deuda total
 */
const detectDebtAffectingChanges = (
  fieldsToUpdate: Partial<CreditUpdateData>,
  current: any,
): boolean => {
  const camposQueModificanDeuda = [
    "capital",
    "porcentaje_interes",
    "seguro_10_cuotas",
    "membresias_pago",
    "otros",
    "cuota",
    "plazo",

  ];

  return camposQueModificanDeuda.some((campo) => {
    const nuevo = fieldsToUpdate[campo as keyof typeof fieldsToUpdate];
    const actual = current[campo as keyof typeof current];

    const isValidBigSource = (v: unknown): v is string | number =>
      typeof v === "string" || typeof v === "number";

    return (
      nuevo !== undefined &&
      isValidBigSource(nuevo) &&
      isValidBigSource(actual) &&
      !new Big(nuevo).eq(new Big(actual))
    );
  });
};

// ========================================
// 4. ACTUALIZACIÓN DE CUOTA INICIAL (OTROS)
// ========================================

/**
 * Actualiza el campo "otros" en la cuota inicial si cambió
 */
const updateInitialQuotaOtros = async (
  credito_id: number,
  otros: number,
): Promise<void> => {
  const cuotaInicial = await db
    .select({ id: cuotas_credito.cuota_id })
    .from(cuotas_credito)
    .where(
      and(
        eq(cuotas_credito.credito_id, credito_id),
        eq(cuotas_credito.numero_cuota, 0),
      ),
    );

  if (cuotaInicial.length) {
    await db
      .update(pagos_credito)
      .set({ otros: otros.toString() })
      .where(eq(pagos_credito.cuota_id, cuotaInicial[0].id));
  }
};

// ========================================
// 5. ACTUALIZACIÓN DE INVERSIONISTAS
// ========================================

/**
 * Actualiza los inversionistas del crédito
 */
const updateInvestors = async (
  credito_id: number,
  inversionistas:
    | CreditUpdateData["inversionistas"]
    | CreditUpdateData["inversionistas_espejo"],
  updateFields: any,
  current: any,
  numero_credito_sifco: string,
  seguro: number,
  membresias: number,
  gps: number,
  targetTable: any = creditos_inversionistas,
  parentCuotas?: Map<number, string>,
  dbInstance: typeof db = db,
): Promise<Map<number, string>> => {
  if (!inversionistas || inversionistas.length === 0) return new Map();

  // 🔥 NUEVO: Obtener los datos existentes ANTES de borrar para preservar el estado
  const existingRecords = await dbInstance
    .select()
    .from(targetTable)
    .where(eq(targetTable.credito_id, credito_id));

  const statePrevioMap = new Map();
  existingRecords.forEach((record: any) => {
      // Guardamos status y tipo_reinversion si existen en la tabla (aplica para tabla espejo)
      statePrevioMap.set(record.inversionista_id, {
          status: record.status,
          tipo_reinversion: record.tipo_reinversion
      });
  });

  // Eliminar inversionistas existentes
  await dbInstance
    .delete(targetTable)
    .where(eq(targetTable.credito_id, credito_id));
  console.log(current.capital, "current values ");

  // 🔥 OBTENER CAPITAL Y CUOTA TOTAL DEL CRÉDITO (usar valores nuevos si existen)
  const capitalTotal = inversionistas.reduce(
    (acc: Big, inv) => acc.plus(inv.monto_aportado),
    new Big(0),
  );
  const cuotaTotal = new Big(updateFields.cuota ?? current?.cuota);

  console.log(`💰 Capital Total: Q${capitalTotal.toFixed(2)}`);
  console.log(`📊 Cuota Total: Q${cuotaTotal.toFixed(2)}`);

  // Preparar datos de nuevos inversionistas
  const creditosInversionistasData = inversionistas.map((inv, index, arr) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📊 PROCESANDO INVERSIONISTA #${index + 1}`);
    console.log(`${"=".repeat(60)}`);

    const montoAportado = new Big(inv.monto_aportado);
    const porcentajeCashIn = new Big(inv.porcentaje_cash_in);
    const porcentajeInversion = new Big(inv.porcentaje_inversion);

    console.log(`🆔 ID Inversionista: ${inv.inversionista_id}`);
    console.log(`💰 Monto Aportado: Q${montoAportado.toFixed(2)}`);
    console.log(`💵 Capital Total del Crédito: Q${capitalTotal.toFixed(2)}`);

    // 🔥 CALCULAR PORCENTAJE DE PARTICIPACIÓN
    const porcentajeParticipacion = capitalTotal.gt(0)
      ? montoAportado.div(capitalTotal).times(100)
      : new Big(0);

    console.log(`\n📐 CÁLCULO DE PARTICIPACIÓN:`);
    console.log(
      `   Fórmula: (${montoAportado.toFixed(2)} / ${capitalTotal.toFixed(2)}) * 100`,
    );
    console.log(`   Resultado: ${porcentajeParticipacion.toFixed(4)}%`);

    // 🔥 PASO 1: RESTAR CARGOS DE LA CUOTA TOTAL
    console.log(`\n💳 CUOTA TOTAL Y CARGOS:`);
    console.log(`   Cuota Total: Q${cuotaTotal.toFixed(2)}`);
    console.log(`   - Seguro: Q${seguro.toFixed(2)}`);
    console.log(`   - GPS: Q${gps.toFixed(2)}`);
    console.log(`   - Membresía: Q${membresias.toFixed(2)}`);

    const cuotaSinCargos = cuotaTotal.minus(seguro).minus(gps).minus(membresias);

    console.log(`   = Cuota sin cargos: Q${cuotaSinCargos.toFixed(2)}`);
    console.log(
      `   Fórmula: ${cuotaTotal.toFixed(2)} - ${seguro.toFixed(2)} - ${gps.toFixed(2)} - ${membresias.toFixed(2)}`,
    );

    // 🔥 PASO 2: MULTIPLICAR POR EL PORCENTAJE
    console.log(`\n🔢 PASO 2: MULTIPLICAR POR PORCENTAJE`);
    console.log(
      `   Fórmula: ${cuotaSinCargos.toFixed(2)} * (${porcentajeParticipacion.toFixed(4)}% / 100)`,
    );

    const cuotaBase = cuotaSinCargos
      .times(porcentajeParticipacion.div(100))
      .round(6);

    console.log(`   Cuota Base Calculada: Q${cuotaBase.toFixed(6)}`);

    // 🔥 ENCONTRAR AL INVERSIONISTA CON MAYOR MONTO APORTADO
    console.log(`\n🔍 BUSCANDO INVERSIONISTA CON MAYOR MONTO APORTADO:`);

    arr.forEach((invTemp, idx) => {
      const montoTemp = new Big(invTemp.monto_aportado);
      console.log(
        `   [${idx + 1}] ID ${invTemp.inversionista_id}: Q${montoTemp.toFixed(2)}`,
      );
    });

    const inversionistaMayor = arr.reduce((max, current) =>
      new Big(current.monto_aportado).gt(new Big(max.monto_aportado))
        ? current
        : max,
    );

    console.log(
      `   🏆 Mayor encontrado: ID ${inversionistaMayor.inversionista_id} con Q${new Big(inversionistaMayor.monto_aportado).toFixed(2)}`,
    );

    const esMayor =
      inv.inversionista_id === inversionistaMayor.inversionista_id;

    console.log(
      `   ¿Es este inversionista el mayor? ${esMayor ? "✅ SÍ" : "❌ NO"}`,
    );

    // 🔥 PASO 3: CALCULAR CUOTA FINAL
    let cuotaInversionista = cuotaBase;

    console.log(`\n🎯 PASO 3: CALCULAR CUOTA FINAL`);

    // 🔥 PRIORIDAD 1: Si viene cuota_inversionista desde el frontend, usarla
    if (inv.cuota_inversionista !== undefined && inv.cuota_inversionista !== null) {
      cuotaInversionista = new Big(inv.cuota_inversionista);
      console.log(`   🚀 FRONTEND: Usando cuota enviada desde el endpoint: Q${cuotaInversionista.toFixed(2)}`);
    } else if (parentCuotas && parentCuotas.has(inv.inversionista_id)) {
      // Prioridad 2: Si es espejo, jalar la cuota del padre
      cuotaInversionista = new Big(parentCuotas.get(inv.inversionista_id)!);
      console.log(`   🪞 ESPEJO: Usando cuota del padre: Q${cuotaInversionista.toFixed(2)}`);
    } else if (esMayor) {
      // Prioridad 3: Cálculo automático para el inversionista mayor
      console.log(`   🏆 ESTE ES EL INVERSIONISTA MAYOR`);
      console.log(`   Cuota Base: Q${cuotaBase.toFixed(6)}`);
      console.log(`   + Seguro: Q${seguro.toFixed(2)}`);
      console.log(`   + GPS: Q${gps.toFixed(2)}`);
      console.log(`   + Membresía: Q${membresias.toFixed(2)}`);

      cuotaInversionista = cuotaBase.plus(seguro).plus(gps).plus(membresias).round(6);

      console.log(`   = Cuota Final Automática: Q${cuotaInversionista.toFixed(6)}`);
      console.log(
        `   Fórmula: ${cuotaBase.toFixed(6)} + ${seguro.toFixed(2)} + ${gps.toFixed(2)} + ${membresias.toFixed(2)}`,
      );
    } else {
      console.log(`   📍 Inversionista normal (no es el mayor)`);
      console.log(
        `   Cuota Final Automática = Cuota Base: Q${cuotaInversionista.toFixed(6)}`,
      );
      console.log(`   (No se suman cargos)`);
    }

    // Calcular interés sobre el monto aportado
    console.log(`\n💹 CÁLCULO DE INTERESES:`);
    const interes = new Big(
      updateFields.porcentaje_interes ?? current?.porcentaje_interes ?? 0,
    );
    console.log(`   Tasa de Interés: ${interes.toFixed(2)}%`);
    console.log(`   Monto Aportado: Q${montoAportado.toFixed(2)}`);

    const newCuotaInteres = montoAportado.times(interes.div(100)).round(2);
    console.log(`   Interés Calculado: Q${newCuotaInteres.toFixed(2)}`);
    console.log(
      `   Fórmula: ${montoAportado.toFixed(2)} * (${interes.toFixed(2)}% / 100)`,
    );

    // Distribución del interés entre inversionista y cash-in
    console.log(`\n📊 DISTRIBUCIÓN DE INTERÉS:`);
    console.log(`   % Inversionista: ${porcentajeInversion.toFixed(2)}%`);
    console.log(`   % Cash-In: ${porcentajeCashIn.toFixed(2)}%`);

    const montoInversionista = newCuotaInteres
      .times(porcentajeInversion)
      .div(100)
      .round(2);

    const montoCashIn = newCuotaInteres
      .times(porcentajeCashIn)
      .div(100)
      .round(2);

    console.log(`   Monto Inversionista: Q${montoInversionista.toFixed(2)}`);
    console.log(
      `   Fórmula: ${newCuotaInteres.toFixed(2)} * (${porcentajeInversion.toFixed(2)}% / 100)`,
    );
    console.log(`   Monto Cash-In: Q${montoCashIn.toFixed(2)}`);
    console.log(
      `   Fórmula: ${newCuotaInteres.toFixed(2)} * (${porcentajeCashIn.toFixed(2)}% / 100)`,
    );

    // Calcular IVAs
    console.log(`\n🧾 CÁLCULO DE IVA (12%):`);

    const ivaInversionista = montoInversionista.gt(0)
      ? montoInversionista.times(0.12).round(2)
      : new Big(0);

    const ivaCashIn = montoCashIn.gt(0)
      ? montoCashIn.times(0.12).round(2)
      : new Big(0);

    if (montoInversionista.gt(0)) {
      console.log(`   IVA Inversionista: Q${ivaInversionista.toFixed(2)}`);
      console.log(`   Fórmula: ${montoInversionista.toFixed(2)} * 0.12`);
    } else {
      console.log(`   IVA Inversionista: Q0.00 (sin monto)`);
    }

    if (montoCashIn.gt(0)) {
      console.log(`   IVA Cash-In: Q${ivaCashIn.toFixed(2)}`);
      console.log(`   Fórmula: ${montoCashIn.toFixed(2)} * 0.12`);
    } else {
      console.log(`   IVA Cash-In: Q0.00 (sin monto)`);
    }

    console.log(`\n✅ RESUMEN FINAL:`);
    console.log(`   - Cuota Inversionista: Q${cuotaInversionista.toFixed(2)}`);
    console.log(`   - Monto Inversionista: Q${montoInversionista.toFixed(2)}`);
    console.log(`   - IVA Inversionista: Q${ivaInversionista.toFixed(2)}`);
    console.log(`   - Monto Cash-In: Q${montoCashIn.toFixed(2)}`);
    console.log(`   - IVA Cash-In: Q${ivaCashIn.toFixed(2)}`);
    console.log(`${"=".repeat(60)}\n`);

    const prevData = statePrevioMap.get(inv.inversionista_id);

    const baseReturn: any = {
      credito_id: credito_id,
      inversionista_id: inv.inversionista_id,
      monto_aportado: montoAportado.toString(),
      porcentaje_cash_in: porcentajeCashIn.toString(),
      porcentaje_participacion_inversionista: porcentajeInversion.toString(),
      monto_inversionista: montoInversionista.toString(),
      monto_cash_in: montoCashIn.toString(),
      iva_inversionista: ivaInversionista.toString(),
      iva_cash_in: ivaCashIn.toString(),
      fecha_creacion: new Date(),
      fecha_inicio_participacion: inv.fecha_inicio_participacion
        ? new Date(inv.fecha_inicio_participacion).toISOString().split('T')[0]
        : "2025-12-01",
      cuota_inversionista: cuotaInversionista.toString(), // 🔥 CON LÓGICA CORRECTA
      numero_credito_sifco: numero_credito_sifco ?? undefined,
    };

    // 🔥 REINCORPORAR ESTADOS PREVIOS SI APLICA
    if (prevData?.status !== undefined) baseReturn.status = prevData.status;
    if (prevData?.tipo_reinversion !== undefined) baseReturn.tipo_reinversion = prevData.tipo_reinversion;

    return baseReturn;
  });

  // Insertar nuevos inversionistas
  if (creditosInversionistasData.length > 0) {
    await dbInstance.insert(targetTable).values(creditosInversionistasData);
  }

  // 🔥 CAPTURAR Y DEVOLVER MAP DE CUOTAS PARA SINCRONIZACIÓN CON ESPEJO
  const cuotasMap = new Map<number, string>(
    creditosInversionistasData.map((inv) => [
      inv.inversionista_id,
      String(inv.cuota_inversionista),
    ])
  );
  return cuotasMap;
};

// ========================================
// 6. SINCRONIZACIÓN DE CUOTAS Y PLAZOS
// ========================================

/**
 * Sincroniza las cuotas cuando cambia el monto o el plazo
 */
const syncScheduleOnTermsChange = async ({
  creditoId,
  newCuota,
  newPlazo,
  preloadCredit,
}: {
  creditoId: number;
  newCuota: number;
  newPlazo: number;
  preloadCredit: any;
}): Promise<void> => {
  // Aquí iría la lógica de sincronización
  // Por ahora solo un placeholder
  console.log("Syncing schedule for credit:", creditoId);
  console.log("New quota:", newCuota, "New term:", newPlazo);
};

// ========================================
// FUNCIÓN PRINCIPAL DE ACTUALIZACIÓN
// ========================================

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

const extractUserId = (request: Request): number | null => {
  try {
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "").trim();
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      return decoded.id ?? decoded.user_id ?? null;
    }
  } catch { /* token inválido, continuar sin userId */ }
  return null;
};

export const updateCredit = async ({ body, set, request }: any) => {
  try {
    console.log("Updating credit with body:", body);

    // 1. Validar schema
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
      inversionistas_espejo,
      mora,
      cuota,
      numero_credito_sifco,
      asesor_id,
      nombre,
      nit,
      direccion,
      saldo_a_favor,
      formato_credito,
      permite_abono_capital,
      estado_devolucion,
      motivo_devolucion,
      bandera_reinversion,
      ...fieldsToUpdate
    } = parseResult.data;

    // 2. Buscar el crédito actual
    const [current] = await db
      .select()
      .from(creditos)
      .where(
        and(
          eq(creditos.credito_id, credito_id),
          inArray(creditos.statusCredit, [
            "ACTIVO",
            "MOROSO",
            "PENDIENTE_CANCELACION",
            "EN_CONVENIO",
            "INCOBRABLE"
          ]),
        ),
      )
      .limit(1);

    if (!current) {
      set.status = 400;
      return { message: "Credit not found" };
    }


    // 3. Validar inversionistas
    if (inversionistas && inversionistas.length > 0) {
      const percentagesValidation = validateInvestorsPercentages(
        inversionistas as any,
        set,
      );
      if (!percentagesValidation.success) {
        return percentagesValidation.error;
      }
    }

    // 3.1. Validar inversionistas espejo si existen
    if (inversionistas_espejo && inversionistas_espejo.length > 0) {
      const mirrorValidation = validateInvestorsPercentages(
        inversionistas_espejo as any,
        set
      );
      if (!mirrorValidation.success) {
        return mirrorValidation.error;
      }
    }

    // 3.5 Actualizar datos del usuario si se enviaron
    const userFields: Record<string, string> = {};
    if (nombre !== undefined) userFields.nombre = nombre;
    if (nit !== undefined) userFields.nit = nit;
    if (direccion !== undefined) userFields.direccion = direccion;
    if (saldo_a_favor !== undefined)
      userFields.saldo_a_favor = saldo_a_favor.toString();

    if (Object.keys(userFields).length > 0) {
      await db
        .update(usuarios)
        .set(userFields)
        .where(eq(usuarios.usuario_id, current.usuario_id));
    }

    // 4. Preparar campos de actualización
    const updateFields: any = { ...fieldsToUpdate };

    if (formato_credito !== undefined) {
      updateFields.formato_credito = formato_credito;
    } else {
      const formatCredit = inversionistas.some(
        (inv) => Number(inv.porcentaje_inversion) > 0,
      )
        ? "Pool"
        : "Individual";
      updateFields.formato_credito = formatCredit;
    }
    if (mora !== undefined) updateFields.mora = mora.toString();
    if (cuota !== undefined) updateFields.cuota = cuota.toString();
    if (numero_credito_sifco !== undefined) {
      updateFields.numero_credito_sifco = numero_credito_sifco;
    }
    if (asesor_id !== undefined) {
      // ✅ Agregar al update
      updateFields.asesor_id = asesor_id;
    }
    if (permite_abono_capital !== undefined) {
      updateFields.permite_abono_capital = permite_abono_capital;
    }
    if (estado_devolucion !== undefined) {
      if (estado_devolucion !== current.estado_devolucion) {
        const fromState = current.estado_devolucion;
        let motivoFinal: string | null | undefined = motivo_devolucion;

        const esSolicitudValida =
          estado_devolucion === "PENDIENTE_AUTORIZACION" &&
          (fromState === "NO_APLICA" ||
            fromState === "RECHAZADO" ||
            fromState === "VERIFICADO");
        const esDesactivacionValida =
          estado_devolucion === "NO_APLICA" && fromState === "PENDIENTE_AUTORIZACION";

        // Este endpoint (editar crédito) solo puede solicitar o desactivar solicitud.
        if (!esSolicitudValida && !esDesactivacionValida) {
          set.status = 400;
          return {
            message: `Transición de estado de devolución no permitida en este endpoint (${fromState} -> ${estado_devolucion})`,
          };
        }

        if (esSolicitudValida) {
          if (!motivo_devolucion || motivo_devolucion.trim() === "") {
            set.status = 400;
            return {
              message:
                "Motivo de devolución es obligatorio al solicitar devolución",
            };
          }
          motivoFinal = motivo_devolucion.trim();
        }

        if (esDesactivacionValida) {
          motivoFinal = null;
        }

        await db.insert(historial_devolucion_credito).values({
          credito_id,
          usuario_id: 1, // TODO integrate auth for real user_id
          estado_anterior: fromState,
          estado_nuevo: estado_devolucion,
          motivo: motivoFinal ?? null,
        });

        updateFields.estado_devolucion = estado_devolucion;
      }
    }
    if (bandera_reinversion !== undefined) {
      updateFields.bandera_reinversion = bandera_reinversion;
    }
    // 5. Detectar cambios que afectan la deuda
    const changes = detectDebtAffectingChanges(fieldsToUpdate, current);
    const otrosModificado =
      fieldsToUpdate.otros !== undefined &&
      !new Big(fieldsToUpdate.otros).eq(new Big(current.otros));

    // 6. Verificar cambios en cuota o plazo
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
        preloadCredit: current,
      });
    }

    // 7. Recalcular deuda si hay cambios relevantes
    if (changes) {
      console.log("Changes detected in fields that affect deuda_total");

      const nuevaDeudaTotal = calcularDeudaTotal({
        capital: fieldsToUpdate.capital ?? current.capital,
        porcentaje_interes:
          fieldsToUpdate.porcentaje_interes ?? current.porcentaje_interes,
        seguro_10_cuotas:
          fieldsToUpdate.seguro_10_cuotas ?? current.seguro_10_cuotas,
        membresias_pago:
          fieldsToUpdate.membresias_pago ?? current.membresias_pago,
        otros: fieldsToUpdate.otros ?? current.otros,
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



      // Actualizar "otros" en la cuota inicial si cambió
      if (otrosModificado) {
        await updateInitialQuotaOtros(credito_id, fieldsToUpdate.otros);
      }


    }

    updateFields.membresias =
      fieldsToUpdate.membresias_pago ?? current.membresias_pago;

    // 8. Actualizar el crédito
    const [updatedCredit] = await db
      .update(creditos)
      .set(updateFields)
      .where(eq(creditos.credito_id, credito_id))
      .returning();

    // 8.1 Si la cuota cambió, sincronizar cuotas pendientes y recalcular
    // cuotas de inversionistas (solo si NO vinieron en el body — si vinieron,
    // el bloque siguiente las maneja con la cuota nueva).
    if (willChangeCuota) {
      const sifco = numero_credito_sifco ?? current.numero_credito_sifco;
      const cuotaNuevaNum = Number(updateFields.cuota);

      await updateInstallments({
        numero_credito_sifco: sifco,
        nueva_cuota: cuotaNuevaNum,
      });

      const bodyTraeInversionistas =
        (inversionistas && inversionistas.length > 0) ||
        (inversionistas_espejo && inversionistas_espejo.length > 0);

      if (!bodyTraeInversionistas) {
        const invsPadreActuales = await db
          .select()
          .from(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, credito_id));

        const invsEspejoActuales = await db
          .select()
          .from(creditos_inversionistas_espejo)
          .where(eq(creditos_inversionistas_espejo.credito_id, credito_id));

        const mapToInvestorInput = (inv: any) => ({
          inversionista_id: inv.inversionista_id,
          monto_aportado: inv.monto_aportado,
          porcentaje_cash_in: inv.porcentaje_cash_in,
          porcentaje_inversion: inv.porcentaje_participacion_inversionista,
          fecha_inicio_participacion: inv.fecha_inicio_participacion,
        });

        let cuotasPadreAuto: Map<number, string> = new Map();
        if (invsPadreActuales.length > 0) {
          cuotasPadreAuto = await updateInvestors(
            credito_id,
            invsPadreActuales.map(mapToInvestorInput) as any,
            updateFields,
            current,
            sifco,
            Number(updateFields.seguro_10_cuotas ?? current.seguro_10_cuotas),
            Number(updateFields.membresias_pago ?? current.membresias_pago),
            Number(updateFields.gps ?? current.gps),
            creditos_inversionistas,
          );
        }

        if (invsEspejoActuales.length > 0) {
          const espejoSinc = invsEspejoActuales.map((inv) => ({
            ...mapToInvestorInput(inv),
            cuota_inversionista: cuotasPadreAuto.get(inv.inversionista_id),
          }));

          await updateInvestors(
            credito_id,
            espejoSinc as any,
            updateFields,
            current,
            sifco,
            Number(updateFields.seguro_10_cuotas ?? current.seguro_10_cuotas),
            Number(updateFields.membresias_pago ?? current.membresias_pago),
            Number(updateFields.gps ?? current.gps),
            creditos_inversionistas_espejo,
            cuotasPadreAuto,
          );
        }
      }
    }

    // 9. Actualizar inversionistas (Principal)
    let parentCuotas: Map<number, string> = new Map();
    if (inversionistas && inversionistas.length > 0) {
      parentCuotas = await updateInvestors(
        credito_id,
        inversionistas,
        updateFields,
        current,
        numero_credito_sifco ?? current.numero_credito_sifco,
        Number(updateFields.seguro_10_cuotas ?? current.seguro_10_cuotas),
        Number(updateFields.membresias_pago ?? current.membresias_pago),
        Number(updateFields.gps ?? current.gps),
        creditos_inversionistas // Explicit target
      );
    }

    // 10. Actualizar inversionistas (Espejo)
    console.log(`🪞 [ESPEJO] inversionistas_espejo recibidos: ${JSON.stringify(inversionistas_espejo?.length ?? 'undefined')}`);
    if (inversionistas_espejo && inversionistas_espejo.length > 0) {
      // 🔒 Sincronización forzada solo de cuota_inversionista desde el padre.
      // El monto_aportado del espejo se respeta tal como viene del frontend
      // porque representa el saldo vivo del inversionista (capital - abonos)
      // y puede divergir del padre cuando ya hubo abonos a capital.
      const principalCuotas = new Map(
        (inversionistas || []).map((inv) => [inv.inversionista_id, inv.cuota_inversionista ?? 0])
      );

      const espejoSincronizado = inversionistas_espejo.map((inv) => ({
        ...inv,
        cuota_inversionista: principalCuotas.get(inv.inversionista_id) ?? inv.cuota_inversionista,
      }));

      console.log(`🪞 [ESPEJO] Iniciando updateInvestors para credito_id=${credito_id} con ${espejoSincronizado.length} inversionistas`);
      try {
        const espejoUserId = extractUserId(request);
        const runEspejoUpdate = async (dbInstance: typeof db) =>
          updateInvestors(
            credito_id,
            espejoSincronizado,
            updateFields,
            current,
            numero_credito_sifco ?? current.numero_credito_sifco,
            Number(updateFields.seguro_10_cuotas ?? current.seguro_10_cuotas),
            Number(updateFields.membresias_pago ?? current.membresias_pago),
            Number(updateFields.gps ?? current.gps),
            creditos_inversionistas_espejo,
            parentCuotas,
            dbInstance,
          );

        if (espejoUserId) {
          await withAuditContext(espejoUserId, runEspejoUpdate);
        } else {
          await runEspejoUpdate(db);
        }
        console.log(`🪞 [ESPEJO] ✅ updateInvestors completado para espejo`);
      } catch (espejoError) {
        console.error(`🪞 [ESPEJO] ❌ Error en updateInvestors espejo:`, espejoError);
        throw espejoError;
      }
    } else {
      console.log(`🪞 [ESPEJO] ⚠️ Bloque saltado: inversionistas_espejo está vacío o undefined`);
    }



    set.status = 200;
    return updatedCredit;
  } catch (error) {
    console.error("Error al actualizar el crédito:", error);
    set.status = 500;
    return { message: "Error al actualizar el crédito" };
  }
};
// ========================================
// REPARAR total_restante DE LOS PAGOS
// ========================================

interface RepararTotalRestanteParams {
  numero_credito_sifco: string;
  capital_inicial?: number | string; // Prioridad: param > total_restante de cuota 0 > SIFCO desembolso
  dry_run?: boolean; // Si true, no escribe nada y devuelve la previsualización de cambios
}

type RepararPreviewItem = {
  pago_id: number;
  numero_cuota: number;
  cambios: { campo: string; antes: string; despues: string }[];
};

export const repararTotalRestante = async ({
  numero_credito_sifco,
  capital_inicial,
  dry_run = false,
}: RepararTotalRestanteParams): Promise<{
  credito_id: number;
  capital_arranque: string;
  ultima_cuota_pagada: number | null;
  pagos_actualizados: number;
  dry_run: boolean;
  preview?: RepararPreviewItem[];
}> => {
  console.log("\n🔧 ========== REPARAR pagos históricos ==========");
  console.log(`📋 Crédito SIFCO: ${numero_credito_sifco}`);
  console.log(`🧪 dry_run: ${dry_run}`);
  console.log(
    `💰 capital_inicial recibido: ${capital_inicial ?? "(no se pasó, se resolverá)"}`,
  );

  // 1️⃣ Obtener crédito
  const [credito] = await db
    .select({
      credito_id: creditos.credito_id,
      capital: creditos.capital,
      porcentaje_interes: creditos.porcentaje_interes,
      cuota_interes: creditos.cuota_interes,
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      gps: creditos.gps,
      membresias_pago: creditos.membresias_pago,
      cuota: creditos.cuota,
    })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
    .limit(1);

  if (!credito) {
    throw new Error(`No se encontró el crédito: ${numero_credito_sifco}`);
  }
  console.log(
    `✅ Crédito encontrado: id=${credito.credito_id}, capital_actual=Q${credito.capital}, cuota=Q${credito.cuota}, %interes=${credito.porcentaje_interes}`,
  );

  // 2️⃣ Traer todos los pagos con su cuota (ordenados por numero_cuota, fecha_pago, pago_id)
  const rows = await db
    .select()
    .from(pagos_credito)
    .innerJoin(
      cuotas_credito,
      eq(pagos_credito.cuota_id, cuotas_credito.cuota_id),
    )
    .where(eq(pagos_credito.credito_id, credito.credito_id))
    .orderBy(asc(cuotas_credito.numero_cuota), asc(pagos_credito.pago_id));
  console.log(`📦 Pagos encontrados: ${rows.length}`);

  if (rows.length === 0) {
    console.log(
      `⚠️ No hay pagos para reparar en crédito ${numero_credito_sifco}`,
    );
    return {
      credito_id: credito.credito_id,
      capital_arranque: "0",
      ultima_cuota_pagada: null,
      pagos_actualizados: 0,
      dry_run,
    };
  }

  // 3️⃣ Determinar la última cuota pagada (tope del recálculo)
  const cuotasPagadas = rows
    .filter((r) => r.cuotas_credito.pagado === true)
    .map((r) => r.cuotas_credito.numero_cuota);

  if (cuotasPagadas.length === 0) {
    console.log(
      `⚠️ El crédito ${numero_credito_sifco} no tiene cuotas pagadas, no hay nada que reparar`,
    );
    return {
      credito_id: credito.credito_id,
      capital_arranque: new Big(capital_inicial ?? credito.capital).toString(),
      ultima_cuota_pagada: null,
      pagos_actualizados: 0,
      dry_run,
    };
  }
  const ultimaCuotaPagada = Math.max(...cuotasPagadas);
  console.log(
    `🎯 Última cuota pagada: ${ultimaCuotaPagada} (total cuotas pagadas: ${cuotasPagadas.length})`,
  );

  // 4️⃣ Agrupar pagos por numero_cuota (un numero_cuota puede tener varios cuota_id
  // por ajustes históricos; los tratamos como una sola cuota lógica)
  const pagosPorNumeroCuota = new Map<
    number,
    (typeof rows)[0]["pagos_credito"][]
  >();
  for (const row of rows) {
    const nc = row.cuotas_credito.numero_cuota;
    if (!pagosPorNumeroCuota.has(nc)) pagosPorNumeroCuota.set(nc, []);
    pagosPorNumeroCuota.get(nc)!.push(row.pagos_credito);
  }

  // 5️⃣ Determinar capital_inicial: param > total_restante de cuota 0 > SIFCO
  let capitalArranque: Big;
  if (capital_inicial !== undefined) {
    capitalArranque = new Big(capital_inicial);
    console.log(`🏁 capital_arranque (param): Q${capitalArranque.toString()}`);
  } else {
    const cuota0Row = rows.find((r) => r.cuotas_credito.numero_cuota === 0);
    const totalRestanteCuota0 = cuota0Row?.pagos_credito.total_restante;
    if (
      totalRestanteCuota0 &&
      new Big(totalRestanteCuota0).gt(0)
    ) {
      capitalArranque = new Big(totalRestanteCuota0);
      console.log(
        `🏁 capital_arranque (total_restante de cuota 0): Q${capitalArranque.toString()}`,
      );
    } else {
      console.log("🌐 Consultando desembolso en SIFCO...");
      const estadoCuenta = (await consultarEstadoCuentaPrestamo(
        numero_credito_sifco,
      )) as WSCrEstadoCuentaResponse;
      const transacciones =
        estadoCuenta?.ConsultaResultado?.EstadoCuenta_Transacciones ?? [];
      const desembolso = transacciones.find((t) => t.CrMoTrxCod === 2001);
      if (!desembolso?.CapitalDesembolsado) {
        throw new Error(
          `No se pudo obtener el desembolso de SIFCO para ${numero_credito_sifco}`,
        );
      }
      capitalArranque = new Big(desembolso.CapitalDesembolsado);
      console.log(
        `🏁 capital_arranque (SIFCO desembolso trx 2001): Q${capitalArranque.toString()}`,
      );
    }
  }

  const capitalActual = new Big(credito.capital);
  if (capitalArranque.lt(capitalActual)) {
    throw new Error(
      `capital_inicial (${capitalArranque.toString()}) < credito.capital (${capitalActual.toString()}): inconsistente, no se puede reparar.`,
    );
  }

  const porcentajeInteres = new Big(credito.porcentaje_interes ?? 0).div(100);
  const seguroFijo = new Big(credito.seguro_10_cuotas ?? 0);
  const gpsFijo = new Big(credito.gps ?? 0);
  const membresiasFijo = new Big(credito.membresias_pago ?? 0);
  const cuotaMensual = new Big(credito.cuota);

  // 6️⃣ Procesar cuotas en orden: cuota 0 → última pagada
  const cuotasOrdenadas = [...pagosPorNumeroCuota.entries()]
    .filter(([nc]) => nc <= ultimaCuotaPagada)
    .sort((a, b) => a[0] - b[0]);

  let capitalEnMemoria = capitalArranque;
  const actualizaciones: {
    pago_id: number;
    datos: Record<string, unknown>;
  }[] = [];
  const preview: RepararPreviewItem[] = [];
  // Mapa pago_id → pago original (para diffs)
  const pagoOriginalPorId = new Map<
    number,
    (typeof rows)[0]["pagos_credito"]
  >();
  for (const row of rows) pagoOriginalPorId.set(row.pagos_credito.pago_id, row.pagos_credito);

  console.log(
    `🔁 Recorriendo cuotas 0 → ${ultimaCuotaPagada} (${cuotasOrdenadas.length} cuotas a procesar)\n`,
  );

  for (const [numCuota, pagos] of cuotasOrdenadas) {
    // 6.a Cuota 0 (desembolso): solo total_restante = capital_arranque
    if (numCuota === 0) {
      const totalRestanteStr = capitalArranque.round(2).toString();
      for (const p of pagos) {
        actualizaciones.push({
          pago_id: p.pago_id,
          datos: { total_restante: totalRestanteStr },
        });
      }
      console.log(
        `📌 Cuota 0 (desembolso) → total_restante=Q${totalRestanteStr} | pagos afectados=${pagos.length}`,
      );
      continue;
    }

    // 6.b Cuota pagada: aplicar lógica recalcularPagosCredito desde capitalEnMemoria
    const interesMes = capitalEnMemoria.times(porcentajeInteres).round(2);
    const ivaMes = interesMes.times(0.12).round(2);
    const abonoCapitalTeorico = cuotaMensual
      .minus(interesMes)
      .minus(ivaMes)
      .minus(seguroFijo)
      .minus(gpsFijo)
      .minus(membresiasFijo);

    const capitalAntes = capitalEnMemoria;
    capitalEnMemoria = capitalEnMemoria.minus(abonoCapitalTeorico);
    if (capitalEnMemoria.lt(0)) capitalEnMemoria = new Big(0);

    // Saldo base a distribuir entre los pagos de la cuota
    let rem = {
      interes: interesMes,
      iva: ivaMes,
      seguro: seguroFijo,
      gps: gpsFijo,
      membresias: membresiasFijo,
      capital: abonoCapitalTeorico,
    };

    // Procesar cada pago en orden cronológico por fecha_pago (fallback pago_id)
    const pagosOrdenados = [...pagos].sort((a, b) => {
      const fechaA = a.fecha_pago ? new Date(a.fecha_pago).getTime() : 0;
      const fechaB = b.fecha_pago ? new Date(b.fecha_pago).getTime() : 0;
      if (fechaA !== fechaB) return fechaA - fechaB;
      return a.pago_id - b.pago_id;
    });

    const abonosPorPago: {
      pago_id: number;
      abonos: Record<string, string>;
      restantes: Record<string, string>;
      pagado: boolean;
    }[] = [];

    // Snapshot de `rem` DESPUÉS de aplicar cada pago: preserva el rastro histórico
    // (qué quedaba debiendo la cuota tras cada pago) en lugar de pisar todos los pagos
    // con el estado final.
    const snapshotRestantes = () => ({
      interes_restante: rem.interes.round(2).toString(),
      iva_12_restante: rem.iva.round(2).toString(),
      seguro_restante: rem.seguro.round(2).toString(),
      gps_restante: rem.gps.round(2).toString(),
      capital_restante: rem.capital.round(2).toString(),
      membresias: rem.membresias.round(2).toString(),
    });
    const cuotaCerradaAhora = () =>
      rem.interes.eq(0) &&
      rem.iva.eq(0) &&
      rem.seguro.eq(0) &&
      rem.gps.eq(0) &&
      rem.membresias.eq(0) &&
      rem.capital.eq(0);

    for (const pago of pagosOrdenados) {
      const montoAplicado = new Big(pago.monto_aplicado ?? 0);

      if (montoAplicado.gt(0)) {
        let disponible = montoAplicado;

        const abono_interes = disponible.gte(rem.interes) ? rem.interes : disponible;
        disponible = disponible.minus(abono_interes);
        rem.interes = rem.interes.minus(abono_interes);

        const abono_iva = disponible.gte(rem.iva) ? rem.iva : disponible;
        disponible = disponible.minus(abono_iva);
        rem.iva = rem.iva.minus(abono_iva);

        const abono_seguro = disponible.gte(rem.seguro) ? rem.seguro : disponible;
        disponible = disponible.minus(abono_seguro);
        rem.seguro = rem.seguro.minus(abono_seguro);

        const abono_gps = disponible.gte(rem.gps) ? rem.gps : disponible;
        disponible = disponible.minus(abono_gps);
        rem.gps = rem.gps.minus(abono_gps);

        const abono_membresias = disponible.gte(rem.membresias) ? rem.membresias : disponible;
        disponible = disponible.minus(abono_membresias);
        rem.membresias = rem.membresias.minus(abono_membresias);

        const abono_capital = disponible.gte(rem.capital) ? rem.capital : disponible;
        rem.capital = rem.capital.minus(abono_capital);

        const totalPagado = abono_interes
          .plus(abono_iva)
          .plus(abono_seguro)
          .plus(abono_gps)
          .plus(abono_membresias)
          .plus(abono_capital);

        abonosPorPago.push({
          pago_id: pago.pago_id,
          abonos: {
            abono_interes: abono_interes.round(2).toString(),
            abono_iva_12: abono_iva.round(2).toString(),
            abono_seguro: abono_seguro.round(2).toString(),
            abono_gps: abono_gps.round(2).toString(),
            abono_capital: abono_capital.round(2).toString(),
            membresias_pago: abono_membresias.round(2).toString(),
            membresias_mes: abono_membresias.round(2).toString(),
            pago_del_mes: totalPagado.round(2).toString(),
          },
          restantes: snapshotRestantes(),
          pagado: cuotaCerradaAhora(),
        });
      } else {
        abonosPorPago.push({
          pago_id: pago.pago_id,
          abonos: {
            abono_interes: "0",
            abono_iva_12: "0",
            abono_seguro: "0",
            abono_gps: "0",
            abono_capital: "0",
            membresias_pago: pago.membresias_pago ?? "0",
            membresias_mes: pago.membresias_mes ?? "0",
            pago_del_mes: "0",
          },
          restantes: snapshotRestantes(),
          pagado: cuotaCerradaAhora(),
        });
      }
    }

    const cuotaPagada = cuotaCerradaAhora();

    for (const { pago_id, abonos, restantes, pagado } of abonosPorPago) {
      actualizaciones.push({
        pago_id,
        datos: {
          // No tocamos `cuota` ni `cuota_interes`: se preservan valores históricos
          ...abonos,
          ...restantes,
          total_restante: capitalEnMemoria.round(2).toString(),
          pagado,
        },
      });
    }

    console.log(
      `📌 Cuota ${numCuota.toString().padStart(3, " ")} | cap_antes=Q${capitalAntes.round(2).toString()} | int=Q${interesMes.toString()} | iva=Q${ivaMes.toString()} | abono_cap_teorico=Q${abonoCapitalTeorico.round(2).toString()} | cap_despues=Q${capitalEnMemoria.round(2).toString()} | pagos=${pagos.length} | cuotaPagada=${cuotaPagada}`,
    );
  }

  // 7️⃣ Construir preview (diffs por pago, sólo campos que cambian)
  for (const { pago_id, datos } of actualizaciones) {
    const original = pagoOriginalPorId.get(pago_id);
    if (!original) continue;
    const cambios: { campo: string; antes: string; despues: string }[] = [];
    for (const [campo, nuevo] of Object.entries(datos)) {
      const antes = (original as Record<string, unknown>)[campo];
      const antesStr = antes === null || antes === undefined ? "null" : String(antes);
      const despuesStr = nuevo === null || nuevo === undefined ? "null" : String(nuevo);
      // Comparar numéricamente cuando ambos son números
      const antesBig = (() => {
        try {
          return new Big(antesStr);
        } catch {
          return null;
        }
      })();
      const despuesBig = (() => {
        try {
          return new Big(despuesStr);
        } catch {
          return null;
        }
      })();
      const igual =
        antesBig && despuesBig ? antesBig.eq(despuesBig) : antesStr === despuesStr;
      if (!igual) cambios.push({ campo, antes: antesStr, despues: despuesStr });
    }
    if (cambios.length > 0) {
      const numero_cuota =
        cuotasOrdenadas.find(([, pagos]) =>
          pagos.some((p) => p.pago_id === pago_id),
        )?.[0] ?? -1;
      preview.push({ pago_id, numero_cuota, cambios });
    }
  }

  if (dry_run) {
    console.log(
      `\n🧪 DRY-RUN: ${preview.length}/${actualizaciones.length} pagos tendrían cambios. NO se escribió nada.`,
    );
    console.log("🔧 ========== FIN REPARAR (dry-run) ==========\n");
    return {
      credito_id: credito.credito_id,
      capital_arranque: capitalArranque.toString(),
      ultima_cuota_pagada: ultimaCuotaPagada,
      pagos_actualizados: 0,
      dry_run: true,
      preview,
    };
  }

  // 8️⃣ Ejecutar updates en una sola transacción
  console.log(
    `\n💾 Ejecutando ${actualizaciones.length} updates en transacción...`,
  );
  await db.transaction(async (tx) => {
    await Promise.all(
      actualizaciones.map(({ pago_id, datos }) =>
        tx
          .update(pagos_credito)
          .set(datos)
          .where(eq(pagos_credito.pago_id, pago_id)),
      ),
    );
  });

  console.log(
    `✅ ${actualizaciones.length} pagos reparados en crédito ${numero_credito_sifco} hasta cuota ${ultimaCuotaPagada}`,
  );
  console.log("🔧 ========== FIN REPARAR ==========\n");

  return {
    credito_id: credito.credito_id,
    capital_arranque: capitalArranque.toString(),
    ultima_cuota_pagada: ultimaCuotaPagada,
    pagos_actualizados: actualizaciones.length,
    dry_run: false,
  };
};

// ========================================
// REPARAR total_restante EN MASA (créditos ACTIVOS, excluye CRM)
// ========================================

interface RepararTotalRestanteBulkParams {
  concurrencia?: number;
  numeros_credito?: string[];
  statuses?: Array<
    "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO" | "EN_CONVENIO" | "CAIDO"
  >;
}

interface RepararTotalRestanteBulkResult {
  total: number;
  exitosos: number;
  fallidos: number;
  pagos_actualizados_total: number;
  detalle_exitosos: Array<{
    numero_credito_sifco: string;
    credito_id: number;
    capital_arranque: string;
    ultima_cuota_pagada: number | null;
    pagos_actualizados: number;
  }>;
  detalle_fallidos: Array<{ numero_credito_sifco: string; error: string }>;
}

export const repararTotalRestanteBulk = async ({
  concurrencia = 3,
  numeros_credito,
  statuses,
}: RepararTotalRestanteBulkParams): Promise<RepararTotalRestanteBulkResult> => {
  console.log("\n🚀 ========== REPARAR total_restante BULK ==========");

  let candidatos: string[];
  if (numeros_credito && numeros_credito.length > 0) {
    candidatos = numeros_credito;
    console.log(`📋 Usando ${candidatos.length} créditos pasados por body`);
  } else {
    const statusesFiltro = statuses && statuses.length > 0 ? statuses : ["ACTIVO" as const];
    console.log(`🔎 [DIAG] statuses recibido: ${JSON.stringify(statuses)} → filtro a usar: ${JSON.stringify(statusesFiltro)}`);
    const rows = await db
      .select({ numero_credito_sifco: creditos.numero_credito_sifco })
      .from(creditos)
      .where(
        and(
          inArray(creditos.statusCredit, statusesFiltro),
          sql`${creditos.numero_credito_sifco} NOT ILIKE '%CRM%'`,
        ),
      );
    candidatos = rows.map((r) => r.numero_credito_sifco);
    console.log(
      `📋 Créditos en [${statusesFiltro.join(",")}] (excluidos CRM): ${candidatos.length}`,
    );
  }

  const detalle_exitosos: RepararTotalRestanteBulkResult["detalle_exitosos"] = [];
  const detalle_fallidos: RepararTotalRestanteBulkResult["detalle_fallidos"] = [];

  const workers = Math.max(1, concurrencia);
  let idx = 0;

  const runOne = async (numero: string) => {
    try {
      const r = await repararTotalRestante({ numero_credito_sifco: numero });
      detalle_exitosos.push({ numero_credito_sifco: numero, ...r });
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error(`❌ [${numero}] ${msg}`);
      detalle_fallidos.push({ numero_credito_sifco: numero, error: msg });
    }
  };

  const worker = async () => {
    while (true) {
      const i = idx++;
      if (i >= candidatos.length) return;
      const numero = candidatos[i];
      console.log(`\n▶️  (${i + 1}/${candidatos.length}) ${numero}`);
      await runOne(numero);
    }
  };

  await Promise.all(Array.from({ length: workers }, () => worker()));

  const pagos_actualizados_total = detalle_exitosos.reduce(
    (acc, r) => acc + r.pagos_actualizados,
    0,
  );

  console.log(
    `\n✅ BULK terminado | total=${candidatos.length} exitosos=${detalle_exitosos.length} fallidos=${detalle_fallidos.length} pagos_actualizados=${pagos_actualizados_total}`,
  );

  return {
    total: candidatos.length,
    exitosos: detalle_exitosos.length,
    fallidos: detalle_fallidos.length,
    pagos_actualizados_total,
    detalle_exitosos,
    detalle_fallidos,
  };
};

// ========================================
// RECALCULAR PAGOS DESDE UNA CUOTA
// ========================================

interface RecalcularPagosParams {
  numero_credito_sifco: string;
  numero_cuota?: number; // Opcional: si se pasa, procesa desde esa cuota (pagadas y no pagadas). Si no, solo no pagadas.
}

export const recalcularPagosCredito = async ({
  numero_credito_sifco,
  numero_cuota,
}: RecalcularPagosParams): Promise<void> => {
  // 1️⃣ Obtener crédito
  const [credito] = await db
    .select({
      credito_id: creditos.credito_id,
      capital: creditos.capital,
      porcentaje_interes: creditos.porcentaje_interes,
      cuota_interes: creditos.cuota_interes,
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      gps: creditos.gps,
      membresias_pago: creditos.membresias_pago,
      cuota: creditos.cuota,
    })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
    .limit(1);

  if (!credito) {
    throw new Error(`No se encontró el crédito: ${numero_credito_sifco}`);
  }

  // 2️⃣ Obtener pagos con su cuota
  // Si numero_cuota está definido → desde esa cuota en adelante (pagadas y no pagadas)
  // Si no → solo no pagadas
  const whereConditions =
    numero_cuota !== undefined
      ? and(
          eq(pagos_credito.credito_id, credito.credito_id),
          gte(cuotas_credito.numero_cuota, numero_cuota),
        )
      : and(
          eq(pagos_credito.credito_id, credito.credito_id),
          eq(pagos_credito.pagado, false),
        );

  const rows = await db
    .select()
    .from(pagos_credito)
    .innerJoin(cuotas_credito, eq(pagos_credito.cuota_id, cuotas_credito.cuota_id))
    .where(whereConditions)
    .orderBy(asc(cuotas_credito.numero_cuota), asc(pagos_credito.pago_id));

  if (rows.length === 0) {
    console.log(`⚠️ No hay pagos para actualizar en crédito ${numero_credito_sifco}`);
    return;
  }

  // 3️⃣ Agrupar pagos por cuota_id
  const pagosPorCuota = new Map<
    number,
    { numero_cuota: number; pagos: (typeof rows)[0]["pagos_credito"][] }
  >();

  for (const row of rows) {
    const cuotaId = row.cuotas_credito.cuota_id;
    if (!pagosPorCuota.has(cuotaId)) {
      pagosPorCuota.set(cuotaId, {
        numero_cuota: row.cuotas_credito.numero_cuota,
        pagos: [],
      });
    }
    pagosPorCuota.get(cuotaId)!.pagos.push(row.pagos_credito);
  }

  // 4️⃣ Constantes de amortización
  const seguroFijo = new Big(credito.seguro_10_cuotas ?? 0);
  const gpsFijo = new Big(credito.gps ?? 0);
  const membresiasFijo = new Big(credito.membresias_pago ?? 0);
  const porcentajeInteres = new Big(credito.porcentaje_interes ?? 0).div(100);
  const cuotaMensual = new Big(credito.cuota);
  let capitalEnMemoria = new Big(credito.capital);

  // 5️⃣ Procesar cada cuota en orden
  const actualizaciones: { pago_id: number; datos: Record<string, unknown> }[] = [];

  const cuotasOrdenadas = [...pagosPorCuota.entries()].sort(
    (a, b) => a[1].numero_cuota - b[1].numero_cuota,
  );

  for (const [, { numero_cuota: numCuota, pagos }] of cuotasOrdenadas) {
    // Cuota 0 (desembolso) no se recalcula
    if (numCuota === 0) continue;

    // Amortización de esta cuota
    const interesMes = capitalEnMemoria.times(porcentajeInteres).round(2);
    const ivaMes = interesMes.times(0.12).round(2);
    const abonoCapital = cuotaMensual
      .minus(interesMes)
      .minus(ivaMes)
      .minus(seguroFijo)
      .minus(gpsFijo)
      .minus(membresiasFijo);

    capitalEnMemoria = capitalEnMemoria.minus(abonoCapital);
    if (capitalEnMemoria.lt(0)) capitalEnMemoria = new Big(0);

    // Saldo base a distribuir entre pagos de esta cuota
    let rem = {
      interes: interesMes,
      iva: ivaMes,
      seguro: seguroFijo,
      gps: gpsFijo,
      membresias: membresiasFijo,
      capital: abonoCapital,
    };

    // Procesar cada pago en orden cronológico por fecha_pago
    const pagosOrdenados = [...pagos].sort((a, b) => {
      const fechaA = a.fecha_pago ? new Date(a.fecha_pago).getTime() : 0;
      const fechaB = b.fecha_pago ? new Date(b.fecha_pago).getTime() : 0;
      if (fechaA !== fechaB) return fechaA - fechaB;
      return a.pago_id - b.pago_id; // fallback por pago_id si misma fecha
    });
    const abonosPorPago: {
      pago_id: number;
      abonos: Record<string, string>;
      restantes: Record<string, string>;
      pagado: boolean;
    }[] = [];

    // Snapshot por-pago del saldo restante de la cuota: evita que un pago parcial
    // anterior quede reescrito con el estado final cuando un pago posterior cierra
    // la cuota.
    const snapshotRestantes = () => ({
      interes_restante: rem.interes.round(2).toString(),
      iva_12_restante: rem.iva.round(2).toString(),
      seguro_restante: rem.seguro.round(2).toString(),
      gps_restante: rem.gps.round(2).toString(),
      capital_restante: rem.capital.round(2).toString(),
      membresias: rem.membresias.round(2).toString(),
    });
    const cuotaCerradaAhora = () =>
      rem.interes.eq(0) &&
      rem.iva.eq(0) &&
      rem.seguro.eq(0) &&
      rem.gps.eq(0) &&
      rem.membresias.eq(0) &&
      rem.capital.eq(0);

    for (const pago of pagosOrdenados) {
      const montoAplicado = new Big(pago.monto_aplicado ?? 0);

      if (montoAplicado.gt(0)) {
        // Distribuir monto_aplicado contra el saldo restante en orden de prioridad
        let disponible = montoAplicado;

        const abono_interes = disponible.gte(rem.interes) ? rem.interes : disponible;
        disponible = disponible.minus(abono_interes);
        rem.interes = rem.interes.minus(abono_interes);

        const abono_iva = disponible.gte(rem.iva) ? rem.iva : disponible;
        disponible = disponible.minus(abono_iva);
        rem.iva = rem.iva.minus(abono_iva);

        const abono_seguro = disponible.gte(rem.seguro) ? rem.seguro : disponible;
        disponible = disponible.minus(abono_seguro);
        rem.seguro = rem.seguro.minus(abono_seguro);

        const abono_gps = disponible.gte(rem.gps) ? rem.gps : disponible;
        disponible = disponible.minus(abono_gps);
        rem.gps = rem.gps.minus(abono_gps);

        const abono_membresias = disponible.gte(rem.membresias) ? rem.membresias : disponible;
        disponible = disponible.minus(abono_membresias);
        rem.membresias = rem.membresias.minus(abono_membresias);

        const abono_capital = disponible.gte(rem.capital) ? rem.capital : disponible;
        rem.capital = rem.capital.minus(abono_capital);

        const totalPagado = abono_interes
          .plus(abono_iva)
          .plus(abono_seguro)
          .plus(abono_gps)
          .plus(abono_membresias)
          .plus(abono_capital);

        abonosPorPago.push({
          pago_id: pago.pago_id,
          abonos: {
            abono_interes: abono_interes.round(2).toString(),
            abono_iva_12: abono_iva.round(2).toString(),
            abono_seguro: abono_seguro.round(2).toString(),
            abono_gps: abono_gps.round(2).toString(),
            abono_capital: abono_capital.round(2).toString(),
            membresias_pago: abono_membresias.round(2).toString(),
            membresias_mes: abono_membresias.round(2).toString(),
            pago_del_mes: totalPagado.round(2).toString(),
          },
          restantes: snapshotRestantes(),
          pagado: cuotaCerradaAhora(),
        });
      } else {
        // Sin monto aplicado: abonos en 0
        abonosPorPago.push({
          pago_id: pago.pago_id,
          abonos: {
            abono_interes: "0",
            abono_iva_12: "0",
            abono_seguro: "0",
            abono_gps: "0",
            abono_capital: "0",
            membresias_pago: pago.membresias_pago ?? "0",
            membresias_mes: pago.membresias_mes ?? "0",
            pago_del_mes: "0",
          },
          restantes: snapshotRestantes(),
          pagado: cuotaCerradaAhora(),
        });
      }
    }

    for (const { pago_id, abonos, restantes, pagado } of abonosPorPago) {
      actualizaciones.push({
        pago_id,
        datos: {
          cuota: cuotaMensual.toString(),
          cuota_interes: credito.cuota_interes,
          ...abonos,
          ...restantes,
          total_restante: capitalEnMemoria.round(2).toString(),
          pagado,
        },
      });
    }
  }

  // 6️⃣ Ejecutar todas las actualizaciones en una transacción
  await db.transaction(async (tx) => {
    await Promise.all(
      actualizaciones.map(({ pago_id, datos }) =>
        tx.update(pagos_credito).set(datos).where(eq(pagos_credito.pago_id, pago_id)),
      ),
    );
  });

  console.log(
    `✅ ${actualizaciones.length} pagos recalculados para ${numero_credito_sifco}`,
  );
};

interface UpdateAllInstallmentsParams {
  numero_credito_sifco?: string; // Opcional por si querés uno específico
}

export const updateAllInstallments = async ({
  numero_credito_sifco,
}: UpdateAllInstallmentsParams = {}): Promise<void> => {
  try {
    console.log("\n🔄 ========== ACTUALIZANDO CUOTAS ==========");

    // 1️⃣ Query optimizada con construcción condicional más limpia
    const whereConditions = numero_credito_sifco
      ? and(eq(creditos.numero_credito_sifco, numero_credito_sifco))
      : inArray(creditos.statusCredit, [
          "ACTIVO",
          "MOROSO",
          "PENDIENTE_CANCELACION",
          "EN_CONVENIO",
        ]);

    // 2️⃣ Query única con límite condicional inline
    let query = db
      .select({
        numero_credito_sifco: creditos.numero_credito_sifco,
        cuota: creditos.cuota,
      })
      .from(creditos)
      .where(whereConditions);

    if (numero_credito_sifco) {
      query = query.limit(1) as any;
    }

    const creditosAActualizar = await query;

    // 3️⃣ Early return si no hay datos
    if (creditosAActualizar.length === 0) {
      const mensaje = numero_credito_sifco
        ? `Crédito ${numero_credito_sifco} no encontrado o no está activo`
        : "No hay créditos activos para actualizar";
      console.log(`⚠️ ${mensaje}`);
      return;
    }

    console.log(
      `📋 Total de créditos a actualizar: ${creditosAActualizar.length}\n`,
    );

    // 4️⃣ Procesamiento con Promise.allSettled (paralelo en lugar de secuencial)
    const resultados = await Promise.allSettled(
      creditosAActualizar.map(async (credito) => {
        console.log(
          `⏳ Procesando: ${credito.numero_credito_sifco} - Cuota: Q${credito.cuota}`,
        );

        await updateInstallments({
          numero_credito_sifco: credito.numero_credito_sifco,
          nueva_cuota: Number(credito.cuota),
        });

        console.log(
          `   ✅ ${credito.numero_credito_sifco} actualizado correctamente\n`,
        );
        return credito.numero_credito_sifco;
      }),
    );

    // 5️⃣ Análisis de resultados más eficiente
    const exitosos = resultados.filter((r) => r.status === "fulfilled");
    const fallidos = resultados.filter(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult[];

    const errores = fallidos.map((resultado, idx) => ({
      credito:
        creditosAActualizar[resultados.indexOf(resultado)].numero_credito_sifco,
      error:
        resultado.reason instanceof Error
          ? resultado.reason.message
          : String(resultado.reason),
    }));

    // 6️⃣ Resumen final
    console.log("📊 ========== RESUMEN ==========");
    console.log(`✅ Exitosos: ${exitosos.length}`);
    console.log(`❌ Fallidos: ${fallidos.length}`);
    console.log(`📋 Total procesados: ${creditosAActualizar.length}`);

    if (errores.length > 0) {
      console.log("\n⚠️ Errores detallados:");
      errores.forEach(({ credito, error }) => {
        console.log(`   - ${credito}: ${error}`);
      });
    }

    console.log("🎉 Proceso completado\n");
  } catch (error) {
    console.error("\n❌ Error crítico en updateAllInstallments:", error);
    throw error;
  }
};

/**
 * Endpoint para pre-calcular las cuotas de los inversionistas sin guardar nada.
 */
export const calculateInvestorQuotas = async ({ body, set }: any) => {
  try {
    const schema = z.object({
      capital: z.number().positive(),
      cuota: z.number().positive(),
      seguro_10_cuotas: z.number().min(0).optional(),
      gps: z.number().min(0).optional(),
      membresias_pago: z.number().min(0).optional(),
      inversionistas: z.array(
        z.object({
          inversionista_id: z.number().int().positive(),
          monto_aportado: z.number().positive(),
        }),
      ),
    });

    const parse = schema.safeParse(body);
    if (!parse.success) {
      set.status = 400;
      return { message: "Parámetros inválidos", errors: parse.error.flatten() };
    }

    const {
      capital: capitalTotal,
      cuota: cuotaTotal,
      seguro_10_cuotas = 0,
      gps = 0,
      membresias_pago = 0,
      inversionistas,
    } = parse.data;

    // Calculamos el capital total real sumando todos los montos aportados
    const capitalTotalCalculado = inversionistas.reduce(
      (acc, inv) => acc.plus(inv.monto_aportado),
      new Big(0)
    );

    // Buscamos al inversionista mayor
    const inversionistaMayor = inversionistas.reduce((max, current) =>
      current.monto_aportado > max.monto_aportado ? current : max,
    );

    const seguroBig = new Big(seguro_10_cuotas);
    const gpsBig = new Big(gps);
    const membresiaBig = new Big(membresias_pago);
    const cuotaTotalBig = new Big(cuotaTotal);

    const cuotaSinCargos = cuotaTotalBig
      .minus(seguroBig)
      .minus(gpsBig)
      .minus(membresiaBig);

    const resultados = inversionistas.map((inv) => {
      const montoAportado = new Big(inv.monto_aportado);
      // Usamos el capitalTotalCalculado para el % de participación exacto
      const porcentajeParticipacion = capitalTotalCalculado.gt(0)
        ? montoAportado.div(capitalTotalCalculado)
        : new Big(0);

      const cuotaBase = cuotaSinCargos.times(porcentajeParticipacion).round(6);

      let cuotaFinal = cuotaBase;
      const esMayor = inv.inversionista_id === inversionistaMayor.inversionista_id;

      if (esMayor) {
        cuotaFinal = cuotaBase.plus(seguroBig).plus(gpsBig).plus(membresiaBig);
      }

      return {
        inversionista_id: inv.inversionista_id,
        cuota_inversionista: Number(cuotaFinal.round(6).toFixed(6)),
        es_mayor: esMayor,
        cuota_base: Number(cuotaBase.toFixed(6)),
      };
    });

    return {
      success: true,
      data: resultados,
    };
  } catch (error) {
    set.status = 500;
    return { message: "Error calculando cuotas", error: String(error) };
  }
};
