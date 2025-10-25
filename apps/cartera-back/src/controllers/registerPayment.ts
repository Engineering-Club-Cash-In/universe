import Big from "big.js";
import z from "zod";
import { db } from "../database";
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
} from "../database/db";
import { eq, and, lte, asc, sql, gt, gte, or } from "drizzle-orm";
import { updateMora } from "./latefee";
import { insertPagosCreditoInversionistas } from "./payments";
import { processAndReplaceCreditInvestors } from "./investor";

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
  set: SetContext
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
        eq(creditos.statusCredit, "MOROSO") // 🚨 También traer créditos morosos
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
        .where(
          and(
            eq(cuotas_credito.credito_id, credito_id),
            eq(cuotas_credito.pagado, false)
          )
        )
        .orderBy(cuotas_credito.numero_cuota),
    ]);

    // ✅ Retornar todo estructurado
    return {
      // 📋 Crédito completo
      credito: info.credito,

      // 📊 Cuotas pendientes (array ordenado)
      cuotasPendientes,

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
        totalCuotasPendientes: cuotasPendientes.length,
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

  otros: Big,
  abonoDirectoCapital: number
): Big => {
  return montoBoleta.minus(otros).minus(abonoDirectoCapital ?? 0);
};

/**
 * Calcula el disponible total (saldo + monto efectivo)
 */
const calcularDisponible = (saldoAFavor: Big, montoEfectivo: Big): Big => {
  return saldoAFavor.plus(montoEfectivo);
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

/**
 * Calcula los totales de inversionistas
 */
const calcularTotalesInversionistas = (inversionistas: any[]) => {
  let total_monto_cash_in = new Big(0);
  let total_iva_cash_in = new Big(0);
  let total_monto_inversionista = new Big(0);
  let total_iva_inversionista = new Big(0);

  inversionistas.forEach(
    ({
      monto_cash_in,
      iva_cash_in,
      monto_inversionista,
      iva_inversionista,
    }) => {
      total_monto_cash_in = total_monto_cash_in.plus(monto_cash_in);
      total_iva_cash_in = total_iva_cash_in.plus(iva_cash_in);
      total_monto_inversionista =
        total_monto_inversionista.plus(monto_inversionista);
      total_iva_inversionista = total_iva_inversionista.plus(iva_inversionista);
    }
  );

  return {
    total_monto_cash_in,
    total_iva_cash_in,
    total_monto_inversionista,
    total_iva_inversionista,
  };
};

/**
 * Calcula los abonos de una cuota
 */
const calcularAbonosCuota = (
  montoCuota: Big,
  credito: any,
  totalesInversionistas: ReturnType<typeof calcularTotalesInversionistas>
) => {
  const { total_monto_cash_in, total_monto_inversionista } =
    totalesInversionistas;

  const abono_interes = total_monto_inversionista.plus(total_monto_cash_in);
  const abono_iva_12 = new Big(credito.iva_12);
  const abono_seguro = new Big(credito.seguro_10_cuotas);
  const abono_gps = new Big(credito.gps);
  const abono_interes_ci = total_monto_cash_in;
  const abono_iva_ci = totalesInversionistas.total_iva_cash_in;

  const abono_capital = montoCuota
    .minus(abono_interes)
    .minus(abono_iva_12)
    .minus(abono_seguro)
    .minus(abono_gps)
    .minus(credito.membresias ?? 0);

  return {
    abono_capital,
    abono_interes,
    abono_iva_12,
    abono_seguro,
    abono_gps,
    abono_interes_ci,
    abono_iva_ci,
  };
};

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
      usuario_id,
      monto_boleta,
      fecha_pago,
      llamada,
      renuevo_o_nuevo,
      otros,
      observaciones,
      abono_directo_capital,
      cuotaApagar,
      url_boletas,
    } = parseResult.data;

    // 2. Preparar datos
    const urlCompletas = prepararURLsBoletas(url_boletas);
    const {
      credito,
      cuotasPendientes,
      inversionistas,
      saldoAFavor,
      mora, // ← NUEVO: Info de mora
      stats,
    } = await obtenerInfoCompletaCredito(credito_id, set);
    // 4. Calcular disponible
    const montoBoleta = new Big(monto_boleta);
    let moraBig = new Big(mora?.monto_mora ?? 0);
    const otrosBig = new Big(otros ?? 0);

    if (montoBoleta.eq(otrosBig)) {
      await insertarPago({
        numero_credito_sifco: credito.numero_credito_sifco,
        numero_cuota: cuotaApagar,
        cuotaId: cuotasPendientes.length > 0 ? cuotasPendientes[0].cuota_id : 0,
        otros: otrosBig.toNumber(),
        mora: 0,
        boleta: montoBoleta.toNumber(),
        urlBoletas: urlCompletas ?? [],
        pagado: true,
      });
    }
    const montoEfectivo = calcularMontoEfectivo(
      montoBoleta,

      otrosBig,
      abono_directo_capital ?? 0
    );
    let disponible = new Big(saldoAFavor).plus(montoEfectivo);
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
    let disponible_restante = disponible.minus(abono_directo_capital ?? 0);
    if (!resultadoMora.teniaMora) {
      console.log(
        "No tenía mora activa, se procede a registrar el pago normal."
      );
    } else {
      console.log("Resultado del pago de mora:", resultadoMora);
      if (resultadoMora.pagoCompleto && resultadoMora.moraPagada) {
        moraBig = new Big(resultadoMora.montoAplicadoMora);
        if (disponible_restante.lte(0))  {

          await insertarPago({
        numero_credito_sifco: credito.numero_credito_sifco,
        numero_cuota: cuotaApagar,
        cuotaId: cuotasPendientes.length > 0 ? cuotasPendientes[0].cuota_id : 0,
        otros: otrosBig.toNumber(),
        mora: resultadoMora.montoAplicadoMora,
        boleta: montoBoleta.toNumber(),
        urlBoletas: urlCompletas ?? [],
        pagado: true,
      });
        }
        console.log(
          "Mora pagada completamente, se procede a registrar el pago normal."
        );
      }
      if (!resultadoMora.moraPagada && resultadoMora.pagoParcial) {
        if (disponible_restante.lte(0))  {

          await insertarPago({
        numero_credito_sifco: credito.numero_credito_sifco,
        numero_cuota: cuotaApagar,
        cuotaId: cuotasPendientes.length > 0 ? cuotasPendientes[0].cuota_id : 0,
        otros: otrosBig.toNumber(),
        mora: resultadoMora.montoAplicadoMora,
        boleta: montoBoleta.toNumber(),
        urlBoletas: urlCompletas ?? [],
        pagado: true,
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
      if (disponible_restante.lte(0))  {

          await insertarPago({
        numero_credito_sifco: credito.numero_credito_sifco,
        numero_cuota: cuotaApagar,
        cuotaId: cuotasPendientes.length > 0 ? cuotasPendientes[0].cuota_id : 0,
        otros: otrosBig.toNumber(),
        mora: resultadoMora.montoAplicadoMora,
        boleta: montoBoleta.toNumber(),
        urlBoletas: urlCompletas ?? [],
        pagado: true,
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
    for (const cuota of cuotasPendientes) {
      console.log("\n===============================");
      console.log(
        `🚀 Procesando cuota #${cuota.numero_cuota} (Monto: $${montoCuota.toString()})`
      );
      console.log(
        `💰 Disponible antes de cuota: $${disponible_restante.toString()}`
      );
      if (disponible_restante.gt(0)) {
        // Verificar si existe pago previo
        const [existingPago] = await db
          .select({ pago: pagos_credito })
          .from(pagos_credito)
          .innerJoin(
            cuotas_credito,
            eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
          )
          .where(
            and(
              eq(cuotas_credito.numero_cuota, cuota.numero_cuota),
              eq(pagos_credito.pagado, false),
              eq(pagos_credito.credito_id, credito.credito_id)
            )
          )
          .limit(1);
        // Inicializar variables de abono
        // 2. OBTENER LOS RESTANTES DEL PAGO EXISTENTE (no de la cuota)
        const interes_restante = new Big(
          existingPago?.pago.interes_restante ?? 0
        );
        const iva_restante = new Big(existingPago?.pago.iva_12_restante ?? 0);
        const seguro_restante = new Big(
          existingPago?.pago.seguro_restante ?? 0
        );
        const gps_restante = new Big(existingPago?.pago.gps_restante ?? 0);
        const membresias_restante = new Big(existingPago?.pago.membresias ?? 0);
        const capital_restante_pago = new Big(
          existingPago?.pago.capital_restante ?? 0
        );

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

        console.log("🚀 Procesando pago para la cuota:", cuota.numero_cuota);

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
        const cuota_pagada =
          nuevo_interes_restante.eq(0) &&
          nuevo_iva_restante.eq(0) &&
          nuevo_seguro_restante.eq(0) &&
          nuevo_gps_restante.eq(0) &&
          nuevo_membresias_restante.eq(0) &&
          nuevo_capital_restante.eq(0);

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
        const paymentFalse = existingPago ? existingPago.pago.paymentFalse : false;
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
          numero_cuota: cuota.numero_cuota,
          llamada: llamada,
          fecha_pago,
          renuevo_o_nuevo: renuevo_o_nuevo,
          tipoCredito: "Renuevo",
          membresias: nuevo_membresias_restante.toString(),
          membresias_pago: abono_membresias.toString(),
          membresias_mes: abono_membresias.toString(),
          otros: otrosBig?.toString() ?? "0",
          mora: moraBig.toString(),
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
            if (pagoData.pagado) {
              cuotas_completas++;
              console.log(
                `✅ Cuota ${cuota.numero_cuota} PAGADA COMPLETAMENTE`
              );
              [pagoInsertado] = await db
                .update(pagos_credito)
                .set(pagoData)
                .from(cuotas_credito)
                .where(
                  and(
                    eq(cuotas_credito.numero_cuota, cuota.numero_cuota),
                    eq(pagos_credito.pago_id, existingPago.pago.pago_id),
                    eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
                  )
                )
                .returning();

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
                .from(cuotas_credito)
                .where(
                  and(
                    eq(cuotas_credito.numero_cuota, cuota.numero_cuota),
                    eq(pagos_credito.pago_id, existingPago.pago.pago_id),
                    eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
                  )
                )
                .returning();
              cuotas_parciales++;
              console.log(`⚠️ Cuota ${cuota.numero_cuota} con PAGO PARCIAL`);
              [pagoInsertado] = await db
                .insert(pagos_credito)
                .values({
                  // Campos requeridos del input
                  cuota_id: cuota.cuota_id,
                  monto_boleta: pagoData.monto_boleta,
                  renuevo_o_nuevo: pagoData.renuevo_o_nuevo,
                  credito_id: pagoData.credito_id,
                  // Campos que vienen del crédito/cuota
                  cuota: credito.cuota,
                  cuota_interes: credito.cuota_interes,
                  fecha_pago: new Date().toISOString(),
                  fecha_vencimiento: cuota.fecha_vencimiento,

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

                  // Membresías
                  membresias: pagoData.membresias,
                  membresias_pago: pagoData.membresias_pago,
                  membresias_mes: pagoData.membresias_mes,

                  // Campos adicionales del input
                  llamada: pagoData.llamada || "",
                  otros: pagoData.otros,
                  mora: pagoData.mora,
                  monto_boleta_cuota: pagoData.monto_boleta_cuota,
                  observaciones: pagoData.observaciones,

                  // Seguros y GPS
                  seguro_total: pagoData.seguro_total,
                  seguro_facturado: pagoData.seguro_facturado,
                  gps_facturado: pagoData.gps_facturado,
                  reserva: pagoData.reserva,

                  // Campos de estado
                  pagado: true,
                  facturacion: pagoData.facturacion || "si",
                  mes_pagado: pagoData.mes_pagado,
                  paymentFalse: pagoData.paymentFalse || false,
                  validationStatus: pagoData.validationStatus || "pending",
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
          if (disponible_restante.lte(0)) {
            break;
          }
        }
      }

      // 7. Procesar abono directo a capital (si aplica)
    }
    const hoy = new Date();
    const [cuotaActualData] = await db
      .select()
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, credito_id),
          gt(cuotas_credito.numero_cuota, 0),
          gte(cuotas_credito.fecha_vencimiento, hoy.toISOString().slice(0, 10))
        )
      )
      .orderBy(cuotas_credito.fecha_vencimiento)
      .limit(1);
    const abonoCapital = new Big(abono_directo_capital ?? 0);
    if (cuotaActualData.pagado && abonoCapital.gt(0)) {
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

      const monthPaymentsBig = new Big(
        (await getPagosDelMesActual(credito_id)) ?? 0
      ).plus(abonoCapital);
      const newCuota = await db.insert(cuotas_credito).values({
        credito_id: credito_id,
        numero_cuota: cuotaActualData.numero_cuota,
        fecha_vencimiento: cuotaActualData.fecha_vencimiento,
        pagado: true,
      }).returning();
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

        cuota_id: newCuota[0].cuota_id,
        numero_cuota: 0,
        llamada: llamada ?? "",
        fecha_pago,
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
    }else {
      await db
              .update(usuarios)
              .set({ saldo_a_favor: "0.00" })
              .where(eq(usuarios.usuario_id, credito.usuario_id));

            console.log("✅ Saldo a favor del usuario quedó en $0");
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
  numero_cuota: number; // opcional si no se especifica
  cuotaId: number; // opcional si no se especifica
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
  cuotaId,
  mora,
  otros,
  boleta,
  urlBoletas = [],
  pagado = true,
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

      capital_restante:   "0",
      interes_restante: "0",
      iva_12_restante: "0",
      seguro_restante: "0",
      gps_restante: "0",
      total_restante: "0",

      llamada: "",

      renuevo_o_nuevo: "renuevo",

      membresias:   "0",
      membresias_pago:   "0",
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
      if (pago.credito_id === null) {
        throw new Error("No se puede aplicar el abono: credito_id es null");
      }
      aplicarAbonoCapitalInversionistas(
        pago.credito_id,
        pago.abono_capital ?? "0",
        pago_id
      );
      console.log(
        "⚠️ El pago es un abono directo a capital"
      );
      return {
        success: true,
        applied: false,
        message: "Pago validado como abono a capital , se abonó a inversionistas correctamente",
      };
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
    // 2. VERIFICAR SI EL PAGO TIENE RESTANTES
    const interes_restante = new Big(pago.interes_restante ?? 0);
    const iva_restante = new Big(pago.iva_12_restante ?? 0);
    const seguro_restante = new Big(pago.seguro_restante ?? 0);
    const gps_restante = new Big(pago.gps_restante ?? 0);
    const membresias_restante = new Big(pago.membresias ?? 0);
    const capital_restante_pago = new Big(pago.capital_restante ?? 0);

    // ✅ Si CUALQUIER restante > 0 → NO está completo
    const tieneRestantes =
      interes_restante.gt(0) ||
      iva_restante.gt(0) ||
      seguro_restante.gt(0) ||
      gps_restante.gt(0) ||
      membresias_restante.gt(0) ||
      capital_restante_pago.gt(0);

    if (tieneRestantes) {
      console.log("⚠️ El pago tiene restantes pendientes:");
      console.log(
        `   💵 Capital restante: ${capital_restante_pago.toString()}`
      );
      console.log(`   💵 Interés restante: ${interes_restante.toString()}`);
      console.log(`   💵 IVA restante: ${iva_restante.toString()}`);
      console.log(`   💵 Seguro restante: ${seguro_restante.toString()}`);
      console.log(`   💵 GPS restante: ${gps_restante.toString()}`);
      console.log(
        `   💵 Membresías restante: ${membresias_restante.toString()}`
      );

      // Solo actualizar el pago para validarlo (NO aplica al crédito)
      await db
        .update(pagos_credito)
        .set({ validationStatus: "validated" })
        .where(eq(pagos_credito.pago_id, pago_id));

      return {
        success: true,
        applied: false,
        message:
          "Pago validado, pero no aplicado al crédito (tiene restantes pendientes)",
        restantes: {
          capital: capital_restante_pago.toString(),
          interes: interes_restante.toString(),
          iva: iva_restante.toString(),
          seguro: seguro_restante.toString(),
          gps: gps_restante.toString(),
          membresias: membresias_restante.toString(),
        },
      };
    }

    console.log("✅ Pago está completado, aplicando al crédito");

    // 3. OBTENER EL CRÉDITO ACTUAL
    if (pago.credito_id === null) {
      throw new Error("No se puede obtener el crédito: credito_id es null");
    }

    const [credito] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, pago.credito_id))
      .limit(1);

    if (!credito) {
      throw new Error(`Crédito ${pago.credito_id} no encontrado`);
    }

    // 4. CALCULAR NUEVO CAPITAL (restar el abono_capital del pago)
    const capital_actual = new Big(credito.capital ?? 0);
    const todosPagosCuota = await db
      .select({ abono_capital: pagos_credito.abono_capital })
      .from(pagos_credito)
      .where(and(eq(pagos_credito.cuota_id, pago.cuota_id), eq(pagos_credito.validationStatus, "validated")));

    let abono_capital_total = new Big(0);
    for (const p of todosPagosCuota) {
      abono_capital_total = abono_capital_total.plus(p.abono_capital ?? 0);
    }

    console.log(`💰 Total capital: ${abono_capital_total.toString()}`);
    const nuevo_capital = capital_actual.minus(abono_capital_total);

    console.log("💰 Capital actual:", capital_actual.toString());
    console.log("💰 Abono capital:", abono_capital_total.toString());
    console.log("💰 Nuevo capital:", nuevo_capital.toString());

    // 5. CALCULAR NUEVA DEUDA TOTAL
    const cuota_interes = new Big(nuevo_capital)
      .times(new Big(credito.porcentaje_interes).div(100))
      .round(2);
    const iva_12 = cuota_interes.times(0.12).round(2);
    const seguro = new Big(credito.seguro_10_cuotas ?? 0);
    const gps = new Big(credito.gps ?? 0);
    const membresias_pago = new Big(credito.membresias_pago ?? 0);

    const nueva_deuda_total = nuevo_capital
      .plus(cuota_interes)
      .plus(iva_12)
      .plus(seguro)
      .plus(gps)
      .plus(membresias_pago)
      .round(2);

    console.log("📊 Nueva deuda total:", nueva_deuda_total.toString());

    // 6. ACTUALIZAR EL CRÉDITO
    if (pago.credito_id !== null) {
      await db
        .update(creditos)
        .set({
          capital: nuevo_capital.toString(),
          deudatotal: nueva_deuda_total.toString(),
          iva_12: iva_12.toString(),
          cuota_interes: cuota_interes.toString(),
        })
        .where(eq(creditos.credito_id, pago.credito_id));
    } else {
      throw new Error("No se puede actualizar el crédito: credito_id es null");
    }

    // 7. VALIDAR EL PAGO
    await db
      .update(pagos_credito)
      .set({ validationStatus: "validated" })
      .where(eq(pagos_credito.pago_id, pago_id));

    await db
      .update(cuotas_credito)
      .set({ pagado: true })
      .where(eq(cuotas_credito.cuota_id, pago.cuota_id));

    console.log("✅ Crédito actualizado y pago validado");

    // 8. INSERTAR PAGOS DE INVERSIONISTAS (si no es un pago con paymentFalse)
    if (!pago.paymentFalse && pago.credito_id !== null) {
      await insertPagosCreditoInversionistas(pago_id, pago.credito_id);
      console.log("✅ Pagos a inversionistas insertados");
    }

    return {
      success: true,
      applied: true,
      message: "Pago aplicado al crédito exitosamente",
      data: {
        credito_id: pago.credito_id,
        capital_anterior: capital_actual.toString(),
        abono_capital: abono_capital_total.toString(),
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

  // 1️⃣ Obtener el crédito
  const [credito] = await db
    .select()
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id))
    .limit(1);

  if (!credito) {
    throw new Error("Crédito no encontrado");
  }

  const capitalTotal = new Big(credito.capital ?? 0);
  console.log(`💰 Capital Total: ${capitalTotal.toString()}`);

  // 2️⃣ Obtener inversionistas
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

  // 1️⃣.3 Limpiar saldo a favor del usuario
  await db
    .update(usuarios)
    .set({ saldo_a_favor: "0" })
    .where(eq(usuarios.usuario_id, credito.usuario_id));

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
        fecha_pago: new Date(),
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
  await db.update(pagos_credito)
    .set({ validationStatus: "validated" })
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
