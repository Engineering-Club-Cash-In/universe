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
} from "../database/db";
import { eq, and, lte, asc, sql } from "drizzle-orm";
import { updateMora } from "./latefee";
import { insertPagosCreditoInversionistas } from "./payments";

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
  console.log("\n🔍 Verificando mora activa...")
  console.log("stats:", stats );
  console.log("mora:", mora );
  console.log("disponible:", disponible.toString() );
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
          eq(creditos.statusCredit, "ACTIVO")
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
        pagado: false,
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
    if (!resultadoMora.teniaMora) {
      console.log(
        "No tenía mora activa, se procede a registrar el pago normal."
      );
    } else{
      console.log("Resultado del pago de mora:", resultadoMora);
      if (resultadoMora.pagoCompleto && resultadoMora.moraPagada) {
      moraBig = new Big(resultadoMora.montoAplicadoMora);
      console.log(
        "Mora pagada completamente, se procede a registrar el pago normal."
      );
    }
    if (!resultadoMora.moraPagada && resultadoMora.pagoParcial) {
      return {
        message:  `Pago parcial de mora aplicado. Saldo pendiente de mora: $${resultadoMora.saldoMoraRestante}. Por favor, cancele la mora pendiente para continuar con el pago de cuotas.`,
        pagos: [],
        saldo_a_favor: disponible.toString(),
      };
    }
      
    }
    
    if (!resultadoMora.moraPagada && resultadoMora.montoAplicadoMora > 0) {
      await insertarPago({
        numero_credito_sifco: credito.numero_credito_sifco,
        numero_cuota: cuotaApagar,
        cuotaId: cuotasPendientes.length > 0 ? cuotasPendientes[0].cuota_id : 0,
        otros: otrosBig.toNumber(),
        mora: resultadoMora.montoAplicadoMora,
        boleta: montoBoleta.toNumber(),
        urlBoletas: urlCompletas ?? [],
        pagado: false,
      });
      return {
        message: `Pago parcial de mora aplicado. Saldo pendiente de mora: $${resultadoMora.saldoMoraRestante}. Por favor, cancele la mora pendiente para continuar con el pago de cuotas.`,
        pagos: [],
        saldo_a_favor: disponible.toString(),
      };
    }

    // Actualizar disponible
    disponible = new Big(resultadoMora.disponibleRestante);

    for (const cuota of cuotasPendientes) {
      const montoCuota = new Big(credito.cuota);
      let disponible_restante = disponible;
      if (disponible_restante.gte(0)) {
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
        const membresias_restante = new Big(
          existingPago?.pago.membresias_mes ?? 0
        );
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

        // 3. APLICAR DISPONIBLE EN CASCADA (solo a lo que tiene saldo > 0)

        // 3.1 Pagar interés
        if (disponible_restante.gt(0) && interes_restante.gt(0)) {
          const pago = disponible_restante.lt(interes_restante)
            ? disponible_restante
            : interes_restante;
          abono_interes = pago;
          disponible_restante = disponible_restante.minus(pago);
        }

        // 3.2 Pagar IVA
        if (disponible_restante.gt(0) && iva_restante.gt(0)) {
          const pago = disponible_restante.lt(iva_restante)
            ? disponible_restante
            : iva_restante;
          abono_iva_12 = pago;
          disponible_restante = disponible_restante.minus(pago);
        }

        // 3.3 Pagar seguro
        if (disponible_restante.gt(0) && seguro_restante.gt(0)) {
          const pago = disponible_restante.lt(seguro_restante)
            ? disponible_restante
            : seguro_restante;
          abono_seguro = pago;
          disponible_restante = disponible_restante.minus(pago);
        }

        // 3.4 Pagar GPS
        if (disponible_restante.gt(0) && gps_restante.gt(0)) {
          const pago = disponible_restante.lt(gps_restante)
            ? disponible_restante
            : gps_restante;
          abono_gps = pago;
          disponible_restante = disponible_restante.minus(pago);
        }

        // 3.5 Pagar membresías
        if (disponible_restante.gt(0) && membresias_restante.gt(0)) {
          const pago = disponible_restante.lt(membresias_restante)
            ? disponible_restante
            : membresias_restante;
          abono_membresias = pago;
          disponible_restante = disponible_restante.minus(pago);
        }

        // 3.6 Pagar capital
        if (disponible_restante.gt(0) && capital_restante_pago.gt(0)) {
          const pago = disponible_restante.lt(capital_restante_pago)
            ? disponible_restante
            : capital_restante_pago;
          abono_capital = pago;
          disponible_restante = disponible_restante.minus(pago);
        }

        // 4. CALCULAR NUEVOS RESTANTES
        const nuevo_interes_restante = interes_restante.minus(abono_interes);
        const nuevo_iva_restante = iva_restante.minus(abono_iva_12);
        const nuevo_seguro_restante = seguro_restante.minus(abono_seguro);
        const nuevo_gps_restante = gps_restante.minus(abono_gps);
        const nuevo_membresias_restante =
          membresias_restante.minus(abono_membresias);
        const nuevo_capital_restante =
          capital_restante_pago.minus(abono_capital);
        // Obtener pago del mes
        const pago_del_mes = await getPagosDelMesActual(credito.credito_id);
        const pago_del_mesBig = new Big(pago_del_mes ?? 0).add(
          montoBoleta ?? 0
        );

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
          fecha_filtro: fecha_pago,
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
        };

        // Insertar o actualizar pago
        type PagoCredito = typeof pagos_credito.$inferSelect;
        let pagoInsertado: PagoCredito | undefined;

        if (existingPago) {
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

          console.log("cuota_id:", cuota);
          console.log("pagoInsertado:", pagoInsertado);

          if (disponible_restante.lt(0)) {
            db.update(usuarios).set({
              saldo_a_favor: new Big(0).toString(),
            });
            console.log("Saldo a favor del usuario quedó en $0");
            console.log("pago realizado con exito");
          }
        }
      }

      // 7. Procesar abono directo a capital (si aplica)
      const abonoCapital = new Big(abono_directo_capital ?? 0);
      if (cuotasPendientes.length === 0 && abonoCapital.gt(0)) {
        // ... (lógica de abono directo a capital - muy extensa para incluir aquí)
        // La incluirías en una función separada llamada procesarAbonoDirectoCapital
      }
    }
  } catch (error) {
    console.error("[insertPayment] Error:", error);
    set.status = 500;
    return {
      message: "Internal server error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};export async function getPagosDelMesActual(credito_id: number) {
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
      fecha_filtro: pagos_credito.fecha_filtro,
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
      validationStatus: 'pending',
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

    // 2. VERIFICAR SI EL PAGO ESTÁ PAGADO
    if (!pago.pagado) {
      console.log("⚠️ El pago NO está completado, solo se valida");

      // Solo actualizar el pago para validarlo
      await db
        .update(pagos_credito)
        .set({ validationStatus: 'validated' })
        .where(eq(pagos_credito.pago_id, pago_id));

      return {
        success: true,
        applied: false,
        message: "Pago validado, pero no aplicado al crédito (pagado = false)",
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
    const abono_capital_pago = new Big(pago.abono_capital ?? 0);
    const nuevo_capital = capital_actual.minus(abono_capital_pago);

    console.log("💰 Capital actual:", capital_actual.toString());
    console.log("💰 Abono capital:", abono_capital_pago.toString());
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
      .set({ validationStatus: 'validated' })
      .where(eq(pagos_credito.pago_id, pago_id));

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
