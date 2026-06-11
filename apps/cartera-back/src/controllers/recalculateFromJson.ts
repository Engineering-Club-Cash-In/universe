import Big from "big.js";
import { eq, and, inArray } from "drizzle-orm";
import fs from "fs";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  cuotas_credito,
  pagos_credito,
  pagos_credito_inversionistas,
  boletas,
  efectividad_asesores,
} from "../database/db";
import { findOrCreateInvestor } from "./investor";
import { updateInstallments } from "./updateCredit";
import { marcarCuotasPagadasHastaNumero } from "./migratePayments";

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
  fechaUltimoPago?: string;
  numeroCuota?: string;
  cuota?: string;
  montoBoleta?: string;
  pagado?: string;
  capitalRestante: string;
  inversionista: string;
  pago?: string;
  pagosParciales?: PagoParcial[];
}

interface InversionistaActual {
  numeroCredito: string;
  inversionista: string;
  porcentajeCashIn: string;
  porcentajeInversionista: string;
  capital: string;
  cuota?: string;
}

interface CreditoAgrupado {
  numeroCredito: string;
  creditos: CreditoJson[];
  inversionistasActuales?: InversionistaActual[];
}

interface PoolRaro {
  nombre: string;
  numeroCuota?: string;
  numeroCredito: string;
  creditos: CreditoJson[];
}

interface CreditoEliminar {
  numeroCredito: string;
  inversionista: string;
  capitalRestante?: string;
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

      // 3️⃣ Obtener porcentajes existentes antes de eliminar (solo si no hay inversionistasActuales)
      const tieneInversionistasActuales = grupo.inversionistasActuales && grupo.inversionistasActuales.length > 0;

      let porcentajesMap = new Map<number, { porcentajeInversion: string; porcentajeCashIn: string }>();

      if (!tieneInversionistasActuales) {
        const inversionistasExistentes = await db
          .select({
            inversionista_id: creditos_inversionistas.inversionista_id,
            porcentaje_participacion_inversionista: creditos_inversionistas.porcentaje_participacion_inversionista,
            porcentaje_cash_in: creditos_inversionistas.porcentaje_cash_in,
          })
          .from(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, creditoDB.credito_id));

        for (const ie of inversionistasExistentes) {
          porcentajesMap.set(ie.inversionista_id, {
            porcentajeInversion: ie.porcentaje_participacion_inversionista,
            porcentajeCashIn: ie.porcentaje_cash_in,
          });
        }
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
      const gps = new Big(creditoDB.gps ?? 0);
      const membresias = new Big(creditoDB.membresias_pago ?? 0);
      const cuotaTotal = new Big(creditoDB.cuota ?? 0);

      if (tieneInversionistasActuales) {
        // ✅ Usar inversionistasActuales del JSON
        console.log(`   📋 Usando inversionistasActuales del JSON (${grupo.inversionistasActuales!.length})`);

        // Agrupar inversionistas duplicados (mismo nombre) sumando capital y cuota
        const inversionistasAgrupados = new Map<string, InversionistaActual>();
        for (const inv of grupo.inversionistasActuales!) {
          const existing = inversionistasAgrupados.get(inv.inversionista);
          if (existing) {
            existing.capital = new Big(existing.capital || 0).plus(new Big(inv.capital || 0)).toString();
            existing.cuota = new Big(existing.cuota || 0).plus(new Big(inv.cuota || 0)).toString();
            console.log(`   🔀 ${inv.inversionista} duplicado → sumando capital y cuota`);
          } else {
            inversionistasAgrupados.set(inv.inversionista, { ...inv });
          }
        }

        const inversionistasUnicos = Array.from(inversionistasAgrupados.values());
        console.log(`   📊 Inversionistas únicos: ${inversionistasUnicos.length}`);

        // Encontrar al inversionista con mayor capital
        const inversionistaMayor = inversionistasUnicos.reduce((max, current) =>
          new Big(current.capital || 0).gt(new Big(max.capital || 0)) ? current : max
        );

        for (const invActual of inversionistasUnicos) {
          const investor = await findOrCreateInvestor(invActual.inversionista, true);

          const montoAportado = new Big(invActual.capital || 0);

          // Calcular porcentaje de participacion
          const porcentajeParticipacion = nuevoCapital.gt(0)
            ? montoAportado.div(nuevoCapital).times(100)
            : new Big(0);

          // Calcular interes
          const interesInv = montoAportado.times(porcentajeInteres.div(100)).round(2);

          // Porcentajes del JSON (0.2 -> 20, 0.8 -> 80)
          const porcentajeInversion = new Big(invActual.porcentajeInversionista || 0.7).times(100);
          const porcentajeCashIn = new Big(invActual.porcentajeCashIn || 0.3).times(100);

          const montoInversionista = interesInv.times(porcentajeInversion.div(100)).round(2);
          const montoCashIn = interesInv.times(porcentajeCashIn.div(100)).round(2);

          const ivaInversionista = montoInversionista.gt(0)
            ? montoInversionista.times(0.12).round(2)
            : new Big(0);
          const ivaCashIn = montoCashIn.gt(0)
            ? montoCashIn.times(0.12).round(2)
            : new Big(0);

          // Cuota del inversionista: viene directo en inversionistasActuales
          let cuotaInversionista: Big;

          if (invActual.cuota) {
            cuotaInversionista = new Big(invActual.cuota);
            console.log(`   💵 Cuota de ${invActual.inversionista}: Q${cuotaInversionista.toFixed(2)} (del JSON)`);
          } else {
            // Fallback: calcular proporcionalmente
            const cuotaSinCargos = cuotaTotal.minus(seguro).minus(gps).minus(membresias);
            cuotaInversionista = cuotaSinCargos.times(porcentajeParticipacion.div(100)).round(6);
            if (invActual.inversionista === inversionistaMayor.inversionista) {
              cuotaInversionista = cuotaInversionista.plus(seguro).plus(gps).plus(membresias).round(6);
            }
            console.log(`   💵 Cuota de ${invActual.inversionista}: Q${cuotaInversionista.toFixed(6)} (calculada)`);
          }

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

          console.log(`   👤 Inversionista creado: ${investor.nombre} (Q${montoAportado.toFixed(2)}) [${porcentajeInversion}/${porcentajeCashIn}]`);
        }
      } else {
        // Flujo original: usar creditos + porcentajes de la BD
        // Encontrar al inversionista con mayor capital para asignarle seguro y membresia
        const inversionistaMayor = inversionistasData.reduce((max, current) =>
          current.capitalRestante.gt(max.capitalRestante) ? current : max
        );

        for (const inv of inversionistasData) {
          const investor = await findOrCreateInvestor(inv.nombre, true);

          const montoAportado = inv.capitalRestante;

          // Calcular porcentaje de participacion
          const porcentajeParticipacion = nuevoCapital.gt(0)
            ? montoAportado.div(nuevoCapital).times(100)
            : new Big(0);

          // Calcular interes
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
          const cuotaSinCargos = cuotaTotal.minus(seguro).minus(gps).minus(membresias);
          let cuotaInversionista = cuotaSinCargos.times(porcentajeParticipacion.div(100)).round(6);

          // Si es el inversionista mayor, sumarle seguro, gps y membresia
          if (inv.nombre === inversionistaMayor.nombre) {
            cuotaInversionista = cuotaInversionista.plus(seguro).plus(gps).plus(membresias).round(6);
          }

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

// ========================================
// PROCESAR POOLS RAROS
// ========================================

export async function processPoolsRaros(pools: PoolRaro[]) {
  console.log(`\n🔄 ========== PROCESANDO ${pools.length} POOLS RAROS ==========\n`);

  // Separar: creditos que coinciden con el pool → recalcular
  //          creditos con numero diferente → eliminar de la BD
  const creditosParaRecalcular: CreditoAgrupado[] = [];
  const creditosParaEliminar: CreditoEliminar[] = [];

  for (const pool of pools) {
    const numeroBasePool = pool.numeroCredito.split("_")[0];
    const creditosDelPool: CreditoJson[] = [];

    for (const credito of pool.creditos) {
      const numeroBaseCredito = credito.numeroCredito.split("_")[0];

      if (numeroBaseCredito === numeroBasePool) {
        // Coincide con el pool → asignar al credito principal
        creditosDelPool.push(credito);
      } else {
        // Numero diferente → eliminar ese credito de la BD
        creditosParaEliminar.push({
          numeroCredito: numeroBaseCredito,
          inversionista: credito.inversionista,
          capitalRestante: credito.capitalRestante,
        });
        // Pero el inversionista va al credito principal con su capital
        creditosDelPool.push({
          ...credito,
          numeroCredito: numeroBasePool, // Reasignar al credito correcto
        });
        console.log(`   🔀 ${credito.inversionista}: ${numeroBaseCredito} → ${numeroBasePool} (credito ${numeroBaseCredito} se eliminará)`);
      }
    }

    if (creditosDelPool.length > 0) {
      creditosParaRecalcular.push({
        numeroCredito: numeroBasePool,
        creditos: creditosDelPool,
      });
    }
  }

  console.log(`📋 Créditos a recalcular: ${creditosParaRecalcular.length}`);
  console.log(`🗑️ Créditos a eliminar: ${creditosParaEliminar.length}`);

  // 1. Primero eliminar los creditos que no corresponden
  let resultadoEliminacion = null;
  if (creditosParaEliminar.length > 0) {
    resultadoEliminacion = await eliminarCreditos(creditosParaEliminar);
  }

  // 2. Luego recalcular los creditos correctos con todos sus inversionistas
  const resultadoRecalculo = await recalcularCreditosDesdeJson(creditosParaRecalcular);

  // 3. Leer resultado_ultimos_pagos.json para obtener la cuota correcta por crédito
  const rutaUltimosPagos =
    "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\resultado_ultimos_pagos.json";

  let mapaUltimosPagos = new Map<string, { numeroCuota: number; fechaPago: string | null; cuota: number }>();

  if (fs.existsSync(rutaUltimosPagos)) {
    const contenidoPagos = fs.readFileSync(rutaUltimosPagos, "utf-8");
    const ultimosPagos: CreditoAgrupado[] = JSON.parse(contenidoPagos);

    for (const grupo of ultimosPagos) {
      const numeroBase = grupo.numeroCredito.split("_")[0];
      // Tomar el numeroCuota más alto y la cuota sumada de todos los créditos del grupo
      let maxCuota = 0;
      let fechaPago: string | null = null;
      let cuotaTotal = 0;

      for (const c of grupo.creditos) {
        const nCuota = parseInt(c.numeroCuota ?? "0", 10);
        if (nCuota > maxCuota) {
          maxCuota = nCuota;
        }
        if (c.pago && !fechaPago) {
          fechaPago = c.pago;
        }
        cuotaTotal += Number(c.cuota ?? 0);
      }

      if (maxCuota > 0) {
        mapaUltimosPagos.set(numeroBase, { numeroCuota: maxCuota, fechaPago, cuota: cuotaTotal });
      }
    }
    console.log(`📂 Últimos pagos cargados: ${mapaUltimosPagos.size} créditos`);
  } else {
    console.log(`⚠️ No se encontró ${rutaUltimosPagos}, se usará numeroCuota del pool`);
  }

  // 4. Marcar cuotas pagadas y recalcular cuotas por crédito
  console.log(`\n📅 ========== MARCANDO CUOTAS PAGADAS ==========\n`);
  let cuotasMarcadas = 0;
  let cuotasError = 0;
  let cuotasRecalculadas = 0;

  for (const pool of pools) {
    const numeroBasePool = pool.numeroCredito.split("_")[0];

    // Buscar cuota en el JSON de últimos pagos, fallback al pool
    const datosUltimoPago = mapaUltimosPagos.get(numeroBasePool);
    const numeroCuota = datosUltimoPago?.numeroCuota ?? parseInt(pool.numeroCuota ?? "0", 10);
    const fechaPago = datosUltimoPago?.fechaPago ?? pool.creditos.find(c => c.pago)?.pago ?? null;
    const cuotaCredito = datosUltimoPago?.cuota ?? 0;

    if (numeroCuota <= 0) continue;

    try {
      console.log(`   ${numeroBasePool}: marcando hasta cuota ${numeroCuota} (pago: ${fechaPago})`);
      await marcarCuotasPagadasHastaNumero({
        numero_credito_sifco: numeroBasePool,
        hasta_cuota: numeroCuota,
        fecha_primer_pago: fechaPago ?? undefined,
      });
      cuotasMarcadas++;
    } catch (err) {
      cuotasError++;
      console.log(`   ⚠️ Error marcando cuotas ${numeroBasePool}: ${err}`);
    }

    // Recalcular cuotas del crédito con updateInstallments
    if (cuotaCredito > 0) {
      try {
        await updateInstallments({
          numero_credito_sifco: numeroBasePool,
          nueva_cuota: cuotaCredito,
        });
        cuotasRecalculadas++;
        console.log(`   ✅ ${numeroBasePool}: cuotas recalculadas (cuota: ${cuotaCredito})`);
      } catch (err) {
        console.log(`   ⚠️ Error recalculando cuotas ${numeroBasePool}: ${err}`);
      }
    }
  }

  console.log(`\n📊 Cuotas marcadas: ${cuotasMarcadas}, Recalculadas: ${cuotasRecalculadas}, Errores: ${cuotasError}`);

  return {
    success: resultadoRecalculo.success || (resultadoEliminacion?.success ?? false),
    recalculo: resultadoRecalculo,
    eliminacion: resultadoEliminacion,
    cuotas: { marcadas: cuotasMarcadas, recalculadas: cuotasRecalculadas, errores: cuotasError },
  };
}

// ========================================
// ELIMINAR CRÉDITOS COMPLETOS DE LA BD
// ========================================

export async function eliminarCreditos(creditosEliminar: CreditoEliminar[]) {
  // Agrupar por numero base para no eliminar el mismo credito varias veces
  const numerosUnicos = new Map<string, CreditoEliminar>();
  for (const item of creditosEliminar) {
    const numeroBase = item.numeroCredito.split("_")[0];
    if (!numerosUnicos.has(numeroBase)) {
      numerosUnicos.set(numeroBase, { ...item, numeroCredito: numeroBase });
    }
  }

  const resultados: {
    numeroCredito: string;
    status: "success" | "error" | "not_found";
    message: string;
  }[] = [];

  console.log(`\n🗑️ ========== ELIMINANDO ${numerosUnicos.size} CRÉDITOS COMPLETOS ==========\n`);

  for (const [numeroBase] of numerosUnicos) {
    console.log(`\n📋 Eliminando crédito: ${numeroBase}`);

    try {
      // 1. Buscar credito
      const [creditoDB] = await db
        .select({ credito_id: creditos.credito_id })
        .from(creditos)
        .where(eq(creditos.numero_credito_sifco, numeroBase))
        .limit(1);

      if (!creditoDB) {
        console.log(`   ⚠️ Crédito ${numeroBase} no encontrado en BD`);
        resultados.push({
          numeroCredito: numeroBase,
          status: "not_found",
          message: "Crédito no encontrado en la base de datos",
        });
        continue;
      }

      const creditoId = creditoDB.credito_id;

      // 2. Obtener pago_ids para limpiar boletas
      const pagos = await db
        .select({ pago_id: pagos_credito.pago_id })
        .from(pagos_credito)
        .where(eq(pagos_credito.credito_id, creditoId));

      const pagoIds = pagos.map(p => p.pago_id);

      // 3. Eliminar en orden (respetando FKs sin CASCADE)
      if (pagoIds.length > 0) {
        // Boletas (referencia pago_id sin CASCADE)
        await db
          .delete(boletas)
          .where(inArray(boletas.pago_id, pagoIds));
        console.log(`   🗑️ Boletas eliminadas (${pagoIds.length} pagos)`);

        // Pagos inversionistas (referencia pago_id y credito_id sin CASCADE)
        await db
          .delete(pagos_credito_inversionistas)
          .where(eq(pagos_credito_inversionistas.credito_id, creditoId));
        console.log(`   🗑️ Pagos inversionistas eliminados`);

        // Pagos credito (referencia credito_id sin CASCADE)
        await db
          .delete(pagos_credito)
          .where(eq(pagos_credito.credito_id, creditoId));
        console.log(`   🗑️ Pagos eliminados`);
      }

      // Cuotas (referencia credito_id sin CASCADE)
      await db
        .delete(cuotas_credito)
        .where(eq(cuotas_credito.credito_id, creditoId));
      console.log(`   🗑️ Cuotas eliminadas`);

      // Inversionistas del credito (sin CASCADE)
      await db
        .delete(creditos_inversionistas)
        .where(eq(creditos_inversionistas.credito_id, creditoId));
      console.log(`   🗑️ Inversionistas eliminados`);

      // Efectividad asesores (sin CASCADE)
      await db
        .delete(efectividad_asesores)
        .where(eq(efectividad_asesores.credito_id, creditoId));
      console.log(`   🗑️ Efectividad asesores eliminada`);

      // 4. Eliminar el credito (CASCADE borra: moras, condonaciones, rubros, cancelaciones, bad_debts, montos_adicionales, convenios)
      // facturas_electronicas pone pago_id en NULL automaticamente (SET NULL)
      await db
        .delete(creditos)
        .where(eq(creditos.credito_id, creditoId));
      console.log(`   ✅ Crédito ${numeroBase} eliminado completamente`);

      resultados.push({
        numeroCredito: numeroBase,
        status: "success",
        message: "Crédito eliminado completamente de la base de datos",
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

  const exitosos = resultados.filter(r => r.status === "success").length;
  const errores = resultados.filter(r => r.status === "error").length;
  const noEncontrados = resultados.filter(r => r.status === "not_found").length;

  console.log(`\n📊 ========== RESUMEN ELIMINACION ==========`);
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
// ACTUALIZAR SOLO CUOTAS DE INVERSIONISTAS
// ========================================

export async function actualizarCuotasInversionistas(creditosAgrupados: CreditoAgrupado[]) {
  const resultados: {
    numeroCredito: string;
    status: "success" | "error" | "not_found" | "sin_cuotas";
    message: string;
    inversionistasActualizados?: number;
  }[] = [];

  console.log(`\n🔄 ========== ACTUALIZANDO CUOTAS DE ${creditosAgrupados.length} CRÉDITOS ==========\n`);

  for (const grupo of creditosAgrupados) {
    const numeroBase = grupo.numeroCredito;
    console.log(`\n📋 Procesando crédito: ${numeroBase}`);

    if (!grupo.inversionistasActuales || grupo.inversionistasActuales.length === 0) {
      console.log(`   ⚠️ No tiene inversionistasActuales con cuotas`);
      resultados.push({
        numeroCredito: numeroBase,
        status: "sin_cuotas",
        message: "No se proporcionaron inversionistasActuales",
      });
      continue;
    }

    try {
      // 1. Buscar el crédito
      const [creditoDB] = await db
        .select({ credito_id: creditos.credito_id })
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

      // 2. Actualizar cuota de cada inversionista
      let actualizados = 0;

      for (const invActual of grupo.inversionistasActuales) {
        if (!invActual.cuota) {
          console.log(`   ⏭️ ${invActual.inversionista}: sin cuota, saltando`);
          continue;
        }

        const investor = await findOrCreateInvestor(invActual.inversionista, false);

        // Actualizar tabla principal
        const [updated] = await db
          .update(creditos_inversionistas)
          .set({ cuota_inversionista: invActual.cuota })
          .where(
            and(
              eq(creditos_inversionistas.credito_id, creditoDB.credito_id),
              eq(creditos_inversionistas.inversionista_id, investor.inversionista_id)
            )
          )
          .returning({ id: creditos_inversionistas.id });

        // Actualizar espejo
        await db
          .update(creditos_inversionistas_espejo)
          .set({ cuota_inversionista: invActual.cuota, updated_at: new Date() })
          .where(
            and(
              eq(creditos_inversionistas_espejo.credito_id, creditoDB.credito_id),
              eq(creditos_inversionistas_espejo.inversionista_id, investor.inversionista_id)
            )
          );

        if (updated) {
          actualizados++;
          console.log(`   ✅ ${invActual.inversionista}: cuota → Q${invActual.cuota} (padre + espejo)`);
        } else {
          console.log(`   ⚠️ ${invActual.inversionista}: no encontrado en el crédito`);
        }
      }

      resultados.push({
        numeroCredito: numeroBase,
        status: "success",
        message: `${actualizados} inversionistas actualizados`,
        inversionistasActualizados: actualizados,
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

  const exitosos = resultados.filter(r => r.status === "success").length;
  const errores = resultados.filter(r => r.status === "error").length;

  console.log(`\n📊 ========== RESUMEN CUOTAS ==========`);
  console.log(`✅ Exitosos: ${exitosos}`);
  console.log(`❌ Errores: ${errores}`);

  return {
    success: exitosos > 0,
    total: resultados.length,
    exitosos,
    errores,
    detalles: resultados,
  };
}
