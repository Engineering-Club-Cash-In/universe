import Big from "big.js";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
} from "../database/db";
import { findOrCreateInvestor } from "./investor";
import { updateInstallments } from "./updateCredit";

// ========================================
// INTERFACES
// ========================================

interface PagoParcial {
  fecha: string;
  numeroCuota: string;
  montoBoleta: string;
}

interface CreditoJson {
  numeroCredito: string;
  fechaUltimoPago: string;
  numeroCuota: string;
  cuota: string;
  montoBoleta: string;
  pagado: string;
  capitalRestante: string;
  inversionista: string;
  pago: string;
  pagosParciales: PagoParcial[];
}

interface CreditoAgrupado {
  numeroCredito: string;
  creditos: CreditoJson[];
}

// ========================================
// CÁLCULO DE DEUDA TOTAL
// ========================================

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
// FUNCIÓN PRINCIPAL
// ========================================

export async function recalcularCreditosDesdeJson(creditosAgrupados: CreditoAgrupado[]) {
  const resultados: {
    numeroCredito: string;
    status: "success" | "error" | "not_found";
    message: string;
    nuevoCapital?: string;
    inversionistas?: number;
  }[] = [];

  console.log(`\n🔄 ========== RECALCULANDO ${creditosAgrupados.length} CRÉDITOS ==========\n`);

  for (const grupo of creditosAgrupados) {
    const numeroBase = grupo.numeroCredito;
    console.log(`\n📋 Procesando crédito: ${numeroBase}`);
    console.log(`   Variaciones: ${grupo.creditos.length}`);

    try {
      // 1️⃣ Buscar el crédito en la BD
      const [creditoDB] = await db
        .select()
        .from(creditos)
        .where(eq(creditos.numero_credito_sifco, numeroBase))
        .limit(1);

      if (!creditoDB) {
        console.log(`   ⚠️ Crédito no encontrado en BD`);
        resultados.push({
          numeroCredito: numeroBase,
          status: "not_found",
          message: "Crédito no encontrado en la base de datos",
        });
        continue;
      }

      console.log(`   ✅ Crédito encontrado (ID: ${creditoDB.credito_id})`);

      // 2️⃣ Sumar los capitalRestante de todos los inversionistas
      let nuevoCapital = new Big(0);
      const inversionistasData: {
        nombre: string;
        capitalRestante: Big;
      }[] = [];

      for (const credito of grupo.creditos) {
        const capitalRestante = new Big(credito.capitalRestante || 0);
        nuevoCapital = nuevoCapital.plus(capitalRestante);

        inversionistasData.push({
          nombre: credito.inversionista,
          capitalRestante: capitalRestante,
        });

        console.log(`   💰 ${credito.inversionista}: Q${capitalRestante.toFixed(2)}`);
      }

      console.log(`   📊 Capital Total Calculado: Q${nuevoCapital.toFixed(2)}`);

      // 3️⃣ Obtener porcentajes existentes antes de eliminar
      const inversionistasExistentes = await db
        .select({
          inversionista_id: creditos_inversionistas.inversionista_id,
          porcentaje_participacion_inversionista: creditos_inversionistas.porcentaje_participacion_inversionista,
          porcentaje_cash_in: creditos_inversionistas.porcentaje_cash_in,
        })
        .from(creditos_inversionistas)
        .where(eq(creditos_inversionistas.credito_id, creditoDB.credito_id));

      const porcentajesMap = new Map<number, { porcentajeInversion: string; porcentajeCashIn: string }>();
      for (const ie of inversionistasExistentes) {
        porcentajesMap.set(ie.inversionista_id, {
          porcentajeInversion: ie.porcentaje_participacion_inversionista,
          porcentajeCashIn: ie.porcentaje_cash_in,
        });
      }

      // Eliminar inversionistas existentes
      await db
        .delete(creditos_inversionistas)
        .where(eq(creditos_inversionistas.credito_id, creditoDB.credito_id));
      console.log(`   🗑️ Inversionistas anteriores eliminados`);

      // 4️⃣ Recalcular deuda total con el nuevo capital
      const nuevaDeuda = calcularDeudaTotal({
        capital: nuevoCapital.toNumber(),
        porcentaje_interes: Number(creditoDB.porcentaje_interes),
        seguro_10_cuotas: Number(creditoDB.seguro_10_cuotas ?? 0),
        membresias_pago: Number(creditoDB.membresias_pago ?? 0),
        otros: Number(creditoDB.otros ?? 0),
        gps: Number(creditoDB.gps ?? 0),
        cuota: Number(creditoDB.cuota ?? 0),
        plazo: Number(creditoDB.plazo ?? 0),
      });

      console.log(`   📈 Nueva Deuda Total: Q${nuevaDeuda.totalDeuda}`);

      // 5️⃣ Actualizar el crédito
      await db
        .update(creditos)
        .set({
          capital: nuevaDeuda.capital,
          deudatotal: nuevaDeuda.totalDeuda,
          cuota_interes: nuevaDeuda.interes,
          iva_12: nuevaDeuda.iva_12,
        })
        .where(eq(creditos.credito_id, creditoDB.credito_id));

      console.log(`   ✅ Crédito actualizado`);

      // 6️⃣ Crear nuevos inversionistas
      const porcentajeInteres = new Big(creditoDB.porcentaje_interes ?? 0);
      const seguro = new Big(creditoDB.seguro_10_cuotas ?? 0);
      const membresias = new Big(creditoDB.membresias_pago ?? 0);
      const cuotaTotal = new Big(creditoDB.cuota ?? 0);

      // Encontrar al inversionista con mayor capital para asignarle seguro y membresía
      const inversionistaMayor = inversionistasData.reduce((max, current) =>
        current.capitalRestante.gt(max.capitalRestante) ? current : max
      );

      for (const inv of inversionistasData) {
        // Buscar o crear inversionista
        const investor = await findOrCreateInvestor(inv.nombre, true);

        // El monto aportado es igual al capital restante
        const montoAportado = inv.capitalRestante;

        // Calcular porcentaje de participación
        const porcentajeParticipacion = nuevoCapital.gt(0)
          ? montoAportado.div(nuevoCapital).times(100)
          : new Big(0);

        // Calcular interés
        const interesInv = montoAportado.times(porcentajeInteres.div(100)).round(2);

        // Obtener porcentajes de la DB, fallback a 70/30
        const porcentajesExistentes = porcentajesMap.get(investor.inversionista_id);
        const porcentajeInversion = new Big(porcentajesExistentes?.porcentajeInversion ?? 70);
        const porcentajeCashIn = new Big(porcentajesExistentes?.porcentajeCashIn ?? 30);

        const montoInversionista = interesInv.times(porcentajeInversion.div(100)).round(2);
        const montoCashIn = interesInv.times(porcentajeCashIn.div(100)).round(2);

        const ivaInversionista = montoInversionista.gt(0)
          ? montoInversionista.times(0.12).round(2)
          : new Big(0);
        const ivaCashIn = montoCashIn.gt(0)
          ? montoCashIn.times(0.12).round(2)
          : new Big(0);

        // Calcular cuota del inversionista
        const cuotaSinCargos = cuotaTotal.minus(seguro).minus(membresias);
        let cuotaInversionista = cuotaSinCargos.times(porcentajeParticipacion.div(100)).round(2);

        // Si es el inversionista mayor, sumarle seguro y membresía
        if (inv.nombre === inversionistaMayor.nombre) {
          cuotaInversionista = cuotaInversionista.plus(seguro).plus(membresias).round(2);
        }

        // Insertar inversionista
        await db.insert(creditos_inversionistas).values({
          credito_id: creditoDB.credito_id,
          inversionista_id: investor.inversionista_id,
          monto_aportado: montoAportado.round(2).toString(),
          porcentaje_cash_in: porcentajeCashIn.toString(),
          porcentaje_participacion_inversionista: porcentajeInversion.toString(),
          monto_inversionista: montoInversionista.toString(),
          monto_cash_in: montoCashIn.toString(),
          iva_inversionista: ivaInversionista.toString(),
          iva_cash_in: ivaCashIn.toString(),
          fecha_creacion: new Date(),
          cuota_inversionista: cuotaInversionista.toString(),
        });

        console.log(`   👤 Inversionista creado: ${investor.nombre} (Q${montoAportado.toFixed(2)})`);
      }

      // 7️⃣ Actualizar cuotas pendientes
      try {
        await updateInstallments({
          numero_credito_sifco: numeroBase,
          nueva_cuota: Number(creditoDB.cuota),
        });
        console.log(`   📅 Cuotas actualizadas`);
      } catch (err) {
        console.log(`   ⚠️ No se pudieron actualizar las cuotas: ${err}`);
      }

      resultados.push({
        numeroCredito: numeroBase,
        status: "success",
        message: "Crédito recalculado correctamente",
        nuevoCapital: nuevoCapital.toFixed(2),
        inversionistas: inversionistasData.length,
      });

    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
      resultados.push({
        numeroCredito: numeroBase,
        status: "error",
        message: error.message || "Error desconocido",
      });
    }
  }

  // Resumen
  const exitosos = resultados.filter(r => r.status === "success").length;
  const errores = resultados.filter(r => r.status === "error").length;
  const noEncontrados = resultados.filter(r => r.status === "not_found").length;

  console.log(`\n📊 ========== RESUMEN ==========`);
  console.log(`✅ Exitosos: ${exitosos}`);
  console.log(`❌ Errores: ${errores}`);
  console.log(`⚠️ No encontrados: ${noEncontrados}`);
  console.log(`📋 Total: ${resultados.length}`);

  return {
    success: exitosos > 0,
    total: resultados.length,
    exitosos,
    errores,
    noEncontrados,
    detalles: resultados,
  };
}

// ========================================
// FUNCIÓN PARA LEER JSON Y AGRUPAR
// ========================================

export function agruparCreditosPorNumeroBase(creditosJson: CreditoJson[]): CreditoAgrupado[] {
  const grupos: Map<string, CreditoJson[]> = new Map();

  for (const credito of creditosJson) {
    // Extraer el número base (sin _2, _3, etc.)
    const numeroBase = credito.numeroCredito.split("_")[0];

    if (!grupos.has(numeroBase)) {
      grupos.set(numeroBase, []);
    }
    grupos.get(numeroBase)!.push(credito);
  }

  return Array.from(grupos.entries()).map(([numeroCredito, creditos]) => ({
    numeroCredito,
    creditos,
  }));
}
