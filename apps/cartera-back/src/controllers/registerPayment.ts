import Big from "big.js";
import z from "zod";
import { db, client } from "../database";
import {
  creditos,
  usuarios,
  cuotas_credito,
  pagos_credito,
  creditos_inversionistas,
  boletas,
  moras_credito,
  inversionistas,
  pagos_credito_inversionistas,
  cuentasEmpresa,
} from "../database/db";
import { eq, and, lte, asc, desc, sql, gt, or, ne, inArray } from "drizzle-orm";
import { updateMora } from "./latefee";
import { insertPagosCreditoInversionistas, insertPagosCreditoInversionistasV2 } from "./payments";
import { processAndReplaceCreditInvestors } from "./investor"; 
import { processConvenioPayment } from "./paymentAgreement";
import { distribuirAbonoCapitalEspejo } from "./abonosCapital";
import {
  applyCapitalPaymentAndBuildResponse,
  calcularSaldoNetoCuota,
  esDestinoSobrescribible,
  getCuotaIdForPaymentInsert,
  getRequestedInstallmentFloor,
  getSpecialPaymentInstallmentFields,
  getSpecialPaymentCuotaId,
  recomputeCreditAfterCapital,
  shouldApplyStaleZeroRestanteAdjustment,
  shouldRejectZeroAppliedNormalValidation,
  shouldIncobrableInstallmentBePaid,
  shouldMarkInstallmentPaymentPaid,
  sumarAplicadoACuota,
} from "./registerPaymentPolicy";

type LockConn = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};

// Namespace para advisory locks de pagos (evita colisión con otros locks).
// pg_advisory_lock(ns, credito_id) serializa pagos concurrentes del mismo crédito.
const PAGO_LOCK_NS = 8765;

// ========================================
// TIPOS E INTERFACES
// ========================================

const pagoSchema = z.object({
  credito_id: z.number().int().positive(),
  usuario_id: z.number().int().positive(),
  monto_boleta: z.number().min(0),
  fecha_pago: z.string(),
  llamada: z.string().optional(),
  renuevo_o_nuevo: z.string().optional(),
  otros: z.number().min(0).optional(),
  observaciones: z.string().optional(),
  abono_directo_capital: z.number().min(0).optional(),
  cuotaApagar: z.number().int(),
  url_boletas: z.array(z.string()),
  banco_id: z.number().int().positive().optional(),
  numeroAutorizacion: z.string().optional(),
  registerBy: z.string().min(1),
  fecha_boleta: z.string(),
  origen_pago: z.enum(["transferencia", "cheque", "boleta"]).optional().default("transferencia"),
});

type PagoData = z.infer<typeof pagoSchema>;

interface SetContext {
  status: number;
}

// ========================================
// 1. PREPARACIÓN DE DATOS
// ========================================

/**
 * Prepara las URLs completas de las boletas
 */
const prepararURLsBoletas = (url_boletas: string[]): string[] => {
  const r2BaseUrl = import.meta.env.URL_PUBLIC_R2;
  return url_boletas.map((url_boleta) => `${r2BaseUrl}${url_boleta}`);
};
/**
 * 💸 Procesa el pago de mora si existe
 *
 * Lógica:
 * 1. Verifica si hay mora activa
 * 2. Si alcanza, paga toda la mora
 * 3. Si no alcanza, paga lo que se pueda (pago parcial)
 * 4. Retorna cuánto dinero sobró para las cuotas
 *
 * @returns Objeto con resultado del pago de mora y dinero disponible restante
 */
// 📋 Tipos para el método
interface MoraInfo {
  mora_id: number;
  credito_id: number;
  activa: boolean;
  porcentaje_mora: string | number;
  monto_mora: Big;
  cuotas_atrasadas: number;
  created_at: Date | null;
  updated_at: Date | null;
}

interface StatsInfo {
  totalCuotasPendientes: number;
  totalInversionistas: number;
  tieneMora: boolean;
  cuotasAtrasadas: number;
  montoMoraTotal: number;
}

interface ResultadoMora {
  teniaMora: boolean;
  moraPagada: boolean;
  pagoCompleto?: boolean;
  pagoParcial?: boolean;
  montoAplicadoMora: number;
  saldoMoraRestante: number;
  disponibleRestante: number;
  mensaje: string;
}

const procesarPagoMora = async ({
  credito_id,
  numero_credito_sifco,
  mora,
  stats,
  disponible,
}: {
  credito_id: number;
  numero_credito_sifco: string;
  mora: MoraInfo | null;
  stats: StatsInfo;
  disponible: Big;
}): Promise<ResultadoMora> => {
  // 🔍 Verificar si NO hay mora activa
  console.log("\n🔍 Verificando mora activa...");
  console.log("stats:", stats);
  console.log("mora:", mora);
  console.log("disponible:", disponible.toString());
  console.log(`  Tiene mora activa: ${stats.tieneMora}`);
  if (!stats.tieneMora || !mora || !mora.activa) {
    console.log("✅ Crédito al día (sin mora activa)");
    return {
      teniaMora: false,
      moraPagada: false,
      montoAplicadoMora: 0,
      saldoMoraRestante: 0,
      disponibleRestante: disponible.toNumber(),
      mensaje: "Sin mora activa",
    };
  }

  // ⚠️ Hay mora activa
  console.log("\n⚠️ CRÉDITO CON MORA ACTIVA");
  console.log(`  Cuotas atrasadas: ${mora.cuotas_atrasadas}`);
  console.log(`  Monto mora: $${mora.monto_mora.toString()}`);
  console.log(`  Porcentaje: ${mora.porcentaje_mora}%`);
  console.log(`  Disponible para pagar: $${disponible.toString()}`);

  const montoMora = new Big(mora.monto_mora);

  // ❌ Caso 1: No hay dinero disponible
  if (disponible.lte(0)) {
    console.log("❌ No hay dinero disponible para pagar mora");
    return {
      teniaMora: true,
      moraPagada: false,
      montoAplicadoMora: 0,
      saldoMoraRestante: montoMora.toNumber(),
      disponibleRestante: 0,
      mensaje: "Sin fondos para pagar mora",
    };
  }

  // ✅ Caso 2: Alcanza para pagar TODA la mora
  if (disponible.gte(montoMora)) {
    console.log(
      `✅ Alcanza para pagar toda la mora ($${montoMora.toString()})`
    );

    // Actualizar mora a 0 (se desactiva automáticamente)
    const resultadoMora = await updateMora({
      credito_id,
      numero_credito_sifco,
      tipo: "DECREMENTO",
      monto_cambio: montoMora.toNumber(),
    });

    if (!resultadoMora.success) {
      throw new Error("Error al actualizar mora: " + resultadoMora.message);
    }

    // Descontar de disponible
    const nuevoDisponible = disponible.minus(montoMora);

    console.log(
      `💚 Mora pagada completamente. Restante: $${nuevoDisponible.toString()}`
    );

    return {
      teniaMora: true,
      moraPagada: true,
      pagoCompleto: true,
      montoAplicadoMora: montoMora.toNumber(),
      saldoMoraRestante: 0,
      disponibleRestante: nuevoDisponible.toNumber(),
      mensaje: "Mora pagada completamente",
    };
  }

  // ⚠️ Caso 3: NO alcanza para toda la mora (pago parcial)
  console.log(
    `⚠️ Solo alcanza para pago parcial de mora: $${disponible.toString()}`
  );

  // Aplicar todo lo disponible a la mora
  const resultadoMora = await updateMora({
    credito_id,
    numero_credito_sifco,
    tipo: "DECREMENTO",
    monto_cambio: disponible.toNumber(),
  });

  if (!resultadoMora.success) {
    throw new Error("Error al actualizar mora: " + resultadoMora.message);
  }

  const saldoMoraRestante = montoMora.minus(disponible);

  console.log(
    `💛 Mora reducida. Saldo pendiente: $${saldoMoraRestante.toString()}`
  );

  return {
    teniaMora: true,
    moraPagada: false,
    pagoCompleto: false,
    pagoParcial: true,
    montoAplicadoMora: disponible.toNumber(),
    saldoMoraRestante: saldoMoraRestante.toNumber(),
    disponibleRestante: 0,
    mensaje: "Pago parcial de mora aplicado",
  };
};

/**
 * 🚀 Obtiene información completa del crédito en 2 queries optimizadas
 *
 * Trae:
 * - Información del crédito activo
 * - Saldo a favor del usuario dueño del crédito
 * - Lista de inversionistas
 * - Cuotas pendientes hasta la cuota a pagar
 * - Información de mora activa (si existe)
 *
 * @param credito_id - ID del crédito a consultar
 * @param set - Context para manejar errores HTTP
 * @returns Objeto con toda la información del crédito
 */
const obtenerInfoCompletaCredito = async (
  credito_id: number,
  set: SetContext,
  cuotaApagar: number
) => {
  try {
    // 📋 Query 1: Crédito + Usuario + Mora (1 fila)
    const [info] = await db
      .select({
        credito: creditos,
        saldo_a_favor: usuarios.saldo_a_favor,
        usuario_id: usuarios.usuario_id,
        // 💸 Información de mora activa (si existe)
        mora: moras_credito,
      })
      .from(creditos)
      .leftJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
      .leftJoin(
        moras_credito,
        and(
          eq(moras_credito.credito_id, creditos.credito_id),
          eq(moras_credito.activa, true) // ✅ Solo traer mora activa
        )
      )
      .where(
        and(
          eq(creditos.credito_id, credito_id),
          or(
            eq(creditos.statusCredit, "ACTIVO"),
            eq(creditos.statusCredit, "MOROSO"),
            eq(creditos.statusCredit, "EN_CONVENIO") 
            ,eq(creditos.statusCredit, "INCOBRABLE")// 🚨 También traer créditos en convenio
          )
        )
      )
      .limit(1);

    // ❌ Validación: Crédito no encontrado o inactivo
    if (!info || !info.credito) {
      set.status = 404;
      throw new Error("Credit not found");
    }

    // ❌ Validación: Usuario no encontrado
    if (info.saldo_a_favor === null || !info.usuario_id) {
      set.status = 404;
      throw new Error("User not found");
    }

    // 🔥 Query 2: Inversionistas + Cuotas pendientes (en paralelo)
    const [inversionistas, cuotasPendientes] = await Promise.all([
      // 👥 Todos los inversionistas del crédito
      db
        .select()
        .from(creditos_inversionistas)
        .where(eq(creditos_inversionistas.credito_id, credito_id)),

      // 📊 Cuotas pendientes (sin filtro de cuota específica, traemos TODAS las pendientes)
      db
        .select()
        .from(cuotas_credito)
        .innerJoin(
          pagos_credito,
          eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
        )
        .where(
          and(
            eq(cuotas_credito.credito_id, credito_id),
            eq(cuotas_credito.pagado, false),
            // Permitir reportar/aplicar pagos adicionales aunque la cuota
            // ya tenga otro pago pendiente de validación. Contabilidad puede
            // validar después y el cálculo usa los restantes del pago previo.
            sql`${cuotas_credito.numero_cuota} >= ${getRequestedInstallmentFloor(cuotaApagar)}`
          )
        )
        .orderBy(cuotas_credito.numero_cuota),
    ]);
    console.log(cuotaApagar,"cuota a pagar");
    const cuotasPendientesUnicas = Array.from(
      new Map(
        cuotasPendientes.map((item) => [item.cuotas_credito.cuota_id, item])
      ).values()
    );
    const numerosCuotas = cuotasPendientesUnicas.map((item) => item.cuotas_credito.numero_cuota);
    console.log("Números de cuotas pendientes:", numerosCuotas);

    // 🎯 O si quieres más info:
    console.log("Cuotas pendientes:", cuotasPendientesUnicas.map(item => ({
      numero_cuota: item.cuotas_credito.numero_cuota,
      fecha_vencimiento: item.cuotas_credito.fecha_vencimiento,
      cuota_id: item.cuotas_credito.cuota_id
    })));
    // ✅ Retornar todo estructurado
    return {
      // 📋 Crédito completo
      credito: info.credito,

      // 📊 Cuotas pendientes (array ordenado)
      cuotasPendientes: cuotasPendientesUnicas,

      // 👥 Inversionistas (array)
      inversionistas,

      // 💰 Saldo a favor del usuario dueño del crédito
      saldoAFavor: new Big(info.saldo_a_favor ?? 0),

      // 👤 ID del usuario dueño
      usuario_id: info.usuario_id,

      // 💸 Información de mora (puede ser null si no tiene mora activa)
      mora: info.mora
        ? {
            activa: info.mora.activa,
            cuotas_atrasadas: info.mora.cuotas_atrasadas,
            monto_mora: new Big(info.mora.monto_mora ?? 0),
            porcentaje_mora: Number(info.mora.porcentaje_mora ?? 0),
            mora_id: info.mora.mora_id,
            credito_id: info.mora.credito_id,
            created_at: info.mora.created_at,
            updated_at: info.mora.updated_at,
          }
        : null,

      // 📈 Stats útiles
      stats: {
        totalCuotasPendientes: cuotasPendientesUnicas.length,
        totalInversionistas: inversionistas.length,

        // 🚨 Indicador de mora
        tieneMora: info.mora !== null && info.mora.activa === true,
        cuotasAtrasadas: info.mora?.cuotas_atrasadas ?? 0,
        montoMoraTotal: info.mora ? Number(info.mora.monto_mora ?? 0) : 0,
      },
    };
  } catch (error) {
    // 🔥 Preservar errores 404
    if (
      (error as any).message === "Credit not found" ||
      (error as any).message === "User not found"
    ) {
      throw error;
    }

    // 🐛 Otros errores
    console.error("❌ Error en obtenerInfoCompletaCredito:", error);
    set.status = 500;
    throw new Error("Error al obtener información del crédito");
  }
};

export default obtenerInfoCompletaCredito;
/**
 * Calcula el monto efectivo disponible para pagar cuotas
 */
const calcularMontoEfectivo = (
  montoBoleta: Big,
  saldoAFavor: Big,
  otros: Big,
  abonoDirectoCapital: number
): Big => {
  return (montoBoleta).minus(otros).minus(abonoDirectoCapital ?? 0);
};

// ========================================
// 4. PROCESAMIENTO DE PAGOS ESPECIALES
// ========================================

/**
 * Procesa pagos especiales (mora/otros sin cuotas pendientes)
 */

// ========================================
// 5. CÁLCULO DE ABONOS POR CUOTA
// ========================================

// ========================================
// 6. ACTUALIZACIÓN DE CRÉDITO
// ========================================

/**
 * Actualiza el capital y deuda del crédito
 */
const actualizarCapitalCredito = async (
  credito_id: number,
  capitalRestante: string,
  credito: any
) => {
  const cuota_interes = new Big(capitalRestante)
    .times(new Big(credito.porcentaje_interes).div(100))
    .round(2);
  const iva_12 = cuota_interes.times(0.12).round(2);

  const deudatotal = new Big(capitalRestante)
    .plus(cuota_interes)
    .plus(iva_12)
    .plus(credito.seguro_10_cuotas ?? 0)
    .plus(credito.gps ?? 0)
    .plus(credito.membresias_pago ?? 0)
    .round(2)
    .toString();

  await db
    .update(creditos)
    .set({
      capital: capitalRestante,
      deudatotal: deudatotal,
      iva_12: iva_12.toString(),
      cuota_interes: cuota_interes.toString(),
    })
    .where(eq(creditos.credito_id, credito_id));
};

// ========================================
// 7. GESTIÓN DE BOLETAS
// ========================================

/**
 * Inserta las boletas asociadas a un pago
 */
const insertarBoletas = async (pago_id: number, urlCompletas: string[]) => {
  if (urlCompletas && urlCompletas.length > 0) {
    await db.insert(boletas).values(
      urlCompletas.map((url) => ({
        pago_id: pago_id,
        url_boleta: url,
      }))
    );
  }
};

// ========================================
// 8. PROCESAMIENTO DE CUOTA
// ========================================

/**
 * Procesa el pago de una cuota individual
 */

// ========================================
// FUNCIÓN PRINCIPAL
// ========================================

export const insertPayment = async ({ body, set }: any) => {
  // 🔒 Conexión dedicada para el advisory lock (se libera en finally).
  let lockConn: LockConn | undefined;
  let lockedCreditoId: number | undefined;
  try {
    // 1. Validar schema
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
      monto_boleta,
      fecha_pago,
      llamada,
      renuevo_o_nuevo,
      otros,
      observaciones,
      abono_directo_capital,
      cuotaApagar,
      url_boletas,
      banco_id,
      numeroAutorizacion,
      registerBy,
      fecha_boleta,
      origen_pago,
    } = parseResult.data;

    // 🔒 LOCK PESIMISTA POR CRÉDITO
    // Serializa los pagos concurrentes del MISMO crédito. Sin esto, dos pagos
    // a la misma cuota que entran casi al mismo tiempo (doble clic, reintento,
    // dos cajeros) leen el mismo saldo vigente ANTES de que el otro escriba
    // (TOCTOU) y ambos re-aplican interés/IVA/etc → interés duplicado. La
    // validación anti-sobreaplicación no los detiene porque ambos leen el
    // estado previo. El lock obliga a que el segundo espere a que el primero
    // termine y vea el saldo ya actualizado.
    lockConn = await client.connect();
    lockedCreditoId = credito_id;
    await lockConn.query("SELECT pg_advisory_lock($1, $2)", [
      PAGO_LOCK_NS,
      credito_id,
    ]);

    // 2. Preparar datos
    const urlCompletas = prepararURLsBoletas(url_boletas);
    const boletasExistentes = numeroAutorizacion && banco_id 
      ? await db
        .select({
          numeroAutorizacion: pagos_credito.numeroAutorizacion,
        })
        .from(pagos_credito)
        .where(and(eq(pagos_credito.numeroAutorizacion, numeroAutorizacion), eq(pagos_credito.banco_id, banco_id)))
      : [];
      
      if (boletasExistentes.length > 0) {
        console.log(`❌ Se encontraron ${boletasExistentes.length} boletas duplicadas:`);
        boletasExistentes.forEach(b => {
          console.log(`   - ${b.numeroAutorizacion} `);
        });
        
        set.status = 409; // Conflict
        return {
          success: false,
          message: "Una o más boletas ya fueron registradas previamente",
          boletas_duplicadas: boletasExistentes.map(b => ({
            numeroAutorizacion: b.numeroAutorizacion,
 
          })),
        };
      }
    // 4. Calcular disponible
    const montoBoleta = new Big(monto_boleta);

    // Antes se bloqueaba la cuota si ya tenía un pago `pending`. Ahora se
    // permite registrar otro pago sobre la misma cuota para no depender de
    // validación contable antes de reportar el abono complementario.

    // 1. Obtener toda la info del crédito UNA SOLA VEZ
    const creditoData = await obtenerInfoCompletaCredito(
      credito_id,
      set,
      cuotaApagar
    );

    const {
      credito,
      inversionistas,
      cuotasPendientes,
      saldoAFavor,
      mora,
      stats,
      usuario_id,
    } = creditoData;
    const cuotaIdPagoEspecial = getSpecialPaymentCuotaId({
      requestedInstallment: cuotaApagar,
      pendingInstallments: cuotasPendientes.map((cuota) => ({
        numeroCuota: cuota.cuotas_credito.numero_cuota,
        cuotaId: cuota.cuotas_credito.cuota_id,
      })),
    });
    const pagoEspecialCuota = getSpecialPaymentInstallmentFields();

    // 3. Preparar creditoInfo con las variables destructuradas
    const creditoInfo = {
      credito,
      inversionistas,
      cuotasPendientes,
      mora: mora
        ? {
            ...mora,
            created_at: mora.created_at ?? new Date(),
            updated_at: mora.updated_at ?? new Date(),
          }
        : undefined,
    };
    let moraBig = new Big(mora?.monto_mora ?? 0);
    const otrosBig = new Big(otros ?? 0);

    if (montoBoleta.eq(otrosBig)) {
      await insertarPago({
        numero_credito_sifco: credito.numero_credito_sifco,
        numero_cuota: cuotaApagar,
        cuotaId: cuotaIdPagoEspecial,
        otros: otrosBig.toNumber(),
        mora: 0,
        boleta: montoBoleta.toNumber(),
        urlBoletas: urlCompletas ?? [],
        pagado: pagoEspecialCuota.pagado,
        banco_id: banco_id ?? 0,
        numeroAutorizacion: numeroAutorizacion ?? "",
        registerBy: registerBy ?? "",
        fecha_boleta,
        monto_aplicado: pagoEspecialCuota.montoAplicado,
      });
    }

    const montoEfectivo = calcularMontoEfectivo(
      montoBoleta,
      saldoAFavor,
      otrosBig,
      abono_directo_capital ?? 0
    );

    //  Llamás processConvenioPayment pasándole la info
    // 3. Preparar pagoMetadata (con los datos del pago que está haciendo el usuario)
  let montoConvenio = new Big(0);
let pagoConvenio = null;

if (creditoInfo.credito.statusCredit === "EN_CONVENIO") {
  // 2. Preparar pagoMetadata (con los datos del pago que está haciendo el usuario)
  const pagoMetadata = {
    montoBoleta: montoBoleta.toString(),
    llamada: llamada,
    renuevo_o_nuevo: "Convenio",
    observaciones: observaciones,
    numeroAutorizacion: numeroAutorizacion,
    banco_id: banco_id,
    registerBy: usuario_id,
    urlCompletas: urlCompletas,
  };

  // 3. 🔥 Llamar processConvenioPayment con TODA la info
  pagoConvenio = await processConvenioPayment({
    credito_id: credito_id,
    monto_pago: montoEfectivo.toNumber(),
    creditoInfo: creditoInfo,
    pagoMetadata: pagoMetadata,
  });

  // 4. El resultado contiene:
  console.log(pagoConvenio.success);
  console.log(pagoConvenio.message);
  console.log(pagoConvenio.convenio);
  montoConvenio = new Big(pagoConvenio.monto_aplicado);
  console.log("monto convenio:", montoConvenio.toString());
} else {
  console.log(`[INFO] Crédito #${credito_id} no está EN_CONVENIO, saltando procesamiento de convenio`);
}
 
    console.log("monto convenio:", montoConvenio.toString());
    let disponible =montoEfectivo  
    // 🔥 PROCESAR MORA - Ahora solo pasas los IDs
    const resultadoMora = await procesarPagoMora({
      credito_id: credito.credito_id,
      numero_credito_sifco: credito.numero_credito_sifco,
      mora: mora,
      stats,
      disponible,
    });
    // Actualizar disponible
    disponible = new Big(resultadoMora.disponibleRestante);
    const montoCuota = new Big(credito.cuota);
    let disponible_restante = disponible 
    if (!resultadoMora.teniaMora) {
      console.log(
        "No tenía mora activa, se procede a registrar el pago normal."
      );
    } else {
      console.log("Resultado del pago de mora:", resultadoMora);
      if (resultadoMora.pagoCompleto && resultadoMora.moraPagada) {
        moraBig = new Big(resultadoMora.montoAplicadoMora);
        if (disponible_restante.lte(0)) {
          await insertarPago({
            numero_credito_sifco: credito.numero_credito_sifco,
            numero_cuota: cuotaApagar,
            cuotaId: cuotaIdPagoEspecial,
            otros: otrosBig.toNumber(),
            mora: resultadoMora.montoAplicadoMora,
            boleta: montoBoleta.toNumber(),
            urlBoletas: urlCompletas ?? [],
            pagado: pagoEspecialCuota.pagado,
            banco_id: banco_id ?? 0,
            numeroAutorizacion: numeroAutorizacion ?? "",
            registerBy: registerBy ?? "",
            fecha_boleta,
            monto_aplicado: pagoEspecialCuota.montoAplicado,
          });
        }
        console.log(
          "Mora pagada completamente, se procede a registrar el pago normal."
        );
      }
      if (!resultadoMora.moraPagada && resultadoMora.pagoParcial) {
        if (disponible_restante.lte(0)) {
          await insertarPago({
            numero_credito_sifco: credito.numero_credito_sifco,
            numero_cuota: cuotaApagar,
            cuotaId: cuotaIdPagoEspecial,
            otros: otrosBig.toNumber(),
            mora: resultadoMora.montoAplicadoMora,
            boleta: montoBoleta.toNumber(),
            urlBoletas: urlCompletas ?? [],
            pagado: pagoEspecialCuota.pagado,
            banco_id: banco_id ?? 0,
            numeroAutorizacion: numeroAutorizacion ?? "",
            registerBy: registerBy ?? "",
            fecha_boleta,
            monto_aplicado: pagoEspecialCuota.montoAplicado,
          });
        }
        return {
          message: `Pago parcial de mora aplicado. Saldo pendiente de mora: $${resultadoMora.saldoMoraRestante}. Por favor, cancele la mora pendiente para continuar con el pago de cuotas.`,
          pagos: [],
          saldo_a_favor: disponible.toString(),
        };
      }
    }

    if (!resultadoMora.moraPagada && resultadoMora.montoAplicadoMora > 0) {
      if (disponible_restante.lte(0)) {
        await insertarPago({
          numero_credito_sifco: credito.numero_credito_sifco,
          numero_cuota: cuotaApagar,
          cuotaId: cuotaIdPagoEspecial,
          otros: otrosBig.toNumber(),
          mora: resultadoMora.montoAplicadoMora,
          boleta: montoBoleta.toNumber(),
          urlBoletas: urlCompletas ?? [],
          pagado: pagoEspecialCuota.pagado,
          banco_id: banco_id ?? 0,
          numeroAutorizacion: numeroAutorizacion ?? "",
          registerBy: registerBy ?? "",
          fecha_boleta,
          monto_aplicado: pagoEspecialCuota.montoAplicado,
        });
      }
      return {
        message: `Pago parcial de mora aplicado. Saldo pendiente de mora: $${resultadoMora.saldoMoraRestante}. Por favor, cancele la mora pendiente para continuar con el pago de cuotas.`,
        pagos: [],
        saldo_a_favor: disponible.toString(),
      };
    }

    let cuotas_completas = 0;
    let cuotas_parciales = 0;
    let disponible_para_cuotasPosteriores = new Big(0);
    for (const cuota of cuotasPendientes) {
      console.log("\n===============================");
      console.log(
        `🚀 Procesando cuota #${cuota.cuotas_credito.numero_cuota} (Monto: $${montoCuota.toString()})`
      );
      console.log(
        `💰 Disponible antes de cuota: $${disponible_restante.toString()}`
      );
      if (disponible_restante.gt(0)) {
        // Verificar si existe pago previo - priorizar el original (no_required)
        const allExistingPagos = await db
          .select({ pago: pagos_credito })
          .from(pagos_credito)
          .innerJoin(
            cuotas_credito,
            eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
          )
          .where(
            and(
              eq(
                pagos_credito.cuota_id,
                cuota.cuotas_credito.cuota_id
              ),
              eq(pagos_credito.credito_id, credito.credito_id),
              or(
                ne(pagos_credito.validationStatus, "pending"),
                and(
                  eq(pagos_credito.validationStatus, "pending"),
                  eq(pagos_credito.pagado, false),
                  eq(pagos_credito.paymentFalse, false)
                )
              )
            )
          )
          .orderBy(asc(pagos_credito.pago_id));

        // Último pago PARCIAL aún `pending` de esta cuota (todavía no pasó por
        // /aplicar-pago). El query de arriba excluye los `pending`, pero para
        // el SALDO VIGENTE sí los necesitamos: si entran dos pagos a la misma
        // cuota antes de validar el primero, el segundo debe partir del saldo
        // que dejó el primero y NO re-aplicar los mismos rubros
        // (interés/IVA/seguro/membresías). Ref: crédito 197, cuota 6.
        const [ultimoParcialPendiente] = await db
          .select({ pago: pagos_credito })
          .from(pagos_credito)
          .where(
            and(
              eq(pagos_credito.cuota_id, cuota.cuotas_credito.cuota_id),
              eq(pagos_credito.credito_id, credito.credito_id),
              eq(pagos_credito.validationStatus, "pending"),
              eq(pagos_credito.paymentFalse, false)
            )
          )
          .orderBy(desc(pagos_credito.pago_id))
          .limit(1);

        const pagoOriginal = allExistingPagos.find(
          (p) => p.pago.validationStatus === "no_required"
        );
        const tieneRestante = (pago: typeof pagos_credito.$inferSelect) =>
          new Big(pago.interes_restante ?? 0)
            .plus(pago.iva_12_restante ?? 0)
            .plus(pago.seguro_restante ?? 0)
            .plus(pago.gps_restante ?? 0)
            .plus(pago.membresias ?? 0)
            .plus(pago.capital_restante ?? 0)
            .gt(0);
        const esPagoSaldoElegible = (pago: typeof pagos_credito.$inferSelect) =>
          pago.validationStatus === "validated" ||
          (pago.validationStatus === "pending" &&
            pago.pagado === false &&
            pago.paymentFalse === false);
        const ultimoPagoParcialConRestante = [...allExistingPagos]
          .reverse()
          .find(
            ({ pago }) =>
              esPagoSaldoElegible(pago) &&
              tieneRestante(pago)
          );
        const tienePagosValidados = allExistingPagos.some(
          ({ pago }) => pago.validationStatus === "validated"
        );
        // El pago original es la fila destino. Para el SALDO VIGENTE tomamos el
        // abono parcial MÁS RECIENTE con restante —sea `validated` o `pending`—
        // quedándonos con el de pago_id más alto. Así un 2.º pago a la misma
        // cuota parte de lo que abonó el 1.º aunque aún no se haya validado, y
        // no duplica interés/IVA/seguro/membresías.
        const existingPago = pagoOriginal ?? allExistingPagos[0];
        const candidatosSaldo = [
          ultimoPagoParcialConRestante,
          ultimoParcialPendiente && tieneRestante(ultimoParcialPendiente.pago)
            ? ultimoParcialPendiente
            : undefined,
        ].filter(Boolean) as { pago: typeof pagos_credito.$inferSelect }[];
        const saldoMasReciente = candidatosSaldo.sort(
          (a, b) => b.pago.pago_id - a.pago.pago_id
        )[0];
        const pagoSaldoVigente = saldoMasReciente ?? existingPago;
        // Inicializar variables de abono
        // 2. OBTENER LOS RESTANTES DEL PAGO EXISTENTE (no de la cuota)
        const interes_restante = new Big(
          pagoSaldoVigente?.pago.interes_restante ?? 0
        );
        const iva_restante = new Big(pagoSaldoVigente?.pago.iva_12_restante ?? 0);
        let seguro_restante = new Big(
          pagoSaldoVigente?.pago.seguro_restante ?? 0
        );
        let gps_restante = new Big(pagoSaldoVigente?.pago.gps_restante ?? 0);
        let membresias_restante = new Big(pagoSaldoVigente?.pago.membresias ?? 0);
        let capital_restante_pago = new Big(
          pagoSaldoVigente?.pago.capital_restante ?? 0
        );

        // ── Saldo NETO de la cuota (anti re-aplicación de rubros) ──────────
        // Los `*_restante` viven por fila y se desincronizan entre pagos
        // hermanos: un rubro ya cubierto por un pago previo puede seguir
        // mostrando saldo en otra fila (caso crédito 1086 / cuota 48: seguro
        // y GPS ya pagados pero con `*_restante` lleno y capital inflado). Si
        // distribuyéramos sobre esos saldos re-aplicaríamos rubros ya pagados
        // y la cuota se pasaría de su monto. Recalculamos el saldo de cada
        // rubro NETO de lo que ya abonaron los hermanos vivos y topamos el
        // capital al faltante real de la cuota (monto_cuota − Σ monto_aplicado
        // hermanos). El sobrante rebalsa a la siguiente cuota por el flujo
        // normal del loop. `aplicadoPrevioCuota`/`interesPrevioCuota` los
        // reusa la red de seguridad de más abajo.
        const TOLERANCIA_CENTAVO = new Big(0.01);
        // ¿`existingPago` es una fila desechable que el cierre puede SOBRESCRIBIR
        // (placeholder `no_required` o fila vacía), o es un pago REAL que cayó al
        // fallback `allExistingPagos[0]` porque el `no_required` ya fue consumido?
        // De esto depende todo: si NO es sobrescribible, el cierre INSERTA una
        // fila nueva (no la pisa) y, por lo mismo, `existingPago` es un hermano
        // REAL que SÍ debe contarse. Solo lo excluimos del set de hermanos cuando
        // realmente lo vamos a UPDATE-ar (i.e. cuando es sobrescribible); si no,
        // contar sus rubros evita re-aplicar interés/IVA/etc.
        const destinoSobrescribible = existingPago
          ? esDestinoSobrescribible(existingPago.pago)
          : false;
        const pagoIdEnVuelo = destinoSobrescribible
          ? existingPago!.pago.pago_id
          : -1;
        const pagosHermanos = await db
          .select({
            pago_id: pagos_credito.pago_id,
            monto_aplicado: pagos_credito.monto_aplicado,
            abono_capital: pagos_credito.abono_capital,
            abono_interes: pagos_credito.abono_interes,
            abono_iva_12: pagos_credito.abono_iva_12,
            abono_seguro: pagos_credito.abono_seguro,
            abono_gps: pagos_credito.abono_gps,
            membresias_pago: pagos_credito.membresias_pago,
          })
          .from(pagos_credito)
          .where(
            and(
              eq(pagos_credito.cuota_id, cuota.cuotas_credito.cuota_id),
              eq(pagos_credito.credito_id, credito.credito_id),
              eq(pagos_credito.paymentFalse, false),
              ne(pagos_credito.pago_id, pagoIdEnVuelo),
              // Hermanos vivos: validated o pending (sin importar `pagado`).
              // Un pago que cierra la cuota se guarda como pending+pagado=true
              // hasta que contabilidad lo valida; debe contarse igual para no
              // re-aplicar sus rubros.
              or(
                eq(pagos_credito.validationStatus, "validated"),
                eq(pagos_credito.validationStatus, "pending")
              )
            )
          );
        const sumaHermanos = (sel: (p: any) => any) =>
          pagosHermanos.reduce(
            (acc, p) => acc.plus(new Big(sel(p) ?? 0)),
            new Big(0)
          );
        // Lo aplicado a la CUOTA por los hermanos = Σ de sus rubros de cuota
        // (capital+interés+IVA+seguro+GPS+membresías), NO `monto_aplicado`.
        // `monto_aplicado` legacy carga mora/otros (filas de sólo mora traen
        // rubros en 0) y abonos directos a capital; contarlos inflaba el
        // faltante de la cuota → colapsaba `saldoRealCuota` a 0 y disparaba el
        // rechazo falso de "sobre-aplicación". Ver `sumarAplicadoACuota`.
        const aplicadoPrevioCuota = sumarAplicadoACuota(pagosHermanos);
        const interesPrevioCuota = sumaHermanos((p) => p.abono_interes);
        const seguroPrevioCuota = sumaHermanos((p) => p.abono_seguro);
        const gpsPrevioCuota = sumaHermanos((p) => p.abono_gps);
        const membresiasPrevioCuota = sumaHermanos((p) => p.membresias_pago);
        // Interés/IVA: sumar SOLO los hermanos distintos a la fila vigente. La
        // fila ya refleja su propia aplicación; netear contra los OTROS evita
        // re-aplicar interés/IVA si la fila quedó stale, sin sub-cobrar lo que
        // la propia fila ya descontó.
        const pagoSaldoVigenteId = pagoSaldoVigente?.pago.pago_id ?? -1;
        const sumaHermanosOtros = (sel: (p: any) => any) =>
          pagosHermanos.reduce(
            (acc, p) =>
              p.pago_id === pagoSaldoVigenteId
                ? acc
                : acc.plus(new Big(sel(p) ?? 0)),
            new Big(0)
          );
        const interesOtrosHermanos = sumaHermanosOtros((p) => p.abono_interes);
        const ivaOtrosHermanos = sumaHermanosOtros((p) => p.abono_iva_12);
        const saldoNeto = calcularSaldoNetoCuota({
          montoCuota,
          aplicadoPrevioCuota,
          filaInteresRestante: interes_restante,
          filaIvaRestante: iva_restante,
          filaSeguroRestante: seguro_restante,
          filaGpsRestante: gps_restante,
          filaMembresiasRestante: membresias_restante,
          filaCapitalRestante: capital_restante_pago,
          objetivoSeguro: credito.seguro_10_cuotas ?? 0,
          objetivoGps: credito.gps ?? 0,
          objetivoMembresias: credito.membresias_pago ?? 0,
          hermanosSeguro: seguroPrevioCuota,
          hermanosGps: gpsPrevioCuota,
          hermanosMembresias: membresiasPrevioCuota,
          hermanosInteres: interesOtrosHermanos,
          hermanosIva: ivaOtrosHermanos,
        });
        seguro_restante = saldoNeto.seguroRestante;
        gps_restante = saldoNeto.gpsRestante;
        membresias_restante = saldoNeto.membresiasRestante;
        capital_restante_pago = saldoNeto.capitalRestante;

        // Reiniciar todos los abonos
        let abono_interes = new Big(0);
        let abono_iva_12 = new Big(0);
        let abono_seguro = new Big(0);
        let abono_gps = new Big(0);
        let abono_capital = new Big(0);
        let abono_membresias = new Big(0);
        let abono_interes_ci = new Big(0);
        let abono_iva_ci = new Big(0);
        let total_monto_cash_in = new Big(0);
        let total_iva_cash_in = new Big(0);

        console.log(
          "🚀 Procesando pago para la cuota:",
          cuota.cuotas_credito.numero_cuota
        );

        // Sumar totales de inversionistas
        inversionistas.forEach(({ monto_cash_in, iva_cash_in }) => {
          total_monto_cash_in = total_monto_cash_in.plus(monto_cash_in);
          total_iva_cash_in = total_iva_cash_in.plus(iva_cash_in);
        });

        abono_interes_ci = new Big(total_monto_cash_in);
        abono_iva_ci = new Big(total_iva_cash_in);

        // Calcular abonos

        console.log("🔍 ========== INICIO DISTRIBUCIÓN DE PAGO ==========");
        console.log(
          "💰 Monto disponible inicial:",
          disponible_restante.toString()
        );

        // 3.1 Pagar interés
        console.log("\n📌 PASO 1: Pagar Interés");
        console.log("   Interés restante:", interes_restante.toString());
        if (disponible_restante.gt(0) && interes_restante.gt(0)) {
          const pago = disponible_restante.lt(interes_restante)
            ? disponible_restante
            : interes_restante;
          console.log("   ✅ Pago a aplicar:", pago.toString());
          abono_interes = pago;
          disponible_restante = disponible_restante.minus(pago);
          console.log(
            "   💵 Disponible restante:",
            disponible_restante.toString()
          );
        } else {
          console.log("   ⏭️  Saltado (sin saldo o sin deuda)");
        }

        // 3.2 Pagar IVA
        console.log("\n📌 PASO 2: Pagar IVA");
        console.log("   IVA restante:", iva_restante.toString());
        if (disponible_restante.gt(0) && iva_restante.gt(0)) {
          const pago = disponible_restante.lt(iva_restante)
            ? disponible_restante
            : iva_restante;
          console.log("   ✅ Pago a aplicar:", pago.toString());
          abono_iva_12 = pago;
          disponible_restante = disponible_restante.minus(pago);
          console.log(
            "   💵 Disponible restante:",
            disponible_restante.toString()
          );
        } else {
          console.log("   ⏭️  Saltado (sin saldo o sin deuda)");
        }

        // 3.3 Pagar seguro
        console.log("\n📌 PASO 3: Pagar Seguro");
        console.log("   Seguro restante:", seguro_restante.toString());
        if (disponible_restante.gt(0) && seguro_restante.gt(0)) {
          const pago = disponible_restante.lt(seguro_restante)
            ? disponible_restante
            : seguro_restante;
          console.log("   ✅ Pago a aplicar:", pago.toString());
          abono_seguro = pago;
          disponible_restante = disponible_restante.minus(pago);
          console.log(
            "   💵 Disponible restante:",
            disponible_restante.toString()
          );
        } else {
          console.log("   ⏭️  Saltado (sin saldo o sin deuda)");
        }

        // 3.4 Pagar GPS
        console.log("\n📌 PASO 4: Pagar GPS");
        console.log("   GPS restante:", gps_restante.toString());
        if (disponible_restante.gt(0) && gps_restante.gt(0)) {
          const pago = disponible_restante.lt(gps_restante)
            ? disponible_restante
            : gps_restante;
          console.log("   ✅ Pago a aplicar:", pago.toString());
          abono_gps = pago;
          disponible_restante = disponible_restante.minus(pago);
          console.log(
            "   💵 Disponible restante:",
            disponible_restante.toString()
          );
        } else {
          console.log("   ⏭️  Saltado (sin saldo o sin deuda)");
        }

        // 3.5 Pagar membresías
        console.log("\n📌 PASO 5: Pagar Membresías");
        console.log("   Membresías restante:", membresias_restante.toString());
        if (disponible_restante.gt(0) && membresias_restante.gt(0)) {
          const pago = disponible_restante.lt(membresias_restante)
            ? disponible_restante
            : membresias_restante;
          console.log("   ✅ Pago a aplicar:", pago.toString());
          abono_membresias = pago;
          disponible_restante = disponible_restante.minus(pago);
          console.log(
            "   💵 Disponible restante:",
            disponible_restante.toString()
          );
        } else {
          console.log("   ⏭️  Saltado (sin saldo o sin deuda)");
        }

        // 3.6 Pagar capital
        console.log("\n📌 PASO 6: Pagar Capital");
        console.log("   Capital restante:", capital_restante_pago.toString());
        if (disponible_restante.gt(0) && capital_restante_pago.gt(0)) {
          const pago = disponible_restante.lt(capital_restante_pago)
            ? disponible_restante
            : capital_restante_pago;
          console.log("   ✅ Pago a aplicar:", pago.toString());
          abono_capital = pago;
          disponible_restante = disponible_restante.minus(pago);
          console.log(
            "   💵 Disponible restante:",
            disponible_restante.toString()
          );
        } else {
          console.log("   ⏭️  Saltado (sin saldo o sin deuda)");
        }

        console.log("\n🔍 ========== RESUMEN DE ABONOS ==========");
        console.log("💵 Abono Interés:", abono_interes.toString());
        console.log("💵 Abono IVA 12%:", abono_iva_12.toString());
        console.log("💵 Abono Seguro:", abono_seguro.toString());
        console.log("💵 Abono GPS:", abono_gps.toString());
        console.log("💵 Abono Membresías:", abono_membresias.toString());
        console.log("💵 Abono Capital:", abono_capital.toString());
        console.log("💰 Sobrante sin aplicar:", disponible_restante.toString());

        // 4. CALCULAR NUEVOS RESTANTES
        console.log("\n🔍 ========== CALCULANDO NUEVOS RESTANTES ==========");
        const nuevo_interes_restante = interes_restante.minus(abono_interes);
        const nuevo_iva_restante = iva_restante.minus(abono_iva_12);
        const nuevo_seguro_restante = seguro_restante.minus(abono_seguro);
        const nuevo_gps_restante = gps_restante.minus(abono_gps);
        const nuevo_membresias_restante =
          membresias_restante.minus(abono_membresias);
        const nuevo_capital_restante =
          capital_restante_pago.minus(abono_capital);

        console.log(
          "📊 Nuevo Interés Restante:",
          nuevo_interes_restante.toString()
        );
        console.log("📊 Nuevo IVA Restante:", nuevo_iva_restante.toString());
        console.log(
          "📊 Nuevo Seguro Restante:",
          nuevo_seguro_restante.toString()
        );
        console.log("📊 Nuevo GPS Restante:", nuevo_gps_restante.toString());
        console.log(
          "📊 Nuevo Membresías Restante:",
          nuevo_membresias_restante.toString()
        );
        console.log(
          "📊 Nuevo Capital Restante:",
          nuevo_capital_restante.toString()
        );

        // Obtener pago del mes
        console.log("\n🔍 ========== CALCULANDO PAGO DEL MES ==========");
        const pago_del_mes = await getPagosDelMesActual(credito.credito_id);
        console.log("💰 Pago del mes actual (DB):", pago_del_mes);
        console.log("💵 Monto boleta actual:", montoBoleta);

        const pago_del_mesBig = new Big(pago_del_mes ?? 0).add(
          montoBoleta ?? 0
        );
        console.log("💵 Pago del mes TOTAL:", pago_del_mesBig.toString());
        console.log("🔍 ========== FIN ==========\n");
        const todosRestantesEnCero =
          nuevo_interes_restante.eq(0) &&
          nuevo_iva_restante.eq(0) &&
          nuevo_seguro_restante.eq(0) &&
          nuevo_gps_restante.eq(0) &&
          nuevo_membresias_restante.eq(0) &&
          nuevo_capital_restante.eq(0);
        let totalPagado = abono_capital
          .plus(abono_interes)
          .plus(abono_iva_12)
          .plus(abono_seguro)
          .plus(abono_gps)
          .plus(abono_membresias);
        const esPrimeraCuotaProcesada =
          cuotas_completas === 0 && cuotas_parciales === 0;
        const pagoExactoDeUnaCuota = montoEfectivo.eq(montoCuota);
        const faltanteContraCuota = montoCuota.minus(totalPagado);

        if (
          shouldApplyStaleZeroRestanteAdjustment({
            hasExistingPayment: !!existingPago,
            isFirstProcessedInstallment: esPrimeraCuotaProcesada,
            isExactSingleInstallmentPayment: pagoExactoDeUnaCuota,
            hasValidatedPayments: tienePagosValidados,
            hasLastPartialPaymentWithRemaining: !!ultimoPagoParcialConRestante,
            allRemainingZero: todosRestantesEnCero,
            missingAgainstInstallment: faltanteContraCuota,
            availableRemaining: disponible_restante,
          })
        ) {
          console.log(
            "⚠️ Restantes de cuota subestimados; reteniendo ajuste neutro en la cuota seleccionada:",
            {
              cuota: cuota.cuotas_credito.numero_cuota,
              faltanteContraCuota: faltanteContraCuota.toString(),
              disponibleRestante: disponible_restante.toString(),
            }
          );
          totalPagado = totalPagado.plus(faltanteContraCuota);
          disponible_restante = disponible_restante.minus(faltanteContraCuota);
        }

        // ─────────────────────────────────────────────────────────────────
        // 🛡️ RED DE SEGURIDAD ANTI-SOBREAPLICACIÓN
        //
        // Tras el clamp por saldo NETO de arriba (que netea rubros contra los
        // pagos hermanos y topa el capital al faltante real), esto ya no
        // debería dispararse en operación normal. Se mantiene como aserción
        // dura: la suma aplicada a una cuota nunca puede superar su monto.
        // Reusa `aplicadoPrevioCuota`/`interesPrevioCuota`/`TOLERANCIA_CENTAVO`
        // calculados antes de distribuir (netos de los hermanos vivos).
        // ─────────────────────────────────────────────────────────────────
        const totalProyectadoCuota = aplicadoPrevioCuota.plus(totalPagado);

        if (totalProyectadoCuota.gt(montoCuota.plus(TOLERANCIA_CENTAVO))) {
          throw new Error(
            `Pago rechazado: la cuota #${cuota.cuotas_credito.numero_cuota} quedaría ` +
              `sobre-aplicada (${totalProyectadoCuota.toFixed(2)} > monto de cuota ` +
              `${montoCuota.toFixed(2)}). Ya aplicado por otros pagos: ` +
              `${aplicadoPrevioCuota.toFixed(2)} (de los cuales interés ` +
              `${interesPrevioCuota.toFixed(2)}); este pago intentaría aplicar ` +
              `${totalPagado.toFixed(2)} más. Revisar los pagos previos de la cuota ` +
              `antes de registrar.`
          );
        }

        // Solo marcar como pagada si los restantes están en 0 Y existía un pago previo
        // (evita marcar como pagada cuando no hay pago existente y los restantes son 0 por default)
        const cuota_pagada = shouldMarkInstallmentPaymentPaid({
          allRemainingZero: todosRestantesEnCero,
          hasExistingInstallmentPayment: !!existingPago,
          installmentAmountApplied: totalPagado.toString(),
        });
        // Preparar datos del pago
        const currentDate = new Date();
        const months = [
          "Enero",
          "Febrero",
          "Marzo",
          "Abril",
          "Mayo",
          "Junio",
          "Julio",
          "Agosto",
          "Septiembre",
          "Octubre",
          "Noviembre",
          "Diciembre",
        ];
        const mes_pagado = months[currentDate.getMonth()];
        const paymentFalse = existingPago
          ? existingPago.pago.paymentFalse
          : false;
        const guatemalaTimeString = new Date().toLocaleString("en-US", {
          timeZone: "America/Guatemala",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });

        // Convertir "11/22/2025, 17:07:09" a Date object
        const [datePart, timePart] = guatemalaTimeString.split(", ");
        const [month, day, year] = datePart.split("/");
        const fechaGuatemala = new Date(`${year}-${month}-${day}T${timePart}`);

        // Mora y otros solo van en la primera cuota (si ya hubo completas antes, no se repiten)
        const esPrimeraCuota = cuotas_completas === 0 && cuotas_parciales === 0;
        const moraParaPago = esPrimeraCuota ? moraBig : new Big(0);
        const otrosParaPago = esPrimeraCuota ? otrosBig : new Big(0);

        const pagoData = {
          credito_id: credito.credito_id,
          cuota: credito.cuota,
          cuota_interes: credito.cuota_interes,
          abono_capital: abono_capital.toString(),
          abono_interes: abono_interes.toString(),
          abono_iva_12: abono_iva_12.toString(),
          abono_interes_ci: abono_interes_ci.toString(),
          abono_iva_ci: abono_iva_ci.toString(),
          abono_seguro: abono_seguro.toString(),
          abono_gps: abono_gps.toString(),
          pago_del_mes: pago_del_mesBig.toString(),
          monto_boleta: montoBoleta.toString(),
          capital_restante: nuevo_capital_restante.toString(),
          interes_restante: nuevo_interes_restante.toString(),
          iva_12_restante: nuevo_iva_restante.toString(),
          seguro_restante: nuevo_seguro_restante.toString(),
          gps_restante: nuevo_gps_restante.toString(),
          numero_cuota: cuota.cuotas_credito.numero_cuota,
          llamada: llamada,
          fecha_pago: fechaGuatemala,
          renuevo_o_nuevo: renuevo_o_nuevo,
          tipoCredito: "Renuevo",
          membresias: nuevo_membresias_restante.toString(),
          membresias_pago: abono_membresias.toString(),
          membresias_mes: abono_membresias.toString(),
          otros: otrosParaPago.toString(),
          mora: moraParaPago.toString(),
          monto_boleta_cuota: montoBoleta.toString(),
          seguro_total: credito.seguro_10_cuotas?.toString() ?? "0",
          pagado: cuota_pagada,
          facturacion: "si",
          mes_pagado,
          seguro_facturado: abono_seguro.toString() ?? "0",
          gps_facturado: abono_gps.toString() ?? "0",
          reserva: "0",
          observaciones: observaciones,
          validate: false,
          validationStatus: "pending" as const,
          paymentFalse: paymentFalse,
          numeroAutorizacion: numeroAutorizacion,
          banco_id: banco_id,
          registerBy: registerBy,
          fecha_boleta: fecha_boleta,
          monto_aplicado: totalPagado.toString(),
          origen_pago: origen_pago,
        };

        // Insertar o actualizar pago
        type PagoCredito = typeof pagos_credito.$inferSelect;
        let pagoInsertado: PagoCredito | undefined;

        if (existingPago) {
          if (
            urlCompletas &&
            urlCompletas.length > 0 &&
            pagoInsertado?.pago_id
          ) {
          }
          console.log("cuota_id:", cuota);
          console.log("pagoInsertado:", pagoData);
          if (pagoData) {
            if (pagoData.pagado && destinoSobrescribible) {
              // ── CIERRE sobre fila DESECHABLE (UPDATE) ──────────────────────
              // `existingPago` es el placeholder `no_required` o una fila vacía:
              // pisarla con el pago de cierre no destruye plata. Comportamiento
              // histórico para el caso normal.
              cuotas_completas++;
              console.log(
                `✅ Cuota ${cuota.cuotas_credito.numero_cuota} PAGADA COMPLETAMENTE`
              );
              [pagoInsertado] = await db
                .update(pagos_credito)
                .set(pagoData)
                .from(cuotas_credito)
                .where(
                  and(
                    eq(
                      cuotas_credito.cuota_id,
                      cuota.cuotas_credito.cuota_id
                    ),
                    eq(pagos_credito.pago_id, existingPago.pago.pago_id),
                    eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
                  )
                )
                .returning();
              await db
                .update(pagos_credito)
                .set({ pagado: true })
                .where(
                  eq(pagos_credito.cuota_id, cuota.cuotas_credito.cuota_id)
                );

              if (
                pagoInsertado?.pago_id &&
                urlCompletas &&
                urlCompletas.length > 0
              ) {
                await db.insert(boletas).values(
                  urlCompletas.map((url) => ({
                    pago_id: pagoInsertado!.pago_id,
                    url_boleta: url,
                  }))
                );
              }


            } else if (pagoData.pagado) {
              // ── CIERRE sin fila desechable (INSERT de fila de cierre) ──────
              // El placeholder `no_required` ya fue consumido por un parcial
              // previo, así que `existingPago` cayó al fallback = una fila REAL
              // (con interés/IVA ya validado, posiblemente facturado).
              // Sobrescribirla destruiría ese pago (caso crédito 217 / cuota 8).
              // En su lugar INSERTAMOS una fila nueva de cierre (igual que un
              // parcial pero `pagado: true` y restantes en 0). El UPDATE masivo
              // de abajo marca toda la cuota como pagada.
              cuotas_completas++;
              console.log(
                `✅ Cuota ${cuota.cuotas_credito.numero_cuota} PAGADA COMPLETAMENTE (fila de cierre NUEVA: el destino existente es un pago real y no se sobrescribe)`
              );

              const guatemalaTimeString = new Date().toLocaleString("en-US", {
                timeZone: "America/Guatemala",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              });
              const [datePart, timePart] = guatemalaTimeString.split(", ");
              const [month, day, year] = datePart.split("/");
              const fechaGuatemala = new Date(
                `${year}-${month}-${day}T${timePart}`
              );

              [pagoInsertado] = await db
                .insert(pagos_credito)
                .values({
                  // Campos requeridos del input
                  cuota_id: cuota.cuotas_credito.cuota_id,
                  renuevo_o_nuevo: pagoData.renuevo_o_nuevo,
                  credito_id: pagoData.credito_id,
                  // Campos que vienen del crédito/cuota
                  cuota: credito.cuota,
                  cuota_interes: credito.cuota_interes,
                  fecha_pago: fechaGuatemala,
                  fecha_vencimiento: cuota.cuotas_credito.fecha_vencimiento
                    ? new Date(
                        cuota.cuotas_credito.fecha_vencimiento
                      ).toISOString()
                    : undefined,

                  // Abonos (calculados según lógica de distribución)
                  abono_capital: pagoData.abono_capital,
                  abono_interes: pagoData.abono_interes,
                  abono_iva_12: pagoData.abono_iva_12,
                  abono_interes_ci: pagoData.abono_interes_ci,
                  abono_iva_ci: pagoData.abono_iva_ci,
                  abono_seguro: pagoData.abono_seguro,
                  abono_gps: pagoData.abono_gps,
                  pago_del_mes: pagoData.pago_del_mes,

                  // Restantes en 0: esta fila cierra la cuota.
                  capital_restante: "0",
                  interes_restante: "0",
                  iva_12_restante: "0",
                  seguro_restante: "0",
                  gps_restante: "0",
                  total_restante:
                    pagoSaldoVigente?.pago.total_restante ??
                    credito.capital ??
                    "0",

                  // Membresías
                  membresias: "0",
                  membresias_pago: pagoData.membresias_pago,
                  membresias_mes: pagoData.membresias_mes,

                  // Campos adicionales del input
                  llamada: pagoData.llamada || "",
                  otros: pagoData.otros,
                  mora: pagoData.mora,
                  monto_boleta_cuota: montoBoleta.toString(),
                  monto_boleta: montoBoleta.toString(),
                  observaciones: pagoData.observaciones,

                  // Seguros y GPS
                  seguro_total: pagoData.seguro_total,
                  seguro_facturado: pagoData.seguro_facturado,
                  gps_facturado: pagoData.gps_facturado,
                  reserva: pagoData.reserva,

                  // Campos de estado: fila de cierre (pagado:true, pending hasta
                  // que contabilidad valida).
                  pagado: true,
                  facturacion: pagoData.facturacion || "si",
                  mes_pagado: pagoData.mes_pagado,
                  paymentFalse: pagoData.paymentFalse || false,
                  validationStatus: "pending",
                  banco_id: pagoData.banco_id || null,
                  numeroAutorizacion: pagoData.numeroAutorizacion || null,
                  registerBy: pagoData.registerBy,
                  pagoConvenio: montoConvenio.toString() || "0",
                  fecha_boleta: pagoData.fecha_boleta,
                  monto_aplicado: pagoData.monto_aplicado,
                  // Paridad con la rama UPDATE de cierre (que persiste pagoData
                  // completo): conservar el origen del pago en la fila de cierre.
                  origen_pago: pagoData.origen_pago,
                })
                .returning();

              // Marcar TODA la cuota como pagada (igual que la rama UPDATE).
              await db
                .update(pagos_credito)
                .set({ pagado: true })
                .where(
                  eq(pagos_credito.cuota_id, cuota.cuotas_credito.cuota_id)
                );

              if (
                pagoInsertado?.pago_id &&
                urlCompletas &&
                urlCompletas.length > 0
              ) {
                await db.insert(boletas).values(
                  urlCompletas.map((url) => ({
                    pago_id: pagoInsertado!.pago_id,
                    url_boleta: url,
                  }))
                );
              }
            } else {
              disponible_para_cuotasPosteriores =
                disponible_para_cuotasPosteriores.plus(disponible);

              cuotas_parciales++;
              const guatemalaTimeString = new Date().toLocaleString("en-US", {
                timeZone: "America/Guatemala",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              });

              // Convertir "11/22/2025, 17:07:09" a Date object
              const [datePart, timePart] = guatemalaTimeString.split(", ");
              const [month, day, year] = datePart.split("/");
              const fechaGuatemala = new Date(
                `${year}-${month}-${day}T${timePart}`
              );

              console.log(
                `⚠️ Cuota ${cuota.cuotas_credito.numero_cuota} con PAGO PARCIAL`
              );

              [pagoInsertado] = await db
                .insert(pagos_credito)
                .values({
                  // Campos requeridos del input
                  cuota_id: cuota.cuotas_credito.cuota_id, 
                  renuevo_o_nuevo: pagoData.renuevo_o_nuevo,
                  credito_id: pagoData.credito_id,
                  // Campos que vienen del crédito/cuota
                  cuota: credito.cuota,
                  cuota_interes: credito.cuota_interes,
                  fecha_pago: fechaGuatemala,
                  fecha_vencimiento: cuota.cuotas_credito.fecha_vencimiento ? new Date(cuota.cuotas_credito.fecha_vencimiento).toISOString() : undefined,
                  

                  // Abonos (calculados según lógica de si monto_boleta == cuota)
                  abono_capital: pagoData.abono_capital,
                  abono_interes: pagoData.abono_interes,
                  abono_iva_12: pagoData.abono_iva_12,
                  abono_interes_ci: pagoData.abono_interes_ci,
                  abono_iva_ci: pagoData.abono_iva_ci,
                  abono_seguro: pagoData.abono_seguro,
                  abono_gps: pagoData.abono_gps,
                  pago_del_mes: pagoData.pago_del_mes,

                  // Restantes (calculados)
                  capital_restante: pagoData.capital_restante,
                  interes_restante: pagoData.interes_restante,
                  iva_12_restante: pagoData.iva_12_restante,
                  seguro_restante: pagoData.seguro_restante,
                  gps_restante: pagoData.gps_restante,
                  // total_restante: hereda el del hermano (saldo vigente de la
                  // cuota). Fallback a credito.capital para no propagar NULL si
                  // el hermano vino vacío. El parcial no mueve capital, así que
                  // este es el saldo del crédito vigente al momento del pago.
                  total_restante:
                    pagoSaldoVigente?.pago.total_restante ??
                    credito.capital ??
                    "0",

                  // Membresías
                  membresias: pagoData.membresias,
                  membresias_pago: pagoData.membresias_pago,
                  membresias_mes: pagoData.membresias_mes,

                  // Campos adicionales del input
                  llamada: pagoData.llamada || "",
                  otros: pagoData.otros,
                  mora: pagoData.mora,
                  monto_boleta_cuota: montoBoleta.toString(),
                  monto_boleta: montoBoleta.toString(),
                  observaciones: pagoData.observaciones,

                  // Seguros y GPS
                  seguro_total: pagoData.seguro_total,
                  seguro_facturado: pagoData.seguro_facturado,
                  gps_facturado: pagoData.gps_facturado,
                  reserva: pagoData.reserva,

                  // Campos de estado
                  pagado: false,
                  facturacion: pagoData.facturacion || "si",
                  mes_pagado: pagoData.mes_pagado,
                  paymentFalse: pagoData.paymentFalse || false,
                  validationStatus: pagoData.validationStatus || "pending",
                  banco_id: pagoData.banco_id || null,
                  numeroAutorizacion: pagoData.numeroAutorizacion || null,
                  registerBy: pagoData.registerBy,
                  pagoConvenio: montoConvenio.toString() || "0",
                  fecha_boleta:pagoData.fecha_boleta,
                  monto_aplicado: pagoData.monto_aplicado,
                })
                .returning();
              console.log("pagoInsertado cuota parcial:", pagoInsertado);
              if (
                pagoInsertado?.pago_id &&
                urlCompletas &&
                urlCompletas.length > 0
              ) {
                await db.insert(boletas).values(
                  urlCompletas.map((url) => ({
                    pago_id: pagoInsertado!.pago_id,
                    url_boleta: url,
                  }))
                );
              }

              
            }
          }

          // ── Sincronizar `*_restante` en TODAS las filas vivas de la cuota ──
          // Antes los `*_restante` se guardaban por fila (snapshot del momento)
          // y se desincronizaban entre pagos hermanos: la fila `no_required` y
          // las intermedias quedaban con saldos viejos, así que el front (que
          // puede leer cualquier fila, ej. la `no_required`) mostraba restantes
          // que NO reflejaban los parciales ya aplicados. Replicamos el saldo
          // VIVO recién calculado (`nuevo_*_restante`) a todas las filas de la
          // cuota → `*_restante` pasa a ser un valor consistente por cuota,
          // leíble desde cualquier fila. No cambia la distribución: interés/IVA
          // se distribuyen con la fila vigente (la última, que ya trae el saldo
          // correcto) y los rubros planos se netean contra objetivos+Σmonto_
          // aplicado, no contra estos saldos.
          await db
            .update(pagos_credito)
            .set({
              capital_restante: nuevo_capital_restante.toString(),
              interes_restante: nuevo_interes_restante.toString(),
              iva_12_restante: nuevo_iva_restante.toString(),
              seguro_restante: nuevo_seguro_restante.toString(),
              gps_restante: nuevo_gps_restante.toString(),
              membresias: nuevo_membresias_restante.toString(),
            })
            .where(
              and(
                eq(pagos_credito.cuota_id, cuota.cuotas_credito.cuota_id),
                eq(pagos_credito.credito_id, credito.credito_id),
                eq(pagos_credito.paymentFalse, false)
              )
            );

          if (disponible_restante.lte(0)) {
            break;
          }
          // Si el sobrante es <= Q25, agregarlo como "otros" al pago actual y no continuar
          if (disponible_restante.lte(25) && pagoInsertado?.pago_id) {
            const otrosActual = new Big(pagoInsertado.otros ?? "0");
            await db
              .update(pagos_credito)
              .set({
                otros: otrosActual.plus(disponible_restante).toString(),
                monto_aplicado: new Big(pagoInsertado.monto_aplicado ?? "0").plus(disponible_restante).toString(),
              })
              .where(eq(pagos_credito.pago_id, pagoInsertado.pago_id));
            disponible_restante = new Big(0);
            break;
          }
        }
      }

      // 7. Procesar abono directo a capital (si aplica)
    }
    // Jalar la última cuota pagada
    const hoy = new Date().toISOString().slice(0, 10);
    const [ultimaCuotaPagada] = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
      })
      .from(cuotas_credito)
      .innerJoin(pagos_credito, eq(pagos_credito.cuota_id, cuotas_credito.cuota_id))
      .where(
        and(
          eq(cuotas_credito.credito_id, credito_id),
          gt(cuotas_credito.numero_cuota, 0), 
          eq(pagos_credito.pagado, true)
        )
      )
      .orderBy(desc(cuotas_credito.numero_cuota))
      .limit(1);

    const abonoCapital = new Big(abono_directo_capital ?? 0);
    // Si el crédito permite abono a capital, se salta la validación de estar al día
    const permiteAbonoCapital = credito.permite_abono_capital === true;
    const fechaVenc = ultimaCuotaPagada?.fecha_vencimiento ?? null;
    const estaAlDia = ultimaCuotaPagada && fechaVenc && fechaVenc >= hoy;

    if ((estaAlDia || permiteAbonoCapital) && abonoCapital.gt(0)) {
      console.log("\n💰 ========== ABONO DIRECTO A CAPITAL ==========");
      console.log(`💵 Monto: Q${abonoCapital.toString()}`);

      // 1️⃣ Preparar datos del pago
      const currentDate = new Date();
      const months = [
        "Enero",
        "Febrero",
        "Marzo",
        "Abril",
        "Mayo",
        "Junio",
        "Julio",
        "Agosto",
        "Septiembre",
        "Octubre",
        "Noviembre",
        "Diciembre",
      ];
      const mes_pagado = months[currentDate.getMonth()];
      const guatemalaTime = new Date(
        new Date().toLocaleString("en-US", {
          timeZone: "America/Guatemala",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );

      const monthPaymentsBig = new Big(
        (await getPagosDelMesActual(credito_id)) ?? 0
      ).plus(abonoCapital);
      const cuotaReferencia =
        ultimaCuotaPagada ?? cuotasPendientes[0]?.cuotas_credito;

      if (!cuotaReferencia?.cuota_id) {
        throw new Error(
          "No se encontró una cuota existente para enlazar el abono directo a capital"
        );
      }

      const guatemalaTimeString = new Date().toLocaleString("en-US", {
        timeZone: "America/Guatemala",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });

      // Convertir "11/22/2025, 17:07:09" a Date object
      const [datePart, timePart] = guatemalaTimeString.split(", ");
      const [month, day, year] = datePart.split("/");
      const fechaGuatemala = new Date(`${year}-${month}-${day}T${timePart}`);
      const pagoData = {
        credito_id,
        cuota: credito.cuota,
        cuota_interes: credito.cuota_interes?.toString() ?? "0",

        // 🎯 ABONO A CAPITAL - solo abono_capital tiene valor
        abono_capital: abonoCapital.toString(),
        abono_interes: "0",
        abono_iva_12: "0",
        abono_interes_ci: "0",
        abono_iva_ci: "0",
        abono_seguro: "0",
        abono_gps: "0",

        pago_del_mes: monthPaymentsBig.toString(),
        monto_boleta: abonoCapital.toString(),

        // Restantes - valores del crédito actual (SIN cambiar nada)
        capital_restante: credito.capital,
        interes_restante: "0",
        iva_12_restante: "0",
        seguro_restante: "0",
        gps_restante: "0",
        total_restante: "0",

        cuota_id: cuotaReferencia.cuota_id,
        numero_cuota: 0,
        llamada: llamada ?? "",
        fecha_pago: fechaGuatemala,
        renuevo_o_nuevo: renuevo_o_nuevo ?? "Renuevo",
        tipoCredito: "Renuevo",

        membresias: credito.membresias?.toString() ?? "0",
        membresias_pago: "0",
        membresias_mes: "0",

        otros: otros?.toString() ?? "0",
        mora: moraBig?.toString() ?? "0",
        monto_boleta_cuota: abonoCapital.toString(),
        seguro_total: credito.seguro_10_cuotas?.toString() ?? "0",

        // 🔥 Marcar como PAGADO
        pagado: true,
        facturacion: "si",
        mes_pagado,

        seguro_facturado: "0",
        gps_facturado: "0",
        reserva: "0",
        observaciones: observaciones ?? "Abono directo a capital",

        // 🔥 Pendiente de validación
        validate: false,
        validationStatus: "capital" as const,
        paymentFalse: false,
        registerBy: registerBy,
        pagoConvenio: montoConvenio.toString() || "0",
        fecha_boleta: fecha_boleta,
        monto_aplicado: abonoCapital.toString(),
        origen_pago: origen_pago,
      };

      console.log("\n📝 ========== REGISTRANDO PAGO ==========");

      // 2️⃣ Registrar el pago
      const [pagoInsertado] = await db
        .insert(pagos_credito)
        .values(pagoData)
        .returning();

      console.log(`✅ Pago registrado: ID ${pagoInsertado.pago_id}`);

      // 3️⃣ Insertar boletas si existen
      if (urlCompletas && urlCompletas.length > 0) {
        console.log(`\n📄 Insertando ${urlCompletas.length} boletas...`);

        await db.insert(boletas).values(
          urlCompletas.map((url) => ({
            pago_id: pagoInsertado.pago_id,
            url_boleta: url,
          }))
        );

        console.log(`✅ Boletas insertadas`);
      }

      console.log("\n✅ ========== ABONO A CAPITAL REGISTRADO ==========");
      console.log(
        "⏳ Pendiente de validación para distribuir entre inversionistas\n"
      );

      // 4️⃣ Retornar resultado
      return {
        success: true,
        message:
          "Abono directo a capital registrado exitosamente (pendiente de validación)",
        pago: {
          pago_id: pagoInsertado.pago_id,
          abono_capital: abonoCapital.toString(),
          fecha_pago,
          pagado: true,
          validationStatus: "pending",
        },
      };
    } else {
      const newSaldoAFavor = saldoAFavor.plus(disponible_restante);
      await db
        .update(usuarios)
        .set({ saldo_a_favor: newSaldoAFavor.toString() })
        .where(eq(usuarios.usuario_id, credito.usuario_id));

      console.log(
        `✅ Saldo a favor del usuario quedó en $${newSaldoAFavor.toString()}`
      );
      console.log("✅ Pago realizado con éxito");

      const montoTotal = montoBoleta.toString();

      return {
        success: true,
        message: "Pago realizado exitosamente",
        detalle: {
          cuotas_pagadas_completas: cuotas_completas,
          cuotas_pagadas_parciales: cuotas_parciales,
          monto_aplicado: montoTotal,
          saldo_sobrante: "0.00",
        },
        resumen: `Se procesaron   cuota(s): ${cuotas_completas} pagada(s) completamente y ${cuotas_parciales} con pago parcial. Monto total aplicado: Q${montoTotal}. Ya no queda saldo disponible.`,
      };
    }
  } catch (error) {
    console.error("[insertPayment] Error:", error);
    set.status = 500;
    return {
      message: "Internal server error",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // 🔓 Liberar el advisory lock y devolver la conexión al pool, pase lo que pase.
    if (lockConn) {
      try {
        if (lockedCreditoId !== undefined) {
          await lockConn.query("SELECT pg_advisory_unlock($1, $2)", [
            PAGO_LOCK_NS,
            lockedCreditoId,
          ]);
        }
      } catch (unlockError) {
        console.error("[insertPayment] Error liberando lock:", unlockError);
      } finally {
        lockConn.release();
      }
    }
  }
};
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

// Interfaz para los parámetros
interface InsertarPagoParams {
  numero_credito_sifco: string;
  numero_cuota: number;
  cuotaId: number;
  mora: number;
  otros: number;
  boleta: number;
  urlBoletas: string[];
  pagado: boolean;
  banco_id: number;
  numeroAutorizacion: string;
  registerBy: string;
  fecha_boleta?: string;
  monto_aplicado: number;
}
export async function insertarPago({
  numero_credito_sifco,
  numero_cuota,
  cuotaId,
  mora,
  otros,
  boleta,
  urlBoletas = [],
  pagado = true,
  banco_id,
  numeroAutorizacion,
  registerBy,
  fecha_boleta,
  monto_aplicado
}: InsertarPagoParams) {
  console.log(
    `Insertando pago para crédito SIFCO: ${numero_credito_sifco}, cuota: ${numero_cuota}, mora: ${mora}, otros: ${otros}`
  );

  // 🔥 Query único optimizado: Crédito + Pagos + Usuario en 1 hit
  const [creditData] = await db
    .select({
      // 📋 Datos del crédito
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      usuario_id: creditos.usuario_id,
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      gps: creditos.gps,
      iva_12: creditos.iva_12,
      deudatotal: creditos.deudatotal,

      // 👤 Datos del usuario
      usuario_nombre: usuarios.nombre,
      usuario_categoria: usuarios.categoria,
      usuario_nit: usuarios.nit,

      // 💳 Datos del pago (pueden ser null si no hay pagos previos)
      pago_id: pagos_credito.pago_id,
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
      fecha_boleta: pagos_credito.fecha_boleta,
    })
    .from(creditos)
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .leftJoin(
      pagos_credito,
      and(
        eq(pagos_credito.credito_id, creditos.credito_id),
        cuotaId ? eq(pagos_credito.cuota_id, cuotaId) : undefined
      )
    )
    .leftJoin(
      cuotas_credito,
      eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
    )
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
    .orderBy(pagos_credito.pago_id);

  // ❌ Validación: Crédito no encontrado
  if (!creditData || !creditData.credito_id) {
    throw new Error("No existe el crédito con ese número SIFCO.");
  }

  if (creditData.credito_id == null) {
    throw new Error("El crédito no tiene un ID válido.");
  }

  // 💰 Calcular pagos del mes actual
  const monthPayments = await getPagosDelMesActual(creditData.credito_id);
  const monthPaymentsBig = new Big(monthPayments ?? 0).add(boleta ?? 0);

  // 💾 Insertar nuevo pago
  const [nuevoPago] = await db
    .insert(pagos_credito)
    .values({
      credito_id: creditData.credito_id,
      cuota_id: getCuotaIdForPaymentInsert(creditData.cuota_id),
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

      capital_restante: "0",
      interes_restante: "0",
      iva_12_restante: "0",
      seguro_restante: "0",
      gps_restante: "0",
      total_restante: "0",

      llamada: "",

      renuevo_o_nuevo: "renuevo",

      membresias: "0",
      membresias_pago: "0",
      membresias_mes: "0",
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
      validationStatus: "pending",
      fecha_boleta: fecha_boleta,
      banco_id: banco_id ?? undefined,
      numeroAutorizacion: numeroAutorizacion ?? "",
      registerBy: registerBy,
      pagoConvenio: "0",
      monto_aplicado: monto_aplicado.toString(),
    })
    .returning();

  // 📎 Insertar boletas si existen
  if (urlBoletas && urlBoletas.length > 0) {
    await db.insert(boletas).values(
      urlBoletas.map((url) => ({
        pago_id: nuevoPago?.pago_id,
        url_boleta: url,
      }))
    );
  }

  return nuevoPago;
}

/**
 * Aplica los abonos de un pago al crédito
 * - Si pagado = false: Solo actualiza el pago para validarlo
 * - Si pagado = true: Aplica los abonos al crédito
 * @param pago_id - ID del pago a aplicar
 */
export async function aplicarPagoAlCredito(pago_id: number) {
  try {
    console.log("🔄 Iniciando aplicación de pago al crédito:", pago_id);

    // 1. OBTENER EL PAGO CON TODOS SUS ABONOS
    const [pago] = await db
      .select()
      .from(pagos_credito)
      .where(eq(pagos_credito.pago_id, pago_id))
      .limit(1);

    if (!pago) {
      throw new Error(`Pago ${pago_id} no encontrado`);
    }
    if (pago.validationStatus === "capital") {
      return applyCapitalPaymentAndBuildResponse(
        pago,
        pago_id,
        aplicarAbonoCapitalInversionistas
      );
    }
    if (pago.validationStatus === "reset") {
      if (pago.credito_id === null) {
        throw new Error("No se puede aplicar el abono: credito_id es null");
      }
      console.log("credito cancelado correctamente ");
      db.update(pagos_credito)
        .set({ validationStatus: "validated" })
        .where(eq(pagos_credito.pago_id, pago_id));
      return {
        success: true,
        applied: false,
        message: "Pago validado, crédito cancelado correctamente",
      };
    }

    if (
      shouldRejectZeroAppliedNormalValidation({
        validationStatus: pago.validationStatus,
        nextValidationStatus: "validated",
        montoAplicado: pago.monto_aplicado,
        mora: pago.mora,
        otros: pago.otros,
        pagoConvenio: pago.pagoConvenio,
      })
    ) {
      return {
        success: false,
        applied: false,
        message: `No se puede validar el pago ${pago_id}: monto_aplicado es 0.00`,
      };
    }

    // 2. CARGAR EL CRÉDITO
    // (lo necesitamos tanto para evaluar si la cuota cierra como para
    // actualizar capital/deuda en ambas ramas).
    if (pago.credito_id === null) {
      throw new Error("No se puede aplicar el pago: credito_id es null");
    }
    const [credito] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, pago.credito_id))
      .limit(1);
    if (!credito) {
      throw new Error(`Crédito ${pago.credito_id} no encontrado`);
    }

    // 3. ¿LA CUOTA QUEDA COMPLETAMENTE PAGADA CON ESTE PAGO?
    //
    // El criterio viejo miraba los `*_restante` fila por fila ("¿algún
    // pago de la cuota tiene restantes?"). Eso falla cuando un pago
    // "complementario" cubre el faltante de otro pago anterior: el
    // complementario no decrementa los `*_restante` del pago original,
    // así que la cuota nunca se cerraba aunque ya estuviera cobrada
    // completa (bug observable, ej: crédito 01010214116210 cuota 12).
    //
    // Criterio nuevo: comparar la SUMA de `monto_aplicado` de los pagos
    // ya validated de la cuota (más el monto_aplicado de este pago, que
    // está por validarse) contra el monto total de cuota del crédito.
    // Si la suma cubre lo esperado, la cuota se cierra. Es robusto
    // frente a pagos partidos en N rows y no depende de que los
    // restantes estén sincronizados entre sí.
    //
    // Filtros: solo cuentan pagos con validationStatus='validated' y
    // paymentFalse=false. Se excluye el pago en curso del SELECT y se
    // suma aparte (porque aún no quedó validated en DB).
    const cuotaAmount = new Big(credito.cuota ?? 0);
    let totalAplicadoEnCuota = new Big(pago.monto_aplicado ?? 0);
    let cuotaCompleta = false;

    if (pago.cuota_id !== null && cuotaAmount.gt(0)) {
      const otrosPagosValidados = await db
        .select({ monto_aplicado: pagos_credito.monto_aplicado })
        .from(pagos_credito)
        .where(
          and(
            eq(pagos_credito.cuota_id, pago.cuota_id),
            eq(pagos_credito.validationStatus, "validated"),
            eq(pagos_credito.paymentFalse, false),
            ne(pagos_credito.pago_id, pago_id)
          )
        );

      totalAplicadoEnCuota = otrosPagosValidados.reduce(
        (acc, p) => acc.plus(new Big(p.monto_aplicado ?? 0)),
        totalAplicadoEnCuota
      );

      // Tolerancia de 1 centavo por redondeos
      cuotaCompleta = totalAplicadoEnCuota.gte(cuotaAmount.minus(0.01));

      console.log(
        `📊 Cuota ${pago.cuota_id}: aplicado ${totalAplicadoEnCuota.toFixed(2)} / esperado ${cuotaAmount.toFixed(2)} (otros validated: ${otrosPagosValidados.length}) → ${cuotaCompleta ? "COMPLETA" : "incompleta"}`
      );
    }

    // INCOBRABLE: la cuota se cierra SI Y SOLO SI el capital del crédito llega
    // a 0 con este abono. No se usa la suma de `monto_aplicado` porque las filas
    // estructurales del castigo (system_reset / SISTEMA-INCOBRABLE) la
    // contaminan y cerrarían la cuota sin recuperación real. Ver
    // shouldIncobrableInstallmentBePaid. (Si no es incobrable devuelve null y
    // se conserva la decisión por suma de arriba.)
    if (pago.cuota_id !== null) {
      const incobrableCuotaPagada = shouldIncobrableInstallmentBePaid({
        statusCredit: credito.statusCredit,
        capital: credito.capital,
        abonoCapital: pago.abono_capital,
      });
      if (incobrableCuotaPagada !== null) {
        cuotaCompleta = incobrableCuotaPagada;
        const capitalPostPago = new Big(credito.capital ?? 0).minus(
          new Big(pago.abono_capital ?? 0)
        );
        console.log(
          `🔴 INCOBRABLE crédito ${credito.credito_id}: capital ${new Big(credito.capital ?? 0).toFixed(2)} − abono ${new Big(pago.abono_capital ?? 0).toFixed(2)} = ${capitalPostPago.toFixed(2)} → cuota ${cuotaCompleta ? "PAGADA (capital=0)" : "sigue pendiente"}`
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // RAMA A: la cuota AÚN no se cierra con este pago
    //   → valida el pago, aplica abono_capital al crédito si lo hay,
    //     pero NO marca la cuota como pagada NI distribuye a inversionistas.
    // ─────────────────────────────────────────────────────────────────
    if (!cuotaCompleta) {
      console.log("⚠️ La cuota aún no se cierra con este pago");

      // Validar el pago
      await db
        .update(pagos_credito)
        .set({ validationStatus: "validated", fecha_aplicado: new Date() })
        .where(eq(pagos_credito.pago_id, pago_id));

      const abonoCapitalPago = new Big(pago.abono_capital ?? 0);
      if (abonoCapitalPago.gt(0)) {
        console.log(
          "💰 Aplicando abono a capital aunque la cuota no cierre:",
          abonoCapitalPago.toString()
        );

        const capitalAct = new Big(credito.capital ?? 0);
        // Invariantes: INCOBRABLE sin interés/IVA, capital no-negativo.
        const recomputedParc = recomputeCreditAfterCapital({
          statusCredit: credito.statusCredit,
          newCapital: capitalAct.minus(abonoCapitalPago),
          porcentajeInteres: credito.porcentaje_interes,
          seguro: credito.seguro_10_cuotas,
          gps: credito.gps,
          membresias: credito.membresias_pago,
        });
        const nuevoCapitalParc = recomputedParc.capital;

        await db
          .update(creditos)
          .set({
            capital: nuevoCapitalParc.toString(),
            deudatotal: recomputedParc.deudaTotal.toString(),
            iva_12: recomputedParc.iva.toString(),
            cuota_interes: recomputedParc.cuotaInteres.toString(),
          })
          .where(eq(creditos.credito_id, pago.credito_id));

        console.log("💰 Nuevo capital:", nuevoCapitalParc.toString());
        console.log("✅ Capital aplicado al crédito (cuota aún abierta)");
      }

      return {
        success: true,
        applied: abonoCapitalPago.gt(0),
        message: abonoCapitalPago.gt(0)
          ? "Pago validado con restantes pendientes, abono a capital aplicado"
          : "Pago validado, pero no aplicado al crédito (tiene restantes pendientes)",
        // Preservamos el shape `restantes` para compat con el front.
        restantes: {
          capital: new Big(pago.capital_restante ?? 0).toString(),
          interes: new Big(pago.interes_restante ?? 0).toString(),
          iva: new Big(pago.iva_12_restante ?? 0).toString(),
          seguro: new Big(pago.seguro_restante ?? 0).toString(),
          gps: new Big(pago.gps_restante ?? 0).toString(),
          membresias: new Big(pago.membresias ?? 0).toString(),
        },
        cuota: {
          aplicado: totalAplicadoEnCuota.toString(),
          esperado: cuotaAmount.toString(),
          faltante: cuotaAmount.minus(totalAplicadoEnCuota).toString(),
        },
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // RAMA B: la cuota queda COMPLETA con este pago
    //   → recalcula crédito, valida el pago, marca la cuota como pagada,
    //     limpia restantes huérfanos y distribuye a inversionistas.
    // ─────────────────────────────────────────────────────────────────
    console.log("✅ Este pago cierra la cuota, aplicando al crédito");

    // 4. CALCULAR NUEVO CAPITAL (restar SOLO el abono_capital de este pago)
    // El capital del crédito ya viene descontado por cada pago previo validated
    // (cada uno restó su abono_capital cuando se ejecutó esta función).
    // Re-sumarlos aquí y restarlos otra vez causa doble descuento.
    const capital_actual = new Big(credito.capital ?? 0);
    const abono_capital_pago = new Big(pago.abono_capital ?? 0);

    // 5. RECALCULAR CAPITAL Y DEUDA con invariantes: INCOBRABLE sin interés/IVA
    //    y capital no-negativo (sobre-recuperación → 0).
    const recomputedCierre = recomputeCreditAfterCapital({
      statusCredit: credito.statusCredit,
      newCapital: capital_actual.minus(abono_capital_pago),
      porcentajeInteres: credito.porcentaje_interes,
      seguro: credito.seguro_10_cuotas,
      gps: credito.gps,
      membresias: credito.membresias_pago,
    });
    const nuevo_capital = recomputedCierre.capital;
    const cuota_interes = recomputedCierre.cuotaInteres;
    const iva_12 = recomputedCierre.iva;
    const nueva_deuda_total = recomputedCierre.deudaTotal;

    console.log("💰 Capital actual:", capital_actual.toString());
    console.log("💰 Abono capital:", abono_capital_pago.toString());
    console.log("💰 Nuevo capital:", nuevo_capital.toString());
    console.log("📊 Nueva deuda total:", nueva_deuda_total.toString());

    // 6. ACTUALIZAR EL CRÉDITO
    await db
      .update(creditos)
      .set({
        capital: nuevo_capital.toString(),
        deudatotal: nueva_deuda_total.toString(),
        iva_12: iva_12.toString(),
        cuota_interes: cuota_interes.toString(),
      })
      .where(eq(creditos.credito_id, pago.credito_id));

    // 7. VALIDAR EL PAGO y registrar fecha de aplicación
    await db
      .update(pagos_credito)
      .set({ validationStatus: "validated", fecha_aplicado: new Date() })
      .where(eq(pagos_credito.pago_id, pago_id));

    if (pago.cuota_id !== null) {
      // Marcar la cuota como pagada
      await db
        .update(cuotas_credito)
        .set({ pagado: true })
        .where(eq(cuotas_credito.cuota_id, pago.cuota_id));

      // Limpiar `*_restante` huérfanos del resto de pagos de la cuota.
      // Si quedaron descuadrados por bugs históricos (pagos partidos
      // sin sincronización), ya no van a polucionar lecturas futuras
      // ni reactivar el camino "tiene restantes" si alguien revalida.
      await db
        .update(pagos_credito)
        .set({
          capital_restante: "0",
          interes_restante: "0",
          iva_12_restante: "0",
          seguro_restante: "0",
          gps_restante: "0",
        })
        .where(
          and(
            eq(pagos_credito.cuota_id, pago.cuota_id),
            eq(pagos_credito.paymentFalse, false)
          )
        );
    }

    console.log("✅ Crédito actualizado, pago validado y cuota cerrada");

    // 8. Distribuir entre inversionistas — TODOS los pagos validated de la cuota
    //    que aún no tengan filas en pagos_credito_inversionistas.
    //
    //    Por qué: en una cuota partida en N pagos, los primeros (N-1) cayeron
    //    en la rama "cuota incompleta" (RAMA A), que valida pero NO distribuye.
    //    Cuando llega el pago que cierra la cuota (este), solo se había
    //    distribuido este último (los Q0.06 del ejemplo). Los anteriores
    //    (Q5,410) quedaban sin reflejar en pagos_credito_inversionistas y los
    //    inversionistas no recibían su parte.
    //
    //    Filtramos por "no tiene fila en pagos_credito_inversionistas" para
    //    no doblar abonos: insertPagosCreditoInversionistasV2 hace
    //    onConflictDoUpdate (idempotente a nivel de upsert) pero también llama
    //    a processAndReplaceCreditInvestors, que descuenta del monto_aportado
    //    de cada inversionista — eso NO es idempotente.
    const pagosValidadosCuota = pago.cuota_id !== null
      ? await db
          .select({ pago_id: pagos_credito.pago_id })
          .from(pagos_credito)
          .where(
            and(
              eq(pagos_credito.cuota_id, pago.cuota_id),
              eq(pagos_credito.validationStatus, "validated"),
              eq(pagos_credito.paymentFalse, false)
            )
          )
      : [{ pago_id }];

    const yaDistribuidos = pagosValidadosCuota.length > 0
      ? await db
          .selectDistinct({ pago_id: pagos_credito_inversionistas.pago_id })
          .from(pagos_credito_inversionistas)
          .where(
            inArray(
              pagos_credito_inversionistas.pago_id,
              pagosValidadosCuota.map((p) => p.pago_id)
            )
          )
      : [];

    const yaDistribuidosSet = new Set(yaDistribuidos.map((p) => p.pago_id));
    const pagosADistribuir = pagosValidadosCuota
      .map((p) => p.pago_id)
      .filter((id) => !yaDistribuidosSet.has(id));

    console.log(
      `💼 Distribución a inversionistas: ${pagosADistribuir.length} pago(s) de la cuota pendiente(s) [${pagosADistribuir.join(", ") || "ninguno"}]`
    );

    for (const distPagoId of pagosADistribuir) {
      await insertPagosCreditoInversionistasV2(distPagoId, pago.credito_id);
    }

    return {
      success: true,
      applied: true,
      message: "Pago aplicado al crédito exitosamente",
      data: {
        credito_id: pago.credito_id,
        capital_anterior: capital_actual.toString(),
        abono_capital: abono_capital_pago.toString(),
        capital_nuevo: nuevo_capital.toString(),
        deuda_total_nueva: nueva_deuda_total.toString(),
      },
    };
  } catch (error) {
    console.error("❌ Error al aplicar pago al crédito:", error);
    throw error;
  }
}

/**
 * Calcula la distribución REAL de un crédito entre Cash In e Inversionistas
 * basado en montos aportados y porcentajes de Cash In
 */
export async function calcularDistribucionCredito(credito_id: number) {
  console.log("\n💰 ========== DISTRIBUCIÓN DEL CRÉDITO ==========");
  console.log(`📋 Crédito ID: ${credito_id}`);

  // 1️⃣ Obtener inversionistas
  const creditoInversionistas = await db
    .select({
      ci: creditos_inversionistas,
      inv: inversionistas,
    })
    .from(creditos_inversionistas)
    .innerJoin(
      inversionistas,
      eq(
        creditos_inversionistas.inversionista_id,
        inversionistas.inversionista_id
      )
    )
    .where(eq(creditos_inversionistas.credito_id, credito_id));

  if (creditoInversionistas.length === 0) {
    throw new Error("No hay inversionistas en este crédito");
  }

  // El capital total para repartir % es la SUMA de los monto_aportado.
  // No usar credito.capital: ese baja con cada cuota/abono y se desincroniza
  // del monto_aportado, inflando los % cuando se calcula después de un UPDATE.
  const capitalTotal = creditoInversionistas.reduce(
    (acc, { ci }) => acc.plus(ci.monto_aportado ?? 0),
    new Big(0)
  );
  console.log(`💰 Capital Total (suma monto_aportado): ${capitalTotal.toString()}`);
  console.log(`👥 Total inversionistas: ${creditoInversionistas.length}\n`);

  // 3️⃣ Calcular distribución por inversionista
  let totalCashInPorcentaje = new Big(0);
  let totalInversionistaPorcentaje = new Big(0);

  const distribucion = creditoInversionistas.map(({ ci, inv }) => {
    const montoAportado = new Big(ci.monto_aportado ?? 0);

    // Porcentaje que representa del capital total
    const porcentajeDelCredito = capitalTotal.gt(0)
      ? montoAportado.div(capitalTotal).times(100)
      : new Big(0);

    // Detectar si es Cube Investments
    const nombreInversionista = (inv.nombre ?? "").toLowerCase().trim();
    const esCubeInvestments = nombreInversionista === "cube investments s.a";

    // Porcentaje Cash In (100% si es Cube)
    const porcentajeCashIn = esCubeInvestments
      ? new Big(100)
      : new Big(ci.porcentaje_cash_in ?? 0);

    // 🎯 CÁLCULO CLAVE: Del monto aportado, cuánto es Cash In y cuánto del Inversionista
    const montoCashIn = montoAportado.times(porcentajeCashIn).div(100);
    const montoInversionista = montoAportado.minus(montoCashIn);

    // Porcentajes que representan del CRÉDITO TOTAL
    const porcentajeCashInDelCredito = capitalTotal.gt(0)
      ? montoCashIn.div(capitalTotal).times(100)
      : new Big(0);

    const porcentajeInversionistaDelCredito = capitalTotal.gt(0)
      ? montoInversionista.div(capitalTotal).times(100)
      : new Big(0);

    // Acumular totales
    totalCashInPorcentaje = totalCashInPorcentaje.plus(
      porcentajeCashInDelCredito
    );
    totalInversionistaPorcentaje = totalInversionistaPorcentaje.plus(
      porcentajeInversionistaDelCredito
    );

    console.log(`👤 ${inv.nombre}`);
    console.log(`   💰 Monto Aportado: Q${montoAportado.toFixed(2)}`);
    console.log(
      `   📊 Porcentaje del Crédito: ${porcentajeDelCredito.toFixed(2)}%`
    );
    console.log(`   🎯 Config Cash In: ${porcentajeCashIn.toFixed(2)}%`);
    console.log(
      `   ├─ 💸 Cash In: Q${montoCashIn.toFixed(2)} (${porcentajeCashInDelCredito.toFixed(2)}% del crédito)`
    );
    console.log(
      `   └─ 👤 Inversionista: Q${montoInversionista.toFixed(2)} (${porcentajeInversionistaDelCredito.toFixed(2)}% del crédito)`
    );
    if (esCubeInvestments) {
      console.log(`   🔥 CUBE INVESTMENTS → 100% Cash In`);
    }
    console.log();

    return {
      id: ci.id,
      inversionista_id: ci.inversionista_id,
      nombre: inv.nombre,
      es_cube: esCubeInvestments,

      // Montos
      monto_aportado: montoAportado.toFixed(2),
      monto_cash_in: montoCashIn.toFixed(2),
      monto_inversionista: montoInversionista.toFixed(2),

      // Porcentajes del crédito
      porcentaje_total_credito: porcentajeDelCredito.toFixed(4),
      porcentaje_cash_in_credito: porcentajeCashInDelCredito.toFixed(4),
      porcentaje_inversionista_credito:
        porcentajeInversionistaDelCredito.toFixed(4),

      // Config
      porcentaje_cash_in_config: porcentajeCashIn.toFixed(2),
    };
  });

  console.log(`🔍 ========== RESUMEN DEL CRÉDITO ==========`);
  console.log(`💰 Capital Total: Q${capitalTotal.toString()}`);
  console.log(`💸 Total Cash In: ${totalCashInPorcentaje.toFixed(2)}%`);
  console.log(
    `👥 Total Inversionistas: ${totalInversionistaPorcentaje.toFixed(2)}%`
  );
  console.log(
    `✅ Suma: ${totalCashInPorcentaje.plus(totalInversionistaPorcentaje).toFixed(2)}%`
  );
  console.log(`✅ ========== FIN ==========\n`);

  return {
    capital_total: capitalTotal.toString(),
    distribucion,
    resumen: {
      porcentaje_cash_in_total: totalCashInPorcentaje.toFixed(2),
      porcentaje_inversionistas_total: totalInversionistaPorcentaje.toFixed(2),
      monto_cash_in_total: capitalTotal
        .times(totalCashInPorcentaje)
        .div(100)
        .toFixed(2),
      monto_inversionistas_total: capitalTotal
        .times(totalInversionistaPorcentaje)
        .div(100)
        .toFixed(2),
    },
  };
}

/**
 * Calcula cómo distribuir un ABONO A CAPITAL entre inversionistas
 * respetando los porcentajes Cash In
 */
export async function calcularDistribucionAbonoCapital(
  credito_id: number,
  abono_capital: number | string
) {
  console.log("\n💵 ========== DISTRIBUCIÓN DE ABONO A CAPITAL ==========");
  console.log(`📋 Crédito ID: ${credito_id}`);
  console.log(`💵 Abono: ${abono_capital}`);

  const abonoCapitalBig = new Big(abono_capital);

  // Obtener distribución actual del crédito
  const { distribucion: distCredito, capital_total } =
    await calcularDistribucionCredito(credito_id);
  const capitalTotalBig = new Big(capital_total);

  console.log(`\n💰 Distribuyendo abono de Q${abonoCapitalBig.toString()}:\n`);

  let totalCashInAbono = new Big(0);
  let totalInversionistaAbono = new Big(0);

  const distribucionAbono = distCredito.map((inv) => {
    const porcentajeCreditoInv = new Big(inv.porcentaje_inversionista_credito);
    const porcentajeCreditoCashIn = new Big(inv.porcentaje_cash_in_credito);

    // Del abono, cuánto le toca a este inversionista (proporcional a su %)
    const abonoInversionista = abonoCapitalBig
      .times(porcentajeCreditoInv)
      .div(100);
    const abonoCashIn = abonoCapitalBig.times(porcentajeCreditoCashIn).div(100);

    totalInversionistaAbono = totalInversionistaAbono.plus(abonoInversionista);
    totalCashInAbono = totalCashInAbono.plus(abonoCashIn);

    // Nuevos montos aportados después del abono
    const nuevoMontoInversionista = new Big(inv.monto_inversionista).minus(
      abonoInversionista
    );
    const nuevoMontoCashIn = new Big(inv.monto_cash_in).minus(abonoCashIn);
    const nuevoMontoAportado = nuevoMontoInversionista.plus(nuevoMontoCashIn);

    console.log(`👤 ${inv.nombre}`);
    console.log(`   💵 Abono Inversionista: Q${abonoInversionista.toFixed(2)}`);
    console.log(`   💸 Abono Cash In: Q${abonoCashIn.toFixed(2)}`);
    console.log(
      `   ✅ Nuevo Monto Aportado: Q${nuevoMontoAportado.toFixed(2)}`
    );
    console.log();

    return {
      ...inv,
      abono_inversionista: abonoInversionista.toFixed(2),
      abono_cash_in: abonoCashIn.toFixed(2),
      abono_total: abonoInversionista.plus(abonoCashIn).toFixed(2),
      nuevo_monto_aportado: nuevoMontoAportado.toFixed(2),
      nuevo_monto_inversionista: nuevoMontoInversionista.toFixed(2),
      nuevo_monto_cash_in: nuevoMontoCashIn.toFixed(2),
    };
  });

  console.log(`🔍 ========== VERIFICACIÓN ==========`);
  console.log(`💵 Abono Total: Q${abonoCapitalBig.toString()}`);
  console.log(
    `👥 Total Inversionistas: Q${totalInversionistaAbono.toFixed(2)}`
  );
  console.log(`💸 Total Cash In: Q${totalCashInAbono.toFixed(2)}`);
  console.log(
    `✅ Suma: Q${totalInversionistaAbono.plus(totalCashInAbono).toFixed(2)}`
  );
  console.log(`✅ ========== FIN ==========\n`);

  return {
    abono_total: abonoCapitalBig.toString(),
    distribucion: distribucionAbono,
    resumen: {
      total_abono_inversionistas: totalInversionistaAbono.toFixed(2),
      total_abono_cash_in: totalCashInAbono.toFixed(2),
    },
  };
}

/**
 * APLICA el abono actualizando la BD
 */
export async function aplicarAbonoCapitalInversionistas(
  credito_id: number,
  abono_capital: number | string,
  pago_id: number
) {
  console.log("\n💵 ========== APLICANDO ABONO A CAPITAL ==========");

  // Distribuir abono a capital en tabla espejo
  try {
    await distribuirAbonoCapitalEspejo(credito_id, abono_capital);
    console.log("✅ Abono distribuido en tabla abonos_capital (espejo)");
  } catch (err) {
    console.error("⚠️ Error al distribuir abono en espejo:", err);
  }

  const abonoCapitalBig = new Big(abono_capital);
  console.log(`💵 Abono Total: ${abonoCapitalBig.toString()}`);
  console.log(`🧾 Pago ID: ${pago_id}`);

  // 1️⃣ Obtener el crédito
  const [credito] = await db
    .select()
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id))
    .limit(1);

  if (!credito) {
    throw new Error("Crédito no encontrado");
  }

  // 1️⃣.1 Calcular nuevos valores del crédito
  const capitalActual = new Big(credito.capital ?? 0);
  const nuevoCapital = capitalActual.minus(abonoCapitalBig);

  const cuota_interes = nuevoCapital
    .times(new Big(credito.porcentaje_interes ?? 0).div(100))
    .round(2);

  const iva_12 = cuota_interes.times(0.12).round(2);

  const deudatotal = nuevoCapital
    .plus(cuota_interes)
    .plus(iva_12)
    .plus(credito.seguro_10_cuotas ?? 0)
    .plus(credito.gps ?? 0)
    .plus(credito.membresias_pago ?? 0);

  console.log(`💰 Capital Actual: Q${capitalActual.toString()}`);
  console.log(`💰 Nuevo Capital: Q${nuevoCapital.toString()}`);
  console.log(`📊 Nuevo Interés: Q${cuota_interes.toString()}`);
  console.log(`📊 Nuevo IVA: Q${iva_12.toString()}`);
  console.log(`📊 Nueva Deuda Total: Q${deudatotal.toString()}`);

  // 1️⃣.2 Actualizar el crédito
  await db
    .update(creditos)
    .set({
      capital: nuevoCapital.toString(),
      deudatotal: deudatotal.toString(),
      cuota_interes: cuota_interes.toString(),
      iva_12: iva_12.toString(),
    })
    .where(eq(creditos.credito_id, credito_id));

  console.log(`✅ Crédito actualizado`);

  console.log(`✅ Saldo a favor limpiado`);

  // 2️⃣ Calcular la distribución (ya sabes cuánto le toca a cada quien)
  const { distribucion } = await calcularDistribucionAbonoCapital(
    credito_id,
    abono_capital
  );

  console.log(`\n🔄 Procesando ${distribucion.length} inversionistas...\n`);

  const pagosRegistrados = [];

  // 3️⃣ Recorrer cada inversionista
  for (const dist of distribucion) {
    const abonoInversionista = new Big(dist.abono_total);
    const porcentajeParticipacion = new Big(dist.porcentaje_total_credito);

    console.log(`👤 Procesando: ${dist.nombre}`);
    console.log(`   💵 Abono a Capital: Q${abonoInversionista.toString()}`);
    console.log(`   📊 Participación: ${porcentajeParticipacion.toString()}%`);

    // 4️⃣ Llamar a tu método para actualizar el inversionista
    await processAndReplaceCreditInvestors(
      credito_id,
      abonoInversionista.toNumber(),
      false, // false porque es un ABONO (resta del capital)
      dist.inversionista_id
    );

    // 5️⃣ Obtener cuota actualizada del inversionista
    const [inversionistaActualizado] = await db
      .select()
      .from(creditos_inversionistas)
      .where(
        and(
          eq(creditos_inversionistas.credito_id, credito_id),
          eq(creditos_inversionistas.inversionista_id, dist.inversionista_id)
        )
      )
      .limit(1);

    if (!inversionistaActualizado) {
      throw new Error(`Inversionista ${dist.inversionista_id} no encontrado`);
    }

    const cuotaInversionista = new Big(
      inversionistaActualizado.cuota_inversionista ?? 0
    );

    console.log(`   💵 Cuota Actualizada: Q${cuotaInversionista.toString()}`);
    const guatemalaTime = new Date(
      new Date().toLocaleString("en-US", {
        timeZone: "America/Guatemala",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    );

    // 6️⃣ Registrar el pago del inversionista (SOLO abono_capital, lo demás en 0)
    const [pagoRegistrado] = await db
      .insert(pagos_credito_inversionistas)
      .values({
        pago_id: pago_id,
        inversionista_id: dist.inversionista_id,
        credito_id: credito_id,
        abono_capital: abonoInversionista.toFixed(2), // 🎯 SOLO ESTO tiene valor
        abono_interes: "0.00", // ❌ Cero
        abono_iva_12: "0.00", // ❌ Cero
        porcentaje_participacion: porcentajeParticipacion.toFixed(2),
        cuota: cuotaInversionista.toFixed(2),
        fecha_pago: guatemalaTime,
        estado_liquidacion: "NO_LIQUIDADO",
      })
      .returning();

    console.log(`   ✅ Pago registrado: ID ${pagoRegistrado.id}`);
    console.log(`   ✅ Actualizado: ${dist.nombre}\n`);

    pagosRegistrados.push({
      pago_inversionista_id: pagoRegistrado.id,
      inversionista_id: dist.inversionista_id,
      nombre: dist.nombre,
      abono_capital: abonoInversionista.toFixed(2),
      abono_interes: "0.00", // ❌ Cero
      abono_iva: "0.00", // ❌ Cero
      cuota: cuotaInversionista.toFixed(2),
      porcentaje_participacion: porcentajeParticipacion.toFixed(2),
    });
  }
  await db
    .update(pagos_credito)
    .set({
      // Estado propio del abono a capital APLICADO. No usamos `validated`
      // porque ese estado entra al set de hermanos de la cuota e inflaría su
      // faltante (un abono a capital NO es pago de cuota). `capital_validated`
      // lo deja distinguible: cuenta como aplicado en reportes/reversa, pero
      // queda fuera de la lógica de cuota.
      validationStatus: "capital_validated",
      // Estampar la fecha de aplicación. Antes este flujo dejaba `fecha_aplicado`
      // en NULL → el abono quedaba "validado sin fecha". Se guarda en UTC con
      // `new Date()` igual que los demás writers de `fecha_aplicado` (~2149/2266
      // y revalidatePayment): los consumidores ya convierten a hora de Guatemala
      // con `AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala'`. Guardar el
      // wall-clock GT aquí lo shiftearía dos veces (P2 de Codex).
      fecha_aplicado: new Date(),
    })
    .where(eq(pagos_credito.pago_id, pago_id));

  console.log(`✅ ========== ABONO APLICADO EXITOSAMENTE ==========\n`);

  return {
    message: "Abono a capital aplicado exitosamente",
    credito_id,
    pago_id,
    abono_total: abonoCapitalBig.toString(),
    credito_actualizado: {
      capital_anterior: capitalActual.toString(),
      capital_nuevo: nuevoCapital.toString(),
      cuota_interes_nuevo: cuota_interes.toString(),
      iva_12_nuevo: iva_12.toString(),
      deuda_total_nueva: deudatotal.toString(),
    },
    total_inversionistas: distribucion.length,
    pagos_registrados: pagosRegistrados,
    distribucion,
  };
}

export async function actualizarCuentaPago(
  pagoId: number,
  cuentaEmpresaId: number
) {
  try {
    // 1️⃣ Validar que el pago existe
    const pagoExiste = await db
      .select()
      .from(pagos_credito)
      .where(eq(pagos_credito.pago_id, pagoId))
      .limit(1);

    if (!pagoExiste || pagoExiste.length === 0) {
      return {
        success: false,
        message: "❌ Pago no encontrado",
        data: null,
      };
    }

    // 2️⃣ Validar que la cuenta existe y está activa
    const cuentaExiste = await db
      .select()
      .from(cuentasEmpresa)
      .where(eq(cuentasEmpresa.cuentaId, cuentaEmpresaId))
      .limit(1);

    if (!cuentaExiste || cuentaExiste.length === 0) {
      return {
        success: false,
        message: "❌ Cuenta de empresa no encontrada",
        data: null,
      };
    }

    if (!cuentaExiste[0].activo) {
      return {
        success: false,
        message: "❌ La cuenta de empresa está inactiva",
        data: null,
      };
    }

    // 3️⃣ Actualizar el pago con la nueva cuenta
    const [pagoActualizado] = await db
      .update(pagos_credito)
      .set({
        cuenta_empresa_id: cuentaEmpresaId,
      })
      .where(eq(pagos_credito.pago_id, pagoId))
      .returning();

    return {
      success: true,
      message: "✅ Cuenta de empresa actualizada correctamente en el pago",
      data: pagoActualizado,
    };
  } catch (error: any) {
    console.error("❌ Error al actualizar cuenta de empresa en pago:", error);
    return {
      success: false,
      message: "❌ Error al actualizar la cuenta del pago",
      error: error.message,
      data: null,
    };
  }
}

/**
 * Aplica un monto adicional a los restantes de un pago existente.
 * Recibe pago_id y monto, distribuye en orden: interés → IVA → seguro → GPS → membresías → capital.
 * Actualiza solo ese pago y llama a inversionistas.
 */
export async function aplicarMontoAPago(pago_id: number, monto: number, fecha_pago?: string, validationStatus?: string) {
  try {
    // 1. Obtener el pago
    const [pago] = await db
      .select()
      .from(pagos_credito)
      .where(eq(pagos_credito.pago_id, pago_id))
      .limit(1);

    if (!pago) {
      return { success: false, message: `Pago ${pago_id} no encontrado` };
    }

    // 2. Obtener restantes del pago
    const interes_restante = new Big(pago.interes_restante ?? 0);
    const iva_restante = new Big(pago.iva_12_restante ?? 0);
    const seguro_restante = new Big(pago.seguro_restante ?? 0);
    const gps_restante = new Big(pago.gps_restante ?? 0);
    const membresias_restante = new Big(pago.membresias ?? 0);
    const capital_restante = new Big(pago.capital_restante ?? 0);

    let disponible = new Big(monto);

    // 3. Distribuir en orden de prioridad
    // 3.1 Interés
    let abono_interes = new Big(0);
    if (disponible.gt(0) && interes_restante.gt(0)) {
      abono_interes = disponible.lt(interes_restante) ? disponible : interes_restante;
      disponible = disponible.minus(abono_interes);
    }

    // 3.2 IVA
    let abono_iva = new Big(0);
    if (disponible.gt(0) && iva_restante.gt(0)) {
      abono_iva = disponible.lt(iva_restante) ? disponible : iva_restante;
      disponible = disponible.minus(abono_iva);
    }

    // 3.3 Seguro
    let abono_seguro = new Big(0);
    if (disponible.gt(0) && seguro_restante.gt(0)) {
      abono_seguro = disponible.lt(seguro_restante) ? disponible : seguro_restante;
      disponible = disponible.minus(abono_seguro);
    }

    // 3.4 GPS
    let abono_gps = new Big(0);
    if (disponible.gt(0) && gps_restante.gt(0)) {
      abono_gps = disponible.lt(gps_restante) ? disponible : gps_restante;
      disponible = disponible.minus(abono_gps);
    }

    // 3.5 Membresías
    let abono_membresias = new Big(0);
    if (disponible.gt(0) && membresias_restante.gt(0)) {
      abono_membresias = disponible.lt(membresias_restante) ? disponible : membresias_restante;
      disponible = disponible.minus(abono_membresias);
    }

    // 3.6 Capital
    let abono_capital = new Big(0);
    if (disponible.gt(0) && capital_restante.gt(0)) {
      abono_capital = disponible.lt(capital_restante) ? disponible : capital_restante;
      disponible = disponible.minus(abono_capital);
    }

    // 4. Calcular nuevos restantes
    const nuevo_interes_restante = interes_restante.minus(abono_interes);
    const nuevo_iva_restante = iva_restante.minus(abono_iva);
    const nuevo_seguro_restante = seguro_restante.minus(abono_seguro);
    const nuevo_gps_restante = gps_restante.minus(abono_gps);
    const nuevo_membresias_restante = membresias_restante.minus(abono_membresias);
    const nuevo_capital_restante = capital_restante.minus(abono_capital);

    const cuota_pagada =
      nuevo_interes_restante.eq(0) &&
      nuevo_iva_restante.eq(0) &&
      nuevo_seguro_restante.eq(0) &&
      nuevo_gps_restante.eq(0) &&
      nuevo_membresias_restante.eq(0) &&
      nuevo_capital_restante.eq(0);

    // Resetear abonos: solo quedan los de este monto
    const nuevo_abono_interes = abono_interes;
    const nuevo_abono_iva = abono_iva;
    const nuevo_abono_seguro = abono_seguro;
    const nuevo_abono_gps = abono_gps;
    const nuevo_abono_membresias = abono_membresias;
    const nuevo_abono_capital = abono_capital;

    const totalPagado = abono_capital
      .plus(abono_interes)
      .plus(abono_iva)
      .plus(abono_seguro)
      .plus(abono_gps)
      .plus(abono_membresias);

    const nuevo_monto_aplicado = totalPagado;
    const nuevo_monto_boleta = new Big(monto);

    if (
      shouldRejectZeroAppliedNormalValidation({
        validationStatus: pago.validationStatus,
        nextValidationStatus: validationStatus,
        montoAplicado: nuevo_monto_aplicado,
        mora: pago.mora,
        otros: pago.otros,
        pagoConvenio: pago.pagoConvenio,
      })
    ) {
      return {
        success: false,
        message: `No se puede validar el pago ${pago_id}: monto_aplicado es 0.00`,
      };
    }

    // Fecha de pago: si viene, usarla; sino, fecha actual en hora Guatemala
    let fechaPago: Date;
    if (fecha_pago) {
      fechaPago = new Date(fecha_pago);
    } else {
      const guatemalaTimeString = new Date().toLocaleString("en-US", {
        timeZone: "America/Guatemala",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const [datePart, timePart] = guatemalaTimeString.split(", ");
      const [month, day, year] = datePart.split("/");
      fechaPago = new Date(`${year}-${month}-${day}T${timePart}`);
    }

    // 5. Actualizar el pago
    const [pagoActualizado] = await db
      .update(pagos_credito)
      .set({
        abono_interes: nuevo_abono_interes.toString(),
        abono_iva_12: nuevo_abono_iva.toString(),
        abono_seguro: nuevo_abono_seguro.toString(),
        abono_gps: nuevo_abono_gps.toString(),
        abono_capital: nuevo_abono_capital.toString(),
        membresias_pago: nuevo_abono_membresias.toString(),
        membresias: nuevo_membresias_restante.toString(),
        capital_restante: nuevo_capital_restante.toString(),
        interes_restante: nuevo_interes_restante.toString(),
        iva_12_restante: nuevo_iva_restante.toString(),
        seguro_restante: nuevo_seguro_restante.toString(),
        gps_restante: nuevo_gps_restante.toString(),
        monto_boleta: nuevo_monto_boleta.toString(),
        monto_aplicado: nuevo_monto_aplicado.toString(),
        pagado: cuota_pagada,
        fecha_pago: fechaPago,
        ...(validationStatus ? { validationStatus: validationStatus as any } : {}),
      })
      .where(eq(pagos_credito.pago_id, pago_id))
      .returning();

    // 6. Si quedó pagada, marcar la cuota también
    if (cuota_pagada && pago.cuota_id) {
      await db
        .update(cuotas_credito)
        .set({ pagado: true })
        .where(eq(cuotas_credito.cuota_id, pago.cuota_id));
    }

    // 7. Distribuir entre inversionistas
    if (pago.credito_id) {
      await insertPagosCreditoInversionistasV2(pago_id, pago.credito_id);
    }

    return {
      success: true,
      message: cuota_pagada
        ? "Pago completado y aplicado"
        : "Monto aplicado a restantes (pago aún parcial)",
      data: {
        pago_id,
        monto_aplicado: monto,
        sobrante: disponible.toString(),
        pagado: cuota_pagada,
        abonos: {
          interes: abono_interes.toString(),
          iva: abono_iva.toString(),
          seguro: abono_seguro.toString(),
          gps: abono_gps.toString(),
          membresias: abono_membresias.toString(),
          capital: abono_capital.toString(),
        },
        nuevos_restantes: {
          interes: nuevo_interes_restante.toString(),
          iva: nuevo_iva_restante.toString(),
          seguro: nuevo_seguro_restante.toString(),
          gps: nuevo_gps_restante.toString(),
          membresias: nuevo_membresias_restante.toString(),
          capital: nuevo_capital_restante.toString(),
        },
      },
    };
  } catch (error: any) {
    console.error("❌ Error en aplicarMontoAPago:", error);
    return {
      success: false,
      message: "Error al aplicar monto al pago",
      error: error.message,
    };
  }
}

/**
 * Edita campos de un pago existente (abonos, restantes, mora, otros, etc.)
 * Solo actualiza los campos que se envíen. Recalcula monto_aplicado y pagado automáticamente.
 */
export async function editarPago(pago_id: number, campos: {
  abono_capital?: string;
  abono_interes?: string;
  abono_iva_12?: string;
  abono_seguro?: string;
  abono_gps?: string;
  capital_restante?: string;
  interes_restante?: string;
  iva_12_restante?: string;
  seguro_restante?: string;
  gps_restante?: string;
  membresias?: string;
  membresias_pago?: string;
  otros?: string;
  mora?: string;
  monto_boleta?: string;
  monto_aplicado?: string;
  observaciones?: string;
  pagado?: boolean;
  fecha_pago?: string;
  origen_pago?: "transferencia" | "cheque" | "boleta";
}) {
  try {
    // 1. Verificar que el pago existe
    const [pago] = await db
      .select()
      .from(pagos_credito)
      .where(eq(pagos_credito.pago_id, pago_id))
      .limit(1);

    if (!pago) {
      return { success: false, message: `Pago ${pago_id} no encontrado` };
    }

    // 2. Construir objeto de update solo con los campos enviados
    const updateData: Record<string, any> = {};

    // Abonos
    if (campos.abono_capital !== undefined) updateData.abono_capital = campos.abono_capital;
    if (campos.abono_interes !== undefined) updateData.abono_interes = campos.abono_interes;
    if (campos.abono_iva_12 !== undefined) updateData.abono_iva_12 = campos.abono_iva_12;
    if (campos.abono_seguro !== undefined) updateData.abono_seguro = campos.abono_seguro;
    if (campos.abono_gps !== undefined) updateData.abono_gps = campos.abono_gps;

    // Restantes
    if (campos.capital_restante !== undefined) updateData.capital_restante = campos.capital_restante;
    if (campos.interes_restante !== undefined) updateData.interes_restante = campos.interes_restante;
    if (campos.iva_12_restante !== undefined) updateData.iva_12_restante = campos.iva_12_restante;
    if (campos.seguro_restante !== undefined) updateData.seguro_restante = campos.seguro_restante;
    if (campos.gps_restante !== undefined) updateData.gps_restante = campos.gps_restante;

    // Membresías
    if (campos.membresias !== undefined) updateData.membresias = campos.membresias;
    if (campos.membresias_pago !== undefined) updateData.membresias_pago = campos.membresias_pago;

    // Otros campos
    if (campos.otros !== undefined) updateData.otros = campos.otros;
    if (campos.mora !== undefined) updateData.mora = campos.mora;
    if (campos.monto_boleta !== undefined) updateData.monto_boleta = campos.monto_boleta;
    if (campos.observaciones !== undefined) updateData.observaciones = campos.observaciones;
    if (campos.fecha_pago !== undefined) updateData.fecha_pago = new Date(campos.fecha_pago);
    if (campos.origen_pago !== undefined) updateData.origen_pago = campos.origen_pago;

    // 3. Recalcular monto_aplicado si se enviaron abonos
    const abonoCapital = new Big(campos.abono_capital ?? pago.abono_capital ?? 0);
    const abonoInteres = new Big(campos.abono_interes ?? pago.abono_interes ?? 0);
    const abonoIva = new Big(campos.abono_iva_12 ?? pago.abono_iva_12 ?? 0);
    const abonoSeguro = new Big(campos.abono_seguro ?? pago.abono_seguro ?? 0);
    const abonoGps = new Big(campos.abono_gps ?? pago.abono_gps ?? 0);
    const abonoMembresias = new Big(campos.membresias_pago ?? pago.membresias_pago ?? 0);

    if (campos.monto_aplicado !== undefined) {
      updateData.monto_aplicado = campos.monto_aplicado;
    } else if (
      campos.abono_capital !== undefined ||
      campos.abono_interes !== undefined ||
      campos.abono_iva_12 !== undefined ||
      campos.abono_seguro !== undefined ||
      campos.abono_gps !== undefined ||
      campos.membresias_pago !== undefined
    ) {
      const nuevoMontoAplicado = abonoCapital
        .plus(abonoInteres)
        .plus(abonoIva)
        .plus(abonoSeguro)
        .plus(abonoGps)
        .plus(abonoMembresias);
      updateData.monto_aplicado = nuevoMontoAplicado.toString();
    }

    // 4. Recalcular pagado si se enviaron restantes
    if (campos.pagado !== undefined) {
      updateData.pagado = campos.pagado;
    } else if (
      campos.capital_restante !== undefined ||
      campos.interes_restante !== undefined ||
      campos.iva_12_restante !== undefined ||
      campos.seguro_restante !== undefined ||
      campos.gps_restante !== undefined ||
      campos.membresias !== undefined
    ) {
      const capRest = new Big(campos.capital_restante ?? pago.capital_restante ?? 0);
      const intRest = new Big(campos.interes_restante ?? pago.interes_restante ?? 0);
      const ivaRest = new Big(campos.iva_12_restante ?? pago.iva_12_restante ?? 0);
      const segRest = new Big(campos.seguro_restante ?? pago.seguro_restante ?? 0);
      const gpsRest = new Big(campos.gps_restante ?? pago.gps_restante ?? 0);
      const memRest = new Big(campos.membresias ?? pago.membresias ?? 0);

      const todosEnCero = capRest.eq(0) && intRest.eq(0) && ivaRest.eq(0) &&
        segRest.eq(0) && gpsRest.eq(0) && memRest.eq(0);

      updateData.pagado = todosEnCero;
    }

    if (Object.keys(updateData).length === 0) {
      return { success: false, message: "No se enviaron campos para actualizar" };
    }

    // 5. Ejecutar update
    const [pagoActualizado] = await db
      .update(pagos_credito)
      .set(updateData)
      .where(eq(pagos_credito.pago_id, pago_id))
      .returning();

    console.log(`✅ Pago ${pago_id} editado. Campos: ${Object.keys(updateData).join(", ")}`);

    return {
      success: true,
      message: "Pago actualizado correctamente",
      data: pagoActualizado,
    };
  } catch (error: any) {
    console.error("❌ Error en editarPago:", error);
    return {
      success: false,
      message: "Error al editar el pago",
      error: error.message,
    };
  }
}
