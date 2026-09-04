import Big from "big.js";
import {
  eq,
  ne,
  and,
  or,
  inArray,
  notInArray,
  isNull,
  asc,
  gt,
  lte,
  sql,
} from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  compras_credito_inversionista,
  inversionistas as inversionistasTabla,
  cuotas_credito,
  pagos_credito,
  usuarios,
  historial_devolucion_credito,
} from "../database/db";
import z from "zod";
import type { WSCrEstadoCuentaResponse } from "../services/sifco.interface";
import { consultarEstadoCuentaPrestamo } from "../services/sifcoIntegrations";
import {
  withAuditContext,
  setCapitalSource,
  setMontoAportadoAuditContext,
} from "../utils/withAuditContext";
import { clasificarCompraCreditoInversionista, tieneConflictoExcedenteVariable } from "./purchaseClassification";
import { withCreditoEspejoLocks } from "../utils/creditoEspejoLock";
import {
  getModalidadFacturacionSpreadById,
  resolveModalidadFacturacionSpread,
} from "./modalidadFacturacion";
import { getChangedExistingInvestorIds } from "../utils/montoAportadoAuditContext";

interface UpdateInstallmentsParams {
  numero_credito_sifco: string;
  nueva_cuota: number;
  all?: boolean;
}

const updateInstallments = async ({
  numero_credito_sifco,
  nueva_cuota,

  all = false,
}: UpdateInstallmentsParams, dbInstance: typeof db = db): Promise<void> => {
  // 1️⃣ Obtener crédito y pagos en paralelo (en lugar de secuencial)
  const [creditoResult, todosPagos] = await Promise.all([
    dbInstance
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
    dbInstance
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
            dbInstance
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
  const actualizaciones = todosPagos.flatMap((pago) => {
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

    // Un pago con dinero aplicado (cuota pagada o parcial) es historia
    // liquidada: sus restantes/membresías reflejan lo realmente cobrado y no
    // deben pisarse con la re-proyección teórica. Avanza el capital en memoria
    // (la cuota ocupa su lugar en el calendario) pero no se reescribe la fila.
    if (new Big(pago.monto_aplicado ?? 0).gt(0)) return [];

    return [{
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
    }];
  });

  // 5️⃣ Ejecutar TODAS las actualizaciones en paralelo (batch update)
  await Promise.all([
    // Actualizar todos los pagos pendientes
    ...actualizaciones.map(({ pago_id, datos }) =>
      dbInstance
        .update(pagos_credito)
        .set(datos)
        .where(eq(pagos_credito.pago_id, pago_id)),
    ),
    // Actualizar el crédito
      dbInstance
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
  noAmortizaCapital: boolean = false,
): number {
  const r = (monthlyRate / 100) * 1.12;
  const cargosFijos = insuranceCost + gpsCost + membresiasCost;

  // Crédito solo-interés: la cuota cubre interés + IVA + cargos fijos y NO
  // amortiza capital (abono a capital = 0 cada mes). El capital se paga vía
  // abonos extraordinarios o pago final. Como no hay amortización, la cuota no
  // depende del plazo: es simplemente principal * r (interés + IVA) + fijos.
  if (noAmortizaCapital) {
    return principal * r + cargosFijos;
  }

  if (r === 0) return principal / termMonths + cargosFijos;
  const factor = (1 + r) ** termMonths;
  const baseMonthlyPayment = (principal * (r * factor)) / (factor - 1);
  return baseMonthlyPayment + cargosFijos;
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

    // 2. Calcular nueva cuota.
    // Si el crédito es solo-interés (no_amortiza_capital), la cuota cubre solo
    // interés + IVA + cargos fijos; si no, se amortiza capital con PMT.
    const noAmortizaCapital = Boolean(credito.no_amortiza_capital);
    const nuevaCuota = Number(
      new Big(
        calculateMonthlyPayment(
          capital,
          monthlyRate,
          termMonths,
          insuranceCost,
          gpsCost,
          membresiasCost,
          noAmortizaCapital,
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
        // Inversionista agregado DESDE la edición del crédito (no estaba antes).
        // Obliga a declarar la operación para registrarla en
        // compras_credito_inversionista — sin ese registro la liquidación
        // descuadra (calcular pagos espejo data las compras por ahí).
        es_nuevo: z.boolean().optional(),
        tipo_operacion: z.enum(["compra_cartera", "reinversion"]).optional(),
        tipo_reinversion: z.enum([
          "sin_reinversion",
          "reinversion_capital",
          "reinversion_interes",
          "reinversion_total",
          "reinversion_excedente",
          "reinversion_variable",
        ]).optional(),
        modalidad_facturacion: z.enum(["p2p_directa", "factura_cube", "factura_cube_pequeno"]).optional(),
        modalidad_facturacion_spread_id: z.number().int().positive().optional(),
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
        // El front sincroniza el espejo desde el padre para nuevos; estos
        // campos viajan también aquí pero la lógica solo lee los del padre.
        es_nuevo: z.boolean().optional(),
        tipo_operacion: z.enum(["compra_cartera", "reinversion"]).optional(),
        tipo_reinversion: z.enum([
          "sin_reinversion",
          "reinversion_capital",
          "reinversion_interes",
          "reinversion_total",
          "reinversion_excedente",
          "reinversion_variable",
        ]).optional(),
        modalidad_facturacion: z.enum(["p2p_directa", "factura_cube", "factura_cube_pequeno"]).optional(),
        modalidad_facturacion_spread_id: z.number().int().positive().optional(),
      }),
    )
    .min(0)
    .optional(),
  capital: z.number().min(1),
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
  no_amortiza_capital: z.boolean().optional(),
  excluir_compras: z.boolean().optional(),
  estado_devolucion: z.enum(['NO_APLICA', 'PENDIENTE_AUTORIZACION', 'VERIFICADO', 'RECHAZADO', 'COMPLETADO']).optional(),
  motivo_devolucion: z.string().optional(),
  bandera_reinversion: z.boolean().optional(),
  // Motivo del ajuste manual de capital (se registra en historial_capital_credito).
  motivo_ajuste_capital: z.string().max(500).optional(),
  // Motivos independientes para historial de monto fiscal y espejo.
  motivo_ajuste_monto_aportado_padre: z.string().max(500).optional(),
  motivo_ajuste_monto_aportado_espejo: z.string().max(500).optional(),
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

// ========================================
// INVERSIONISTAS NUEVOS DESDE LA EDICIÓN
// ========================================
// La edición hace nuke & rebuild de creditos_inversionistas(_espejo), así que
// históricamente se podía "colar" un inversionista nuevo sin registrar la
// operación en compras_credito_inversionista — y sin ese registro el calcular
// pagos espejo no sabe datar la compra y la liquidación descuadra (por eso el
// botón estuvo deshabilitado en el front).
//
// Reglas:
//   1. Todo inversionista del payload que NO esté hoy en el crédito debe venir
//      declarado con es_nuevo + tipo_operacion. Si no, 400 (era el bug).
//   2. Un es_nuevo no puede estar HOY en el crédito (padre o espejo). Eso es
//      justo lo que ataja el borrar-y-volver-a-agregar en la misma edición: la
//      validación corre antes del nuke & rebuild, así que el borrado sigue en
//      la DB y cae acá. En cambio el historial (compras viejas, pagos espejo
//      de participaciones ya cerradas) NO bloquea: que un inversionista salga
//      del crédito y más adelante vuelva a entrar es rotación normal de pool y
//      necesita su propio registro de compra.
//   3. Como máximo UNA compra_cartera puede quedar pendiente de facturar por
//      crédito: cofidi prorratea el interés del pago con una sola fecha de
//      corte (operacionesPendientesFacturar[0]) y las demás se le pierden.
//   4. Si el crédito está excluido de compras, no entra NINGÚN inversionista
//      nuevo desde acá — ni compra_cartera ni reinversion. Sin esta regla el
//      modal de edición sería una puerta trasera al filtro de
//      getCreditCandidates y al guard manual de addInvestorToCredit. Incluye
//      las reinversiones porque un es_nuevo con tipo_operacion "reinversion"
//      puede ser alguien que hoy NO está en el crédito (rotación de pool: salió
//      y vuelve), o sea capital nuevo entrando igual que una compra.
export type InversionistaNuevoValidado = {
  inversionista_id: number;
  monto_aportado: number;
  tipo_operacion: "compra_cartera" | "reinversion";
  tipo_reinversion: "sin_reinversion" | "reinversion_capital" | "reinversion_interes" | "reinversion_total" | "reinversion_excedente" | "reinversion_variable";
  fecha_inicio_participacion?: string;
  porcentaje_cash_in?: number;
  porcentaje_inversion?: number;
  modalidad_facturacion?: "p2p_directa" | "factura_cube" | "factura_cube_pequeno";
  modalidad_facturacion_spread_id?: number;
  tipo_compra: "nueva_posicion" | "ampliacion_posicion" | "sin_clasificar";
};

export const validarInversionistasNuevos = async (
  credito_id: number,
  inversionistas: NonNullable<CreditUpdateData["inversionistas"]>,
  inversionistas_espejo: CreditUpdateData["inversionistas_espejo"],
  set: SetContext,
  // Valor EFECTIVO de excluir_compras tras aplicar este request: en una misma
  // edición se puede prender el flag y agregar una compra, así que no alcanza
  // con mirar el estado actual del crédito.
  excluirComprasEfectivo: boolean = false,
  dbInstance: typeof db = db,
): Promise<
  | { success: true; nuevos: InversionistaNuevoValidado[] }
  | { success: false; error: { message: string; [key: string]: unknown } }
> => {
  const fail = (message: string, extra?: Record<string, unknown>) => {
    set.status = 400;
    return { success: false as const, error: { message, ...extra } };
  };

  // Sin duplicados dentro del propio payload (agregarlo dos veces = colarlo).
  const idsPayload = inversionistas.map((i) => i.inversionista_id);
  const duplicado = idsPayload.find((id, ix) => idsPayload.indexOf(id) !== ix);
  if (duplicado !== undefined) {
    return fail(
      `El inversionista con ID ${duplicado} aparece más de una vez en la lista.`,
      { inversionista_id: duplicado },
    );
  }

  const [padreActual, espejoActual] = await Promise.all([
    dbInstance
      .select({ inversionista_id: creditos_inversionistas.inversionista_id })
      .from(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, credito_id)),
    dbInstance
      .select({ inversionista_id: creditos_inversionistas_espejo.inversionista_id })
      .from(creditos_inversionistas_espejo)
      .where(eq(creditos_inversionistas_espejo.credito_id, credito_id)),
  ]);
  const idsPadreActual = new Set(padreActual.map((r) => r.inversionista_id));
  const idsEspejoActual = new Set(espejoActual.map((r) => r.inversionista_id));

  const declaradosNuevos = inversionistas.filter((i) => i.es_nuevo === true);
  const porcentajesPorNuevo = new Map<
    number,
    { porcentaje_cash_in: number; porcentaje_inversion: number }
  >();

  // Regla 1: nadie entra al crédito sin declararse nuevo. Aplica al padre y al
  // espejo (el espejo nuevo viene sincronizado desde el padre por el front).
  for (const inv of inversionistas) {
    if (!inv.es_nuevo && !idsPadreActual.has(inv.inversionista_id)) {
      return fail(
        `El inversionista con ID ${inv.inversionista_id} no participa en este crédito. ` +
          `Para agregarlo, usá "Agregar Inversionista" e indicá si es compra de cartera o reinversión.`,
        { inversionista_id: inv.inversionista_id },
      );
    }
  }
  const idsDeclarados = new Set(declaradosNuevos.map((i) => i.inversionista_id));
  for (const inv of inversionistas_espejo ?? []) {
    // Un espejo cuyo ID ya está en el PADRE actual no es un colado: es el
    // backfill legítimo del modal para créditos importados (processFromExcelFull
    // omite el espejo a propósito y la edición lo reconstruye desde el padre).
    // Solo se rechaza al que no está en NINGUNA de las dos tablas ni viene
    // declarado como nuevo.
    if (
      !idsEspejoActual.has(inv.inversionista_id) &&
      !idsPadreActual.has(inv.inversionista_id) &&
      !idsDeclarados.has(inv.inversionista_id)
    ) {
      return fail(
        `El inversionista con ID ${inv.inversionista_id} no participa en este crédito ` +
          `(ni en el padre ni en el espejo) y no viene declarado como nuevo.`,
        { inversionista_id: inv.inversionista_id },
      );
    }
  }

  if (declaradosNuevos.length === 0) return { success: true, nuevos: [] };

  // Datos mínimos del nuevo.
  for (const inv of declaradosNuevos) {
    if (!inv.tipo_operacion) {
      return fail(
        `El inversionista nuevo con ID ${inv.inversionista_id} no indica tipo de operación (compra de cartera o reinversión).`,
        { inversionista_id: inv.inversionista_id },
      );
    }
    if (!inv.tipo_reinversion) {
      return fail("tipo_reinversion es requerido para todo inversionista nuevo", {
        inversionista_id: inv.inversionista_id,
      });
    }
    const traeModalidad = inv.modalidad_facturacion !== undefined;
    const traeSpread = inv.modalidad_facturacion_spread_id !== undefined;
    if (inv.tipo_operacion === "compra_cartera" && (!traeModalidad || !traeSpread)) {
      return fail("modalidad_facturacion y modalidad_facturacion_spread_id son requeridos para compra_cartera", {
        inversionista_id: inv.inversionista_id,
      });
    }
    if (inv.tipo_operacion === "reinversion" && (traeModalidad || traeSpread)) {
      return fail("modalidad_facturacion solo aplica a compra_cartera", {
        inversionista_id: inv.inversionista_id,
      });
    }
    if (!(Number(inv.monto_aportado) > 0)) {
      return fail(
        `El inversionista nuevo con ID ${inv.inversionista_id} debe tener un monto aportado mayor a 0.`,
        { inversionista_id: inv.inversionista_id },
      );
    }
    if (inv.tipo_operacion === "compra_cartera") {
      const modalidad = inv.modalidad_facturacion;
      const modalidadFacturacionSpreadId = inv.modalidad_facturacion_spread_id;
      if (!modalidad || !modalidadFacturacionSpreadId) {
        return fail("modalidad_facturacion y modalidad_facturacion_spread_id son requeridos para compra_cartera", {
          inversionista_id: inv.inversionista_id,
        });
      }
      const spread = await getModalidadFacturacionSpreadById(
        modalidadFacturacionSpreadId,
      );
      if (!spread) {
        return fail(
          `No existe un bracket de modalidad de facturación con id ${inv.modalidad_facturacion_spread_id}`,
          {
            inversionista_id: inv.inversionista_id,
          },
        );
      }
      if (spread.modalidad !== modalidad) {
        return fail(
          `El bracket ${inv.modalidad_facturacion_spread_id} pertenece a la modalidad '${spread.modalidad}', no a '${modalidad}'`,
          {
          inversionista_id: inv.inversionista_id,
          },
        );
      }
      const bracketDelMonto = await resolveModalidadFacturacionSpread(
        Number(inv.monto_aportado),
        modalidad,
      );
      if (!bracketDelMonto) {
        return fail(
          `No existe un bracket de modalidad de facturación para el monto Q${inv.monto_aportado}`,
          { inversionista_id: inv.inversionista_id },
        );
      }
      porcentajesPorNuevo.set(inv.inversionista_id, {
        porcentaje_cash_in: new Big(100).minus(spread.spread).toNumber(),
        porcentaje_inversion: new Big(spread.spread).toNumber(),
      });
    }
  }

  // Regla 2: el "nuevo" no puede estar hoy en el crédito. El que se borró de la
  // lista en esta misma edición todavía está en la DB (la validación corre
  // antes del rebuild), así que cae acá. El que participó y ya salió, no: puede
  // volver a entrar.
  for (const inv of declaradosNuevos) {
    if (
      idsPadreActual.has(inv.inversionista_id) ||
      idsEspejoActual.has(inv.inversionista_id)
    ) {
      return fail(
        `El inversionista con ID ${inv.inversionista_id} ya participa en este crédito; ` +
          `no puede agregarse como nuevo (aunque se borre de la lista y se vuelva a agregar).`,
        { inversionista_id: inv.inversionista_id },
      );
    }
  }

  // Regla 3: una sola compra_cartera pendiente de facturar por crédito.
  // El flujo nuevo de intereses de cofidi (routers/cofidi.ts) prorratea el
  // interés del pago con UNA fecha de corte — toma operacionesPendientesFacturar[0]
  // y las demás quedan sin prorratear (se facturan bajo la distribución vieja y
  // el pendiente se arrastra al siguiente pago). Así que ni dos compras en la
  // misma edición ni una compra encima de otra que todavía no cerró ciclo.
  // Las reinversiones no cuentan: nacen con pendiente_facturar=false.
  const nuevasCompras = declaradosNuevos.filter(
    (inv) => inv.tipo_operacion === "compra_cartera",
  );

  // Regla 4: crédito excluido de compras. Se evalúa antes que la Regla 3 porque
  // no necesita ir a la DB. Aplica a TODO inversionista nuevo, no solo a
  // compra_cartera: en este endpoint un es_nuevo con tipo_operacion
  // "reinversion" puede ser alguien que no está hoy en el crédito (la Regla 2
  // solo prohíbe a quien ya participa), o sea capital nuevo entrando. Mismo
  // criterio que getCreditCandidates, que saca el crédito del buscador entero.
  if (excluirComprasEfectivo && declaradosNuevos.length > 0) {
    return fail(
      `Este crédito está excluido de las compras a inversionistas; no se le puede ` +
        `agregar capital de inversionistas nuevos. Desmarcá "Excluir de compras a ` +
        `inversionistas" si querés asignarlo.`,
      { inversionistas_ids: declaradosNuevos.map((i) => i.inversionista_id) },
    );
  }

  if (nuevasCompras.length > 1) {
    return fail(
      `Solo se puede agregar una compra de cartera a la vez en este crédito ` +
        `(llegaron ${nuevasCompras.length}). Agregá una, esperá a que se facture el ` +
        `siguiente pago y luego agregá la otra. Las reinversiones sí pueden ir juntas.`,
      { inversionistas_ids: nuevasCompras.map((i) => i.inversionista_id) },
    );
  }
  if (nuevasCompras.length === 1) {
    const [pendiente] = await dbInstance
      .select({ inversionista_id: compras_credito_inversionista.inversionista_id })
      .from(compras_credito_inversionista)
      .where(
        and(
          eq(compras_credito_inversionista.credito_id, credito_id),
          eq(compras_credito_inversionista.pendiente_facturar, true),
        ),
      )
      .limit(1);
    if (pendiente) {
      return fail(
        `Este crédito ya tiene una compra pendiente de facturar (inversionista ` +
          `${pendiente.inversionista_id}). Hay que esperar a que el siguiente pago la ` +
          `facture antes de agregar otra compra de cartera.`,
        {
          inversionista_id: nuevasCompras[0].inversionista_id,
          compra_pendiente_inversionista_id: pendiente.inversionista_id,
        },
      );
    }
  }

  // Un nuevo se materializa en padre, espejo y compras dentro del mismo
  // rebuild. No aceptar un padre nuevo sin su fila espejo evita insertar una
  // compra/snapshot que no tiene la posición pendiente correspondiente.
  const idsEspejoPayload = new Set(
    (inversionistas_espejo ?? []).map((inv) => inv.inversionista_id),
  );
  const faltanEnEspejo = declaradosNuevos
    .map((inv) => inv.inversionista_id)
    .filter((id) => !idsEspejoPayload.has(id));
  if (faltanEnEspejo.length > 0) {
    return fail(
      `Todo inversionista nuevo debe venir también en inversionistas_espejo antes de persistir la compra o reinversión. Faltan: ${faltanEnEspejo.join(", ")}.`,
      { inversionistas_ids: faltanEnEspejo },
    );
  }

  return {
    success: true,
    nuevos: declaradosNuevos.map((inv) => {
      if (!inv.tipo_operacion || !inv.tipo_reinversion) {
        throw new Error(`Inversionista nuevo ${inv.inversionista_id} sin tipo de operación o reinversión`);
      }
      return {
        inversionista_id: inv.inversionista_id,
        monto_aportado: Number(inv.monto_aportado),
        tipo_operacion: inv.tipo_operacion,
        tipo_reinversion: inv.tipo_reinversion,
        fecha_inicio_participacion: inv.fecha_inicio_participacion,
        porcentaje_cash_in:
          porcentajesPorNuevo.get(inv.inversionista_id)?.porcentaje_cash_in,
        porcentaje_inversion:
          porcentajesPorNuevo.get(inv.inversionista_id)?.porcentaje_inversion,
        modalidad_facturacion: inv.modalidad_facturacion,
        modalidad_facturacion_spread_id: inv.modalidad_facturacion_spread_id,
        tipo_compra: clasificarCompraCreditoInversionista(
          [...idsPadreActual, ...idsEspejoActual],
          inv.inversionista_id,
        ),
      };
    }),
  };
};

// Registra en compras_credito_inversionista la entrada de cada inversionista
// nuevo, replicando el estado FINAL que deja el flujo normal (addInvestorToCredit
// + completeEspejo) al aceptar la operación — aquí no hay paso de aceptación,
// así que el registro nace ya completado:
//   - status "completado" (el espejo del nuevo también nace "completado", que es
//     el default de la tabla, así que no queda nada pendiente ni se activa
//     bandera_reinversion).
//   - compra_cartera: fecha_completada anclada a la fecha de inicio de
//     participación a mediodía UTC — igual que completeEspejo — para que caiga
//     en el mismo mes que lee el calcular pagos espejo (calcularAjusteCompras /
//     obtenerSumaComprasMesAnterior). pendiente_facturar=true para que cofidi
//     prorratee el interés del primer pago bajo la nueva distribución.
//   - reinversion: fecha_completada = ahora y sin factura (pendiente_facturar
//     false), igual que completeEspejo.
//
// Corre con el MISMO dbInstance (transacción) que el rebuild de padre/espejo:
// participación y registro de compra entran o no entran juntos. Si esto falla,
// el rollback deshace el rebuild y el reintento con el mismo payload vuelve a
// pasar la validación (el nuevo no quedó a medias dentro del crédito).
export const registrarComprasInversionistasNuevos = async (
  credito_id: number,
  nuevos: InversionistaNuevoValidado[],
  dbInstance: typeof db = db,
) => {
  if (nuevos.length === 0) return;

  const ahora = new Date();
  await dbInstance.insert(compras_credito_inversionista).values(
    nuevos.map((n) => {
      const esCompra = n.tipo_operacion === "compra_cartera";
      // Anclar a mediodía UTC para que la conversión a hora GT (UTC-6) no
      // cruce la frontera de día (mismo truco que completeEspejo).
      const ymd = n.fecha_inicio_participacion
        ? new Date(n.fecha_inicio_participacion).toISOString().split("T")[0]
        : null;
      const fechaCompletada = esCompra && ymd ? new Date(`${ymd}T12:00:00Z`) : ahora;
      return {
        credito_id,
        inversionista_id: n.inversionista_id,
        monto_aportado: n.monto_aportado.toString(),
        tipo_operacion: n.tipo_operacion,
        tipo_reinversion: n.tipo_reinversion,
        modalidad_facturacion: n.modalidad_facturacion ?? null,
        modalidad_facturacion_spread_id: n.modalidad_facturacion_spread_id ?? null,
        tipo_compra: n.tipo_compra,
        status: "completado" as const,
        fecha_completada: fechaCompletada,
        pendiente_facturar: esCompra,
        updated_at: ahora,
      };
    }),
  );

  console.log(
    `🧾 [COMPRAS] Registradas ${nuevos.length} operación(es) en compras_credito_inversionista para crédito ${credito_id}:`,
    nuevos.map((n) => `inv ${n.inversionista_id} ${n.tipo_operacion} Q${n.monto_aportado}`).join(", "),
  );
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
  dbInstance: typeof db = db,
): Promise<void> => {
  const cuotaInicial = await dbInstance
    .select({ id: cuotas_credito.cuota_id })
    .from(cuotas_credito)
    .where(
      and(
        eq(cuotas_credito.credito_id, credito_id),
        eq(cuotas_credito.numero_cuota, 0),
      ),
    );

  if (cuotaInicial.length) {
    await dbInstance
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
export const updateInvestors = async (
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
  // Un array vacío no reconstruye nada: el DELETE de abajo dejaría el crédito
  // sin inversionistas. Vaciar la lista es una operación explícita de otros
  // controllers, no un efecto colateral de este rebuild.
  if (!inversionistas || inversionistas.length === 0) return new Map();

  // 🔥 NUEVO: Obtener los datos existentes ANTES de borrar para preservar el estado
  const existingRecords = await dbInstance
    .select()
    .from(targetTable)
    .where(eq(targetTable.credito_id, credito_id));

  const statePrevioMap = new Map();
  existingRecords.forEach((record: any) => {
      // Guardamos status, tipo_reinversion y modalidad si existen en la tabla
      // (aplica para tabla espejo; en la tabla padre estos campos no existen
      // y quedan undefined, lo cual el "!== undefined" de abajo ya maneja).
      statePrevioMap.set(record.inversionista_id, {
          status: record.status,
          tipo_reinversion: record.tipo_reinversion,
          modalidad_facturacion: record.modalidad_facturacion,
          modalidad_facturacion_spread_id: record.modalidad_facturacion_spread_id,
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

  const porcentajesPorSpread = new Map<
    number,
    { porcentaje_cash_in: Big; porcentaje_inversion: Big }
  >();
  for (const inv of inversionistas) {
    if (!inv.es_nuevo || !inv.modalidad_facturacion_spread_id) continue;
    const spread = await getModalidadFacturacionSpreadById(
      inv.modalidad_facturacion_spread_id,
    );
    if (!spread || spread.modalidad !== inv.modalidad_facturacion) {
      throw new Error(
        `Bracket de modalidad de facturación inválido para el inversionista ${inv.inversionista_id}`,
      );
    }
    porcentajesPorSpread.set(inv.inversionista_id, {
      porcentaje_cash_in: new Big(100).minus(spread.spread),
      porcentaje_inversion: new Big(spread.spread),
    });
  }

  console.log(`💰 Capital Total: Q${capitalTotal.toFixed(2)}`);
  console.log(`📊 Cuota Total: Q${cuotaTotal.toFixed(2)}`);

  // Preparar datos de nuevos inversionistas
  const creditosInversionistasData = inversionistas.map((inv, index, arr) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📊 PROCESANDO INVERSIONISTA #${index + 1}`);
    console.log(`${"=".repeat(60)}`);

    const montoAportado = new Big(inv.monto_aportado);
    const porcentajeDelSpread = porcentajesPorSpread.get(inv.inversionista_id);
    const porcentajeCashIn =
      porcentajeDelSpread?.porcentaje_cash_in ?? new Big(inv.porcentaje_cash_in);
    const porcentajeInversion =
      porcentajeDelSpread?.porcentaje_inversion ?? new Big(inv.porcentaje_inversion);

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
    if (prevData?.modalidad_facturacion !== undefined) baseReturn.modalidad_facturacion = prevData.modalidad_facturacion;
    if (prevData?.modalidad_facturacion_spread_id !== undefined) baseReturn.modalidad_facturacion_spread_id = prevData.modalidad_facturacion_spread_id;
    if (targetTable === creditos_inversionistas_espejo && inv.es_nuevo) {
      baseReturn.tipo_reinversion = inv.tipo_reinversion ?? null;
      baseReturn.modalidad_facturacion = inv.modalidad_facturacion ?? null;
      baseReturn.modalidad_facturacion_spread_id = inv.modalidad_facturacion_spread_id ?? null;
    }

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
      // Sin default: `undefined` significa "campo omitido" y debe distinguirse
      // de `[]`, que es la orden explícita de dejar el crédito sin
      // inversionistas. El rebuild (delete+insert) se guía por esa diferencia.
      inversionistas,
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
      no_amortiza_capital,
      excluir_compras,
      estado_devolucion,
      motivo_devolucion,
      bandera_reinversion,
      motivo_ajuste_capital,
      motivo_ajuste_monto_aportado_padre,
      motivo_ajuste_monto_aportado_espejo,
      ...fieldsToUpdate
    } = parseResult.data;

    const espejoUserId = extractUserId(request);
    const runUpdate = async (tx: typeof db) => {
      const db = tx;

    // 2. Buscar el crédito actual (editable sin importar el status)
    const [current] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, credito_id))
      .limit(1);

    if (!current) {
      set.status = 400;
      return { message: "Credit not found" };
    }

    const capitalCambiaSolicitado = !new Big(fieldsToUpdate.capital).eq(
      new Big(current.capital || 0),
    );
    const motivoCapital = motivo_ajuste_capital?.trim();
    if (capitalCambiaSolicitado && !motivoCapital) {
      set.status = 400;
      return { message: "El motivo del ajuste de capital es obligatorio" };
    }

    const inversionistasPadreActuales = await db
      .select({
        inversionista_id: creditos_inversionistas.inversionista_id,
        monto_aportado: creditos_inversionistas.monto_aportado,
      })
      .from(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, credito_id));
    const montoAportadoPadreCambiados = getChangedExistingInvestorIds(
      inversionistasPadreActuales,
      inversionistas,
    );
    const montoAportadoPadreCambia = montoAportadoPadreCambiados.length > 0;
    const motivoMontoAportadoPadre = motivo_ajuste_monto_aportado_padre?.trim();
    if (montoAportadoPadreCambia && !motivoMontoAportadoPadre) {
      set.status = 400;
      return { message: "El motivo del ajuste de monto aportado del padre es obligatorio" };
    }

    const inversionistasEspejoActuales = await db
      .select({
        inversionista_id: creditos_inversionistas_espejo.inversionista_id,
        monto_aportado: creditos_inversionistas_espejo.monto_aportado,
      })
      .from(creditos_inversionistas_espejo)
      .where(eq(creditos_inversionistas_espejo.credito_id, credito_id));
    const montoAportadoEspejoCambiados = getChangedExistingInvestorIds(
      inversionistasEspejoActuales,
      inversionistas_espejo,
    );
    const montoAportadoEspejoCambia = montoAportadoEspejoCambiados.length > 0;
    const motivoMontoAportadoEspejo = motivo_ajuste_monto_aportado_espejo?.trim();
    if (montoAportadoEspejoCambia && !motivoMontoAportadoEspejo) {
      set.status = 400;
      return { message: "El motivo del ajuste de monto aportado del espejo es obligatorio" };
    }

    const suppressTechnicalMontoAudit = async () => {
      await setMontoAportadoAuditContext(db, "PADRE", undefined, []);
      await setMontoAportadoAuditContext(db, "ESPEJO", undefined, []);
    };

    // Estados de cierre: el crédito se puede editar, pero su calendario de
    // pagos es historia congelada — la cancelación deja los pagos no pagados
    // en paymentFalse=true con restantes en 0 (credits.ts) y el caído conserva
    // solo el desembolso de cuota 0 (fallenCredits.ts), ancla de
    // repararTotalRestante. Re-proyectarlos resucitaría deuda fantasma.
    const esCreditoFinalizado =
      current.statusCredit === "CANCELADO" || current.statusCredit === "CAIDO";

    // 3.0. En un crédito finalizado no entran inversionistas nuevos: la compra
    // o reinversión crearía una participación "viva" (con su fila en
    // compras_credito_inversionista que facturación trata como vigente) sobre
    // una deuda que ya no existe.
    const traeInversionistasNuevos =
      (inversionistas ?? []).some((inv) => inv.es_nuevo) ||
      (inversionistas_espejo ?? []).some((inv) => inv.es_nuevo);
    if (traeInversionistasNuevos && esCreditoFinalizado) {
      set.status = 400;
      return {
        message: `No se pueden registrar inversionistas nuevos en un crédito ${current.statusCredit}`,
      };
    }

    // En créditos finalizados la participación de inversionistas es historia
    // congelada: las listas del payload se IGNORAN (el front las manda siempre
    // al editar) — ni se validan ni se reconstruyen. La cancelación dejó esos
    // saldos en 0 y el rebuild (delete+insert) los reviviría con el
    // monto_aportado del body; investor.ts los suma sin filtrar status.
    if (
      esCreditoFinalizado &&
      ((inversionistas?.length ?? 0) > 0 ||
        (inversionistas_espejo?.length ?? 0) > 0)
    ) {
      console.log(
        `⚠️ Crédito ${current.statusCredit}: inversionistas del payload ignorados (participación congelada)`,
      );
    }

    // 3. Validar inversionistas
    if (!esCreditoFinalizado && inversionistas && inversionistas.length > 0) {
      const percentagesValidation = validateInvestorsPercentages(
        inversionistas as any,
        set,
      );
      if (!percentagesValidation.success) {
        return percentagesValidation.error;
      }
    }

    // 3.1. Validar inversionistas espejo si existen
    if (!esCreditoFinalizado && inversionistas_espejo && inversionistas_espejo.length > 0) {
      const mirrorValidation = validateInvestorsPercentages(
        inversionistas_espejo as any,
        set
      );
      if (!mirrorValidation.success) {
        return mirrorValidation.error;
      }
    }

    // 3.2. Inversionistas nuevos: nadie entra al crédito sin declararse
    // (es_nuevo + tipo_operacion) y sin haber sido validado contra el
    // historial. Corre ANTES de cualquier mutación: si falla, no se tocó nada.
    // Se valida también cuando solo viene el espejo, para que nadie se cuele
    // por esa lista.
    let inversionistasNuevos: InversionistaNuevoValidado[] = [];
    if (
      !esCreditoFinalizado &&
      ((inversionistas && inversionistas.length > 0) ||
        (inversionistas_espejo && inversionistas_espejo.length > 0))
    ) {
      const nuevosValidation = await validarInversionistasNuevos(
        credito_id,
        inversionistas ?? [],
        inversionistas_espejo,
        set,
        // El request manda si trae el flag; si no, vale el estado actual.
        excluir_compras ?? current.excluir_compras,
        db,
      );
      if (!nuevosValidation.success) {
        return nuevosValidation.error;
      }
      inversionistasNuevos = nuevosValidation.nuevos;

      // Igual que addInvestorToCredit: una compra que escala a combinada
      // backfillea espejos NULL con el modo global previo. Nunca pueden quedar
      // Excedente y Variable para el mismo inversionista.
      const nuevosPorInversionista = new Map<number, string[]>();
      for (const nuevo of inversionistasNuevos) {
        if (!nuevo.tipo_reinversion) continue;
        const modos = nuevosPorInversionista.get(nuevo.inversionista_id) ?? [];
        modos.push(nuevo.tipo_reinversion);
        nuevosPorInversionista.set(nuevo.inversionista_id, modos);
      }
      for (const inversionistaId of [...nuevosPorInversionista.keys()].sort((a, b) => a - b)) {
        const modosNuevos = nuevosPorInversionista.get(inversionistaId)!;
        const [inversionistaActual] = await db
          .select({ tipo_reinversion: inversionistasTabla.tipo_reinversion })
          .from(inversionistasTabla)
          .where(eq(inversionistasTabla.inversionista_id, inversionistaId))
          .for("update")
          .limit(1);
        const modoGlobal = inversionistaActual?.tipo_reinversion ?? null;
        const espejosExistentes = await db
          .select({ tipo_reinversion: creditos_inversionistas_espejo.tipo_reinversion })
          .from(creditos_inversionistas_espejo)
          .where(eq(creditos_inversionistas_espejo.inversionista_id, inversionistaId));
        const debeEscalar = modoGlobal !== "reinversion_combinada" && modosNuevos.some((modo) => modo !== modoGlobal);
        const modosFinales = [
          ...espejosExistentes.map((espejo) =>
            espejo.tipo_reinversion === null && debeEscalar ? modoGlobal : espejo.tipo_reinversion,
          ),
          ...modosNuevos,
        ];
        if (tieneConflictoExcedenteVariable(modosFinales)) {
          set.status = 409;
          return {
            message: "No se puede mezclar Excedente y Variable en el mismo inversionista: el monto de reinversión es único (una modalidad recibe un monto fijo y la otra reinvierte un monto fijo).",
          };
        }
      }
    }

    // Validar la transición antes de cualquier write (incluido usuario).
    const updateFields: any = { ...fieldsToUpdate };
    let historialDevolucion: Record<string, unknown> | undefined;
    if (estado_devolucion !== undefined && estado_devolucion !== current.estado_devolucion) {
      const fromState = current.estado_devolucion;
      const esSolicitudValida = estado_devolucion === "PENDIENTE_AUTORIZACION" &&
        (fromState === "NO_APLICA" || fromState === "RECHAZADO" || fromState === "VERIFICADO");
      const esDesactivacionValida = estado_devolucion === "NO_APLICA" && fromState === "PENDIENTE_AUTORIZACION";
      if (!esSolicitudValida && !esDesactivacionValida) {
        set.status = 400;
        return { message: `Transición de estado de devolución no permitida en este endpoint (${fromState} -> ${estado_devolucion})` };
      }
      if (esSolicitudValida && (!motivo_devolucion || motivo_devolucion.trim() === "")) {
        set.status = 400;
        return { message: "Motivo de devolución es obligatorio al solicitar devolución" };
      }
      historialDevolucion = {
        credito_id,
        usuario_id: 1,
        estado_anterior: fromState,
        estado_nuevo: estado_devolucion,
        motivo: esDesactivacionValida ? null : motivo_devolucion?.trim() ?? null,
      };
      updateFields.estado_devolucion = estado_devolucion;
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

    if (formato_credito !== undefined) {
      updateFields.formato_credito = formato_credito;
    } else {
      const formatCredit = (inversionistas ?? []).some(
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
    if (no_amortiza_capital !== undefined) {
      updateFields.no_amortiza_capital = no_amortiza_capital;
    }
    if (excluir_compras !== undefined) {
      updateFields.excluir_compras = excluir_compras;
    }
    if (historialDevolucion) await db.insert(historial_devolucion_credito).values(historialDevolucion as any);
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



      // Actualizar "otros" en la cuota inicial si cambió.
      // En créditos finalizados NO: la cuota 0 es historia congelada (en un
      // CAIDO es el único pago que sobrevive, ancla de repararTotalRestante).
      if (otrosModificado && !esCreditoFinalizado) {
        await updateInitialQuotaOtros(credito_id, fieldsToUpdate.otros, db);
      }


    }

    updateFields.membresias =
      fieldsToUpdate.membresias_pago ?? current.membresias_pago;

    // 8. Actualizar el crédito.
    // Si el capital cambia, envolvemos el UPDATE en withCapitalContext para que
    // el trigger trg_historial_capital_credito registre el ajuste manual con
    // usuario + motivo (fuente = 'AJUSTE_MANUAL'). Si no cambia, el trigger no
    // dispara (guard IS DISTINCT) y hacemos el UPDATE normal.
    const capitalCambia =
      fieldsToUpdate.capital !== undefined &&
      !new Big(fieldsToUpdate.capital).eq(new Big(current.capital || 0));

    const ejecutarUpdateCredito = (dbInstance: typeof db) =>
      dbInstance
        .update(creditos)
        .set(updateFields)
        .where(eq(creditos.credito_id, credito_id))
        .returning();

    let updatedCredit;
    if (capitalCambia) {
      await setCapitalSource(
        db,
        "AJUSTE_MANUAL",
        espejoUserId,
        motivoCapital,
      );
      [updatedCredit] = await ejecutarUpdateCredito(db);
    } else {
      [updatedCredit] = await ejecutarUpdateCredito(db);
    }

    // 8.1 Si la cuota cambió, sincronizar cuotas pendientes y recalcular
    // cuotas de inversionistas (solo si NO vinieron en el body — si vinieron,
    // el bloque siguiente las maneja con la cuota nueva).
    // En créditos finalizados NO se re-proyecta: updateInstallments selecciona
    // pagado=false sin excluir paymentFalse=true, así que reescribiría los
    // restantes que la cancelación dejó en 0 (o el desembolso del caído).
    if (willChangeCuota && esCreditoFinalizado) {
      console.log(
        `⚠️ Crédito ${current.statusCredit}: cuota actualizada solo en el crédito, calendario congelado (no se re-proyectan pagos ni cuotas de inversionistas)`,
      );
    }
    if (willChangeCuota && !esCreditoFinalizado) {
      const sifco = numero_credito_sifco ?? current.numero_credito_sifco;
      const cuotaNuevaNum = Number(updateFields.cuota);

        await updateInstallments({
          numero_credito_sifco: sifco,
          nueva_cuota: cuotaNuevaNum,
        }, db);

      const bodyTraeInversionistas =
        inversionistas !== undefined || inversionistas_espejo !== undefined;

      if (!bodyTraeInversionistas) {
        await suppressTechnicalMontoAudit();
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
            undefined,
            db,
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
            db,
          );
        }
      }
    }

    // 9-10.5. Rebuild de inversionistas (padre + espejo) y registro de las
    // compras de los nuevos, TODO en una sola transacción: si el registro de
    // compras falla después del rebuild, el rollback deshace también el rebuild.
    // Sin eso quedaba el inversionista nuevo dentro del crédito sin su fila en
    // compras_credito_inversionista (liquidación descuadrada) y el reintento con
    // el mismo payload rebotaba en la validación, porque el "nuevo" ya figuraba
    // como participante.
    console.log(`🪞 [ESPEJO] inversionistas_espejo recibidos: ${JSON.stringify(inversionistas_espejo?.length ?? 'undefined')}`);
    const runInvestorRebuild = async (tx: typeof db) => {
      // La segunda lectura ocurre bajo el lock que protege su clasificación y rebuild.
      const nuevosBajoLock = await validarInversionistasNuevos(
        credito_id,
        inversionistas ?? [],
        inversionistas_espejo,
        set,
        excluir_compras ?? current.excluir_compras,
        db,
      );
      if (!nuevosBajoLock.success) throw new Error(nuevosBajoLock.error.message);
      inversionistasNuevos = nuevosBajoLock.nuevos;
      // Igual que addInvestorToCredit: un modo por-crédito distinto del modo
      // global vuelve al inversionista combinado y preserva el modo anterior
      // en los espejos que todavía no tenían snapshot propio.
      const nuevosPorInversionista = new Map<number, InversionistaNuevoValidado>();
      for (const nuevo of inversionistasNuevos) {
        if (nuevo.tipo_reinversion) {
          nuevosPorInversionista.set(nuevo.inversionista_id, nuevo);
        }
      }
      for (const nuevo of nuevosPorInversionista.values()) {
        const [inversionistaActual] = await tx
          .select({ tipo_reinversion: inversionistasTabla.tipo_reinversion })
          .from(inversionistasTabla)
          .where(eq(inversionistasTabla.inversionista_id, nuevo.inversionista_id))
          .for("update")
          .limit(1);
        if (!inversionistaActual) {
          throw new Error(`Inversionista ${nuevo.inversionista_id} no encontrado`);
        }
        const modoAnterior = inversionistaActual.tipo_reinversion;
        if (modoAnterior !== "reinversion_combinada" && modoAnterior !== nuevo.tipo_reinversion) {
          await tx
            .update(inversionistasTabla)
            .set({ tipo_reinversion: "reinversion_combinada" })
            .where(eq(inversionistasTabla.inversionista_id, nuevo.inversionista_id));
          await tx
            .update(creditos_inversionistas_espejo)
            .set({ tipo_reinversion: modoAnterior })
            .where(
              and(
                eq(creditos_inversionistas_espejo.inversionista_id, nuevo.inversionista_id),
                isNull(creditos_inversionistas_espejo.tipo_reinversion),
              ),
            );
        }
      }
      // 9. Actualizar inversionistas (Principal)
      let parentCuotasTx: Map<number, string> = new Map();
      if (inversionistas !== undefined) {
        const nuevosPorId = new Map(
          inversionistasNuevos.map((inv) => [inv.inversionista_id, inv]),
        );
        const inversionistasNormalizados = inversionistas.map((inv) => {
          const nuevo = nuevosPorId.get(inv.inversionista_id);
          return nuevo?.porcentaje_inversion === undefined
            ? inv
            : {
                ...inv,
                porcentaje_cash_in: nuevo.porcentaje_cash_in!,
                porcentaje_inversion: nuevo.porcentaje_inversion,
              };
        });
        parentCuotasTx = await updateInvestors(
          credito_id,
          inversionistasNormalizados,
          updateFields,
          current,
          numero_credito_sifco ?? current.numero_credito_sifco,
          Number(updateFields.seguro_10_cuotas ?? current.seguro_10_cuotas),
          Number(updateFields.membresias_pago ?? current.membresias_pago),
          Number(updateFields.gps ?? current.gps),
          creditos_inversionistas, // Explicit target
          undefined,
          tx,
        );
      }

      // 10. Actualizar inversionistas (Espejo)
      if (inversionistas_espejo !== undefined) {
        // 🔒 Sincronización forzada solo de cuota_inversionista desde el padre.
        // El monto_aportado del espejo se respeta tal como viene del frontend
        // porque representa el saldo vivo del inversionista (capital - abonos)
        // y puede divergir del padre cuando ya hubo abonos a capital.
        const principalCuotas = new Map(
          (inversionistas || []).map((inv) => [inv.inversionista_id, inv.cuota_inversionista ?? 0])
        );

        const nuevoPorId = new Map(inversionistasNuevos.map((inv) => [inv.inversionista_id, inv]));
        const espejoSincronizado = inversionistas_espejo.map((inv) => {
          const nuevo = nuevoPorId.get(inv.inversionista_id);
          return {
            ...inv,
            ...(nuevo && {
              es_nuevo: true,
              tipo_reinversion: nuevo.tipo_reinversion,
              modalidad_facturacion: nuevo.modalidad_facturacion,
              modalidad_facturacion_spread_id: nuevo.modalidad_facturacion_spread_id,
              porcentaje_cash_in: nuevo.porcentaje_cash_in ?? inv.porcentaje_cash_in,
              porcentaje_inversion: nuevo.porcentaje_inversion ?? inv.porcentaje_inversion,
            }),
            cuota_inversionista: principalCuotas.get(inv.inversionista_id) ?? inv.cuota_inversionista,
          };
        });

        console.log(`🪞 [ESPEJO] Iniciando updateInvestors para credito_id=${credito_id} con ${espejoSincronizado.length} inversionistas`);
        await updateInvestors(
          credito_id,
          espejoSincronizado,
          updateFields,
          current,
          numero_credito_sifco ?? current.numero_credito_sifco,
          Number(updateFields.seguro_10_cuotas ?? current.seguro_10_cuotas),
          Number(updateFields.membresias_pago ?? current.membresias_pago),
          Number(updateFields.gps ?? current.gps),
          creditos_inversionistas_espejo,
          parentCuotasTx,
          tx,
        );
        console.log(`🪞 [ESPEJO] ✅ updateInvestors completado para espejo`);
      } else {
        console.log(`🪞 [ESPEJO] ⚠️ Bloque saltado: inversionistas_espejo está vacío o undefined`);
      }

      // 10.5. Registrar en compras_credito_inversionista la entrada de cada
      // inversionista nuevo (ya validado en 3.2). Va DESPUÉS del rebuild para
      // que el registro refleje la participación que acaba de materializarse,
      // pero dentro de la misma tx: o entran los dos o no entra ninguno.
      await registrarComprasInversionistasNuevos(credito_id, inversionistasNuevos, tx);
    };

    if (
      !esCreditoFinalizado &&
      (inversionistas !== undefined ||
        inversionistas_espejo !== undefined ||
        inversionistasNuevos.length > 0)
    ) {
      // updateInvestors reconstruye filas con DELETE + INSERT. El trigger usa
      // este contexto solo en rebuild final, no en recálculos intermedios.
      await setMontoAportadoAuditContext(
        db,
        "PADRE",
        motivoMontoAportadoPadre,
        montoAportadoPadreCambiados,
      );
      await setMontoAportadoAuditContext(
        db,
        "ESPEJO",
        motivoMontoAportadoEspejo,
        montoAportadoEspejoCambiados,
      );
      await runInvestorRebuild(db);
    }

    set.status = 200;
    return updatedCredit;
    };

    return await withCreditoEspejoLocks(async (locks) => {
      if (!(await locks.tryLock(credito_id))) {
        set.status = 409;
        return { message: `Crédito ${credito_id} está siendo operado por otro proceso` };
      }
      if (espejoUserId) {
        return await withAuditContext(espejoUserId, runUpdate);
      }
      return await db.transaction(async (tx) => runUpdate(tx as unknown as typeof db));
    });
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
  // `numero_cuota` YA NO ACOTA NADA (hotfix 2026-08-24). Antes, pasarlo
  // recalculaba "desde esa cuota, pagadas y no pagadas": como la amortización
  // siempre arranca del capital ACTUAL del crédito, ese modo solo era correcto
  // cuando la cuota coincidía con la primera sin pagar (= el modo sin cuota).
  // Con una cuota menor reescribía splits ya validados/facturados/distribuidos
  // a inversionistas con un capital ya reducido; con una mayor se saltaba la
  // cuota que la reversión acababa de reabrir (caso real: crédito 3, cuota 17,
  // conta mandó 18). El front sigue enviando el número; se acepta y se ignora
  // para no romper el contrato. Reparar historial pagado es trabajo de
  // /reparar-total-restante.
  // Se procesa siempre solo lo que AÚN NO SE APLICÓ al crédito: cuotas no
  // pagadas y también pagos ya registrados como pagados pero SIN validar por
  // conta (validationStatus='pending', vivos). Esos pagos no han movido capital ni
  // distribuido a inversionistas — su reparto guardado recién se aplica al
  // validarse, así que refrescarlo aquí es seguro y necesario: si quedaran
  // fuera, conta validaría el split viejo (interés pre-abono).
  // Las filas de ABONO A CAPITAL (validationStatus 'capital'/'capital_validated')
  // NUNCA entran al recálculo: su split es capital puro (abono_capital = monto),
  // no un reparto de cuota. Redistribuirlas aquí les reescribe el split como si
  // fueran pago de cuota — y si la cuota ya está cubierta por el pago mensual,
  // les toca puro cero. Caso real: abono registrado sin aplicar, un "Recalcular
  // Pagos" intermedio le dejó abono_capital en 0 y al aplicarse restó Q0 del
  // crédito. También cubre abonos ya aplicados que quedaron con pagado=false.
  // Las filas de CIERRE de incobrable tampoco: son el registro de la
  // liquidación del insoluto (monto_aplicado va en "otros", no es reparto de
  // cuota) y redistribuirlas las convierte en pago normal. Se excluyen las dos
  // variantes de isCreditClosingPayment: validationStatus 'reset' (caso real:
  // crédito 794, la cuota del reset quedó como última cuota pagada) y el cierre
  // legacy 'validated' + registerBy 'system_reset' (caso real: crédito 23 /
  // pago 121102).
  const filaNoEsAbonoCapitalNiCierre = and(
    or(
      isNull(pagos_credito.validationStatus),
      notInArray(pagos_credito.validationStatus, [
        "capital",
        "capital_validated",
        "reset",
      ]),
    ),
    or(
      isNull(pagos_credito.validationStatus),
      ne(pagos_credito.validationStatus, "validated"),
      ne(pagos_credito.registerBy, "system_reset"),
    ),
  );

  if (numero_cuota !== undefined) {
    console.warn(
      `⚠️ recalcularPagosCredito: numero_cuota=${numero_cuota} recibido para ${numero_credito_sifco} — se ignora; solo se recalculan cuotas no pagadas y pagos pendientes de validar.`,
    );
  }

  const whereConditions = and(
    eq(pagos_credito.credito_id, credito.credito_id),
    filaNoEsAbonoCapitalNiCierre,
    or(
      eq(pagos_credito.pagado, false),
      // Pagos registrados sin validar: solo con monto_aplicado > 0.
      // Los recibos especiales de solo mora/otros/convenio se guardan
      // pagado=true con monto_aplicado=0 — no son pago de cuota, no
      // tienen split que refrescar, y reescribirlos aquí los volvería
      // recibos de cuota (incluso volteando su pagado).
      and(
        eq(pagos_credito.pagado, true),
        eq(pagos_credito.validationStatus, "pending"),
        eq(pagos_credito.paymentFalse, false),
        gt(pagos_credito.monto_aplicado, "0"),
      ),
    ),
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

  // Contexto de solo lectura: parciales VALIDADOS vivos de las cuotas
  // seleccionadas, aunque tengan pagado=true (cuando un pending cierra la
  // cuota, insertPayment marca pagado=true a TODAS sus filas y el WHERE de
  // arriba dejaría fuera al validado). Nunca se escriben (ver esValidadoVivo);
  // solo netean el saldo de la cuota y restauran su capital.
  const cuotaIdsSeleccionadas = [...new Set(rows.map((r) => r.cuotas_credito.cuota_id))];
  const pagoIdsSeleccionados = new Set(rows.map((r) => r.pagos_credito.pago_id));
  const contextoValidados = await db
    .select()
    .from(pagos_credito)
    .innerJoin(cuotas_credito, eq(pagos_credito.cuota_id, cuotas_credito.cuota_id))
    .where(
      and(
        eq(pagos_credito.credito_id, credito.credito_id),
        inArray(pagos_credito.cuota_id, cuotaIdsSeleccionadas),
        eq(pagos_credito.validationStatus, "validated"),
        eq(pagos_credito.paymentFalse, false),
        ne(pagos_credito.registerBy, "system_reset"),
      ),
    )
    .orderBy(asc(cuotas_credito.numero_cuota), asc(pagos_credito.pago_id));
  for (const r of contextoValidados) {
    if (!pagoIdsSeleccionados.has(r.pagos_credito.pago_id)) rows.push(r);
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
  // Un sobre-abono (o data histórica) puede dejar el capital del crédito en
  // negativo; para la amortización un saldo negativo no existe. Sin este
  // clamp, el tope de abajo asignaría el negativo como abono_capital y los
  // recibos quedarían con capital_restante/abono_capital negativos.
  if (capitalEnMemoria.lt(0)) capitalEnMemoria = new Big(0);

  // Parciales VALIDADOS vivos: su capital YA se descontó de creditos.capital
  // al validarse, en TODAS las cuotas abiertas (un parcial puede caer en una
  // cuota posterior mientras las anteriores siguen abiertas). Se restaura
  // completo ANTES de amortizar la primera cuota: así cada cuota se proyecta
  // desde el mismo principal con que se sembró, el neteo de rem.capital resta
  // el capital validado una sola vez y la cadena queda igual a la sembrada.
  const esValidadoVivo = (p: (typeof rows)[number]["pagos_credito"]) =>
    p.validationStatus === "validated" && !p.paymentFalse;
  for (const r of rows) {
    if (esValidadoVivo(r.pagos_credito)) {
      capitalEnMemoria = capitalEnMemoria.plus(r.pagos_credito.abono_capital ?? 0);
    }
  }

  // 5️⃣ Procesar cada cuota en orden
  const actualizaciones: { pago_id: number; datos: Record<string, unknown> }[] = [];

  const cuotasOrdenadas = [...pagosPorCuota.entries()].sort(
    (a, b) => a[1].numero_cuota - b[1].numero_cuota,
  );

  for (const [, { numero_cuota: numCuota, pagos }] of cuotasOrdenadas) {
    // Cuota 0 (desembolso) no se recalcula
    if (numCuota === 0) continue;

    const validadosVivos = pagos.filter(esValidadoVivo);

    // Amortización de esta cuota
    const interesMes = capitalEnMemoria.times(porcentajeInteres).round(2);
    const ivaMes = interesMes.times(0.12).round(2);
    let abonoCapital = cuotaMensual
      .minus(interesMes)
      .minus(ivaMes)
      .minus(seguroFijo)
      .minus(gpsFijo)
      .minus(membresiasFijo);

    // Tope: un recibo nunca proyecta más capital del que queda en el crédito
    // (tras un abono grande la última porción es menor a la de una cuota
    // normal), y con saldo 0 las cuotas restantes ya no llevan capital. Sin
    // esto se sobre-cobraría capital y se sobre-distribuiría a inversionistas.
    if (abonoCapital.gt(capitalEnMemoria)) abonoCapital = capitalEnMemoria;

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

    // Pagos VALIDADOS por conta: un parcial validado de una cuota aún abierta
    // sigue `pagado=false` hasta que la cuota cierre (ver registerPayment),
    // así que el WHERE de arriba lo trae. Pero su capital ya se descontó del
    // crédito, su split ya se distribuyó a inversionistas y ya se facturó:
    // NO se reescribe. Solo consume el saldo de la cuota con los abonos que
    // tiene guardados, y lo hace ANTES del loop porque las filas sembradas
    // (fecha_pago null) se ordenan primero y su snapshot debe salir ya neto
    // — el mismo neteo que hace registerPayment al recibir el siguiente pago.
    const noNeg = (b: Big) => (b.lt(0) ? new Big(0) : b);
    for (const v of validadosVivos) {
      rem.interes = noNeg(rem.interes.minus(v.abono_interes ?? 0));
      rem.iva = noNeg(rem.iva.minus(v.abono_iva_12 ?? 0));
      rem.seguro = noNeg(rem.seguro.minus(v.abono_seguro ?? 0));
      rem.gps = noNeg(rem.gps.minus(v.abono_gps ?? 0));
      rem.membresias = noNeg(rem.membresias.minus(v.membresias_pago ?? 0));
      rem.capital = noNeg(rem.capital.minus(v.abono_capital ?? 0));
    }

    for (const pago of pagosOrdenados) {
      // Pagos ANULADOS (paymentFalse): conservan monto_aplicado, pero esa
      // plata ya no existe — no debe consumir el saldo de la cuota ni marcar
      // nada como pagado. Se tratan como monto 0 y caen a la rama de abajo:
      // la fila se re-siembra como recibo limpio (abonos 0, restantes del
      // saldo vigente). No se excluyen del SELECT a propósito: tras anular,
      // esta fila suele ser el destino que el próximo registro sobreescribe,
      // y así cascadea contra el saldo nuevo en vez del sembrado viejo.
      // Pagos VALIDADOS por conta: un parcial validado de una cuota aún
      // abierta sigue `pagado=false` hasta que la cuota cierre (ver
      // registerPayment), así que el WHERE de arriba lo trae. Pero su capital
      // ya se descontó del crédito, su split ya se distribuyó a inversionistas
      // y ya se facturó: NO se reescribe. Solo consume el saldo de la cuota
      // con los abonos que tiene guardados, para que los hermanos pendientes /
      // sembrados se siembren sobre el neto (mismo neteo que hace
      // registerPayment al recibir el siguiente pago de esa cuota).
      if (esValidadoVivo(pago)) continue;

      const montoAplicado = pago.paymentFalse
        ? new Big(0)
        : new Big(pago.monto_aplicado ?? 0);

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
