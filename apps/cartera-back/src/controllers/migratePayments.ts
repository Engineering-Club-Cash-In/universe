import Big from "big.js";
import { eq, and, gt, asc, inArray, lte } from "drizzle-orm";
import { db } from "../database";
import { creditos, cuotas_credito, pagos_credito } from "../database/db";
import fs from "fs/promises";
import { consultarEstadoCuentaPrestamo } from "../services/sifcoIntegrations";
import { updateInstallments } from "./updateCredit";

interface AjustarCuotasConSIFCOParams {
  numero_credito_sifco: string;
  cuota_esperada: number; // 20
  cuota_encontrada: number; // 11
  fecha_cuota: string; // "2025-12-28"
  plazo_completo: number; // 60
  plazo_encontrado: number; // 51
  cuotas_por_crear: number; // 9
}
 
export const ajustarCuotasConSIFCO = async ({
  numero_credito_sifco,
  cuota_esperada,
  cuota_encontrada,
  fecha_cuota,
  plazo_completo,
  plazo_encontrado,
  cuotas_por_crear,

}: AjustarCuotasConSIFCOParams): Promise<void> => {
  console.log(`\n🔧 Ajustando crédito ${numero_credito_sifco} - MIGRANDO A TU SISTEMA`);
  console.log(`   📊 Cuota esperada (JSON discrepancias): ${cuota_esperada} (fecha: ${fecha_cuota})`);
  console.log(`   📋 Cuota encontrada en BD: ${cuota_encontrada}`);
  console.log(`   📐 Plazo SIFCO (referencia): ${plazo_encontrado}`);
  console.log(`   📐 Plazo COMPLETO (TU sistema): ${plazo_completo} 👈 ESTE MANDA`);
  console.log(`   ➕ Cuotas por crear (del JSON): ${cuotas_por_crear}`);
  
 if (fecha_cuota.trim() === "" ||  !fecha_cuota) return; // ❌ Sin fecha, no se puede procesar

  // 1️⃣ Obtener crédito local
  const creditoResult = await db
    .select({
      credito_id: creditos.credito_id,
      capital: creditos.capital,
      deudatotal: creditos.deudatotal,
      plazo: creditos.plazo,
      fecha_desembolso: creditos.fecha_creacion,
      cuota: creditos.cuota,
      porcentaje_interes: creditos.porcentaje_interes,
      cuota_interes: creditos.cuota_interes,
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      gps: creditos.gps,
      membresias_pago: creditos.membresias_pago,
    })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
    .limit(1);

  const credito = creditoResult[0];
  if (!credito) throw new Error("Crédito no encontrado");

  // 🔥 CONSULTAR A SIFCO PARA OBTENER EL CAPITAL INICIAL (LIQUIDO A DESEMBOLSAR)
  console.log(`\n🌐 Consultando estado de cuenta en SIFCO...`);
  
  let capitalInicial = new Big(credito.capital || credito.deudatotal); // Default: usar BD
  
  try {
    const infoPagos = await consultarEstadoCuentaPrestamo(numero_credito_sifco);
    
    // 🔥 Agarrar la PRIMERA transacción (el desembolso)
    const transaccionDesembolso = infoPagos.ConsultaResultado.EstadoCuenta_Transacciones[0];
    
    if (transaccionDesembolso && transaccionDesembolso.EstadoCuenta_Detalles) {
      // Buscar el detalle "LIQUIDO A DESEMBOLSAR" (CrMoDeSalCod: 59)
      const liquidoDesembolsar = transaccionDesembolso.EstadoCuenta_Detalles.find(
        (d: any) => d.CrMoDeSalCod === 59
      );
      
      if (liquidoDesembolsar && liquidoDesembolsar.CrMoDeValor) {
        capitalInicial = new Big(liquidoDesembolsar.CrMoDeValor);
        console.log(`   ✅ Capital inicial desde SIFCO: Q${capitalInicial.toString()}`);
      } else {
        console.log(`   ⚠️ No se encontró LIQUIDO A DESEMBOLSAR en SIFCO, usando BD`);
      }
    } else {
      console.log(`   ⚠️ No se encontró transacción de desembolso en SIFCO, usando BD`);
    }
  } catch (error) {
    console.error(`   ❌ Error consultando SIFCO:`, error);
    console.log(`   ⚠️ Usando capital de BD: Q${capitalInicial.toString()}`);
  }

  const capitalActualCredito = new Big(credito.capital); // 👈 Para capital_restante (SIEMPRE)
  const deudaTotal = new Big(credito.deudatotal); // 👈 Para total_restante (SIEMPRE)

  console.log(`💰 Capital inicial (SIFCO): Q${capitalInicial.toString()}`);
  console.log(`💰 Capital actual del crédito (BD): Q${capitalActualCredito.toString()}`);
  console.log(`💰 Deuda total del crédito: Q${deudaTotal.toString()}`);

  // 🔥 LEER JSON DE ÚLTIMOS PAGOS para saber hasta qué cuota va REALMENTE pagada
  const rutaArchivoPagos = "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\resultado_ultimos_pagos.json";
  
  console.log(`\n📂 Leyendo archivo de últimos pagos: ${rutaArchivoPagos}`);
  
  let cuotaRealmentePagada = cuota_esperada; // Default: usar la del JSON de discrepancias
  
  try {
    const contenidoPagos = await fs.readFile(rutaArchivoPagos, "utf-8");
    const jsonPagos = JSON.parse(contenidoPagos);
    
    // Buscar el crédito en el JSON de pagos
    const creditoPagos = jsonPagos.find((c: any) => c.numeroCredito === numero_credito_sifco);
    
    if (creditoPagos && creditoPagos.creditos && creditoPagos.creditos.length > 0) {
      // 🎯 Agarrar el PRIMER elemento del array para saber hasta qué cuota va
      const primerPago = creditoPagos.creditos[0];
      cuotaRealmentePagada = parseInt(primerPago.numeroCuota);
      
      console.log(`   ✅ JSON de pagos encontrado: Cuota realmente pagada = ${cuotaRealmentePagada}`);
    } else {
      console.log(`   ⚠️ Crédito no encontrado en JSON de pagos, usando cuota_esperada = ${cuota_esperada}`);
    }
  } catch (error) {
    console.error(`   ❌ Error leyendo JSON de pagos:`, error);
    console.log(`   ⚠️ Usando cuota_esperada del JSON de discrepancias = ${cuota_esperada}`);
  }

  // 2️⃣ Obtener TODAS las cuotas (incluyendo la 0)
  const todasLasCuotas = await db
    .select()
    .from(cuotas_credito)
    .where(eq(cuotas_credito.credito_id, credito.credito_id))
    .orderBy(asc(cuotas_credito.numero_cuota));

  // 🔥 OPTIMIZACIÓN: Separar cuota 0 y cuotas normales
  const cuota0 = todasLasCuotas.find(c => c.numero_cuota === 0);
  const cuotasExistentes = todasLasCuotas.filter(c => c.numero_cuota > 0);

  console.log(`📦 Cuotas existentes en BD (sin la 0): ${cuotasExistentes.length}`);

  // 3️⃣ 🔥 CALCULAR FECHAS BASADAS EN LA FECHA DE LA CUOTA ESPERADA
  console.log(`\n📅 Calculando fechas basadas en cuota esperada desde SIFCO...`);
  console.log(`   🎯 Cuota esperada: #${cuota_esperada}`);
  console.log(`   📆 Fecha de cuota esperada: ${fecha_cuota}`);

  const fechaEsperada = new Date(fecha_cuota);
  const diaEsperado = fechaEsperada.getDate();

  // 🔥 FIX: Detectar si la fecha es día 1 (indica vencimiento del mes anterior)
  let diaVencimiento: number;
  let fechaBase = new Date(fechaEsperada); // 👈 NUEVA VARIABLE para corregir el mes

if (diaEsperado === 1) {
  // Día 1 = SIFCO manda el mes correcto, solo el día está corrido
  diaVencimiento = 30;

  console.log(
    `   ⚠️ Fecha en día 1 detectada, usando vencimiento día 30 DEL MISMO MES`
  );

  // 🔒 NO tocar el mes
  const ultimoDia = new Date(fechaBase.getFullYear(), fechaBase.getMonth() + 1, 0).getDate();
  fechaBase.setDate(Math.min(30, ultimoDia));
} else {
  // Regla normal
  diaVencimiento = diaEsperado > 15 ? 30 : 15;
  fechaBase.setDate(diaVencimiento);
}

  console.log(`   📌 Día de la fecha esperada: ${diaEsperado}`);
  console.log(`   📌 Día de vencimiento determinado: ${diaVencimiento === 30 ? "30 (28 en febrero)" : "15"}`);
  console.log(`   📌 Fecha base ajustada: ${fechaBase.toISOString().split("T")[0]}`); // 👈 NUEVO LOG

  // 🔥 HELPER para ajustar día según el mes
  const ajustarDiaVencimiento = (fecha: Date, dia: number): void => {
    const ultimoDiaMes = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0).getDate();
    fecha.setDate(Math.min(dia, ultimoDiaMes));
  };

  // 🔥 CALCULAR LA FECHA DE LA CUOTA ESPERADA ajustada (usando fechaBase)
  const fechaCuotaEsperadaAjustada = new Date(fechaBase.getFullYear(), fechaBase.getMonth(), 1);
  ajustarDiaVencimiento(fechaCuotaEsperadaAjustada, diaVencimiento);

  console.log(`   ✅ Cuota ${cuota_esperada} ajustada a: ${fechaCuotaEsperadaAjustada.toISOString().split("T")[0]}`);

  // 🔥 RETROCEDER desde la cuota esperada hasta la cuota 1
  // Usar día 1 antes de setMonth para evitar overflow (feb 30 → mar 2)
  const fechaPrimeraCuota = new Date(fechaCuotaEsperadaAjustada.getFullYear(), fechaCuotaEsperadaAjustada.getMonth(), 1);
  fechaPrimeraCuota.setMonth(fechaPrimeraCuota.getMonth() - (cuota_esperada - 1));
  ajustarDiaVencimiento(fechaPrimeraCuota, diaVencimiento);

  console.log(`   ✅ Fecha calculada para cuota 1: ${fechaPrimeraCuota.toISOString().split("T")[0]}`);

  // 🔥 CALCULAR FECHA DE LA CUOTA 0 (un mes antes que la cuota 1)
  const fechaCuota0 = new Date(fechaPrimeraCuota.getFullYear(), fechaPrimeraCuota.getMonth(), 1);
  fechaCuota0.setMonth(fechaCuota0.getMonth() - 1);
  ajustarDiaVencimiento(fechaCuota0, diaVencimiento);

  console.log(`   ✅ Fecha calculada para cuota 0: ${fechaCuota0.toISOString().split("T")[0]}`);

  // 🔥 HELPER: Calcular fecha de vencimiento
  // Usar día 1 antes de setMonth para evitar overflow en febrero
  const calcularFechaVencimiento = (numeroCuota: number): string => {
    const fecha = new Date(fechaPrimeraCuota.getFullYear(), fechaPrimeraCuota.getMonth(), 1);
    fecha.setMonth(fecha.getMonth() + (numeroCuota - 1));
    ajustarDiaVencimiento(fecha, diaVencimiento);
    return fecha.toISOString().split("T")[0];
  };

  // 🔥 OPTIMIZACIÓN: Helper para calcular interés e IVA
  const calcularInteresEIva = (capital: Big) => {
    const interes = capital.times(porcentajeInteres).round(2);
    const iva = interes.times(0.12).round(2);
    return { interes, iva };
  };

  // 7️⃣ Constantes financieras (MOVIDAS AQUÍ ARRIBA)
  const seguroFijoPorMes = new Big(credito.seguro_10_cuotas ?? 0);
  const gpsFijoPorMes = new Big(credito.gps ?? 0);
  const membresiasFijoPorMes = new Big(credito.membresias_pago ?? 0);
  const porcentajeInteres = new Big(credito.porcentaje_interes ?? 0).div(100);
  const cuotaMensual = new Big(credito.cuota);
  const cuotaInteresCredito = credito.cuota_interes;

  // 🔥 PRE-CALCULAR interés e IVA para cuotas pendientes (se usa para TODAS)
  const { interes: interesPendienteBase, iva: ivaPendienteBase } = calcularInteresEIva(capitalActualCredito);

  await db.transaction(async (tx) => {
    // 4️⃣ 🗑️ LIMPIAR CUOTAS QUE EXCEDEN EL PLAZO COMPLETO
    const cuotasExcedentes = cuotasExistentes.filter(
      (c) => c.numero_cuota > plazo_completo
    );

    if (cuotasExcedentes.length > 0) {
      console.log(
        `\n🗑️ LIMPIANDO ${cuotasExcedentes.length} cuotas que exceden el plazo completo (${plazo_completo})...`
      );

      const cuotaIdsExcedentes = cuotasExcedentes.map(c => c.cuota_id);

      await tx
        .delete(pagos_credito)
        .where(inArray(pagos_credito.cuota_id, cuotaIdsExcedentes));

      await tx
        .delete(cuotas_credito)
        .where(inArray(cuotas_credito.cuota_id, cuotaIdsExcedentes));

      console.log(`   🗑️ ${cuotasExcedentes.length} cuotas eliminadas`);
    }

    const cuotasLimpias = cuotasExistentes.filter(
      (c) => c.numero_cuota <= plazo_completo
    );

    // 5️⃣ CREAR CUOTAS FALTANTES
    const cuotasActuales = cuotasLimpias.length;
    const cuotasNecesarias = Math.max(0, plazo_completo - cuotasActuales);

    console.log(`\n📊 Validación de cuotas:`);
    console.log(`   📦 Cuotas válidas después de limpieza: ${cuotasActuales}`);
    console.log(`   🎯 Plazo completo: ${plazo_completo}`);
    console.log(`   🧮 Cuotas necesarias: ${cuotasNecesarias}`);

    if (cuotasNecesarias > 0) {
      console.log(`\n➕ Creando ${cuotasNecesarias} cuotas faltantes...`);

      const ultimoNumero = cuotasLimpias.length > 0
        ? Math.max(...cuotasLimpias.map((c) => c.numero_cuota))
        : 0;

      const nuevasCuotasValues = [];
      
      for (let i = 1; i <= cuotasNecesarias; i++) {
        const numeroCuota = ultimoNumero + i;

        if (numeroCuota > plazo_completo) {
          console.warn(`   ⚠️ Saltando cuota ${numeroCuota} - excede plazo_completo`);
          break;
        }

        nuevasCuotasValues.push({
          credito_id: credito.credito_id,
          numero_cuota: numeroCuota,
          fecha_vencimiento: calcularFechaVencimiento(numeroCuota),
          pagado: false,
          liquidado_inversionistas: false,
        });
      }

      if (nuevasCuotasValues.length > 0) {
        const nuevasCuotas = await tx
          .insert(cuotas_credito)
          .values(nuevasCuotasValues)
          .returning();

        const nuevosPagosValues = nuevasCuotas.map(cuota => ({
          credito_id: credito.credito_id,
          cuota_id: cuota.cuota_id,
          cuota: credito.cuota,
          cuota_interes: credito.cuota_interes,
          pago_del_mes: "0",
          pagado: false,
          pagoConvenio: "0",
          validationStatus: "no_required" as const,
          registerBy: "SIFCO_IMPORT",
          fecha_pago: null,
          fecha_boleta:null,
          monto_aplicado: "0",
        }));

        await tx.insert(pagos_credito).values(nuevosPagosValues);

        console.log(`   ✅ ${nuevasCuotas.length} cuotas creadas`);
      } else {
        console.log(`   ⚠️ No hay cuotas nuevas para crear (todas exceden plazo_completo)`);
      }
    } else {
      console.log(`   ✅ Ya existen todas las cuotas del plazo completo`);
    }

    // 🔥 ACTUALIZAR LA CUOTA 0 - SOLO FECHAS (usando la variable que ya tenemos)
    if (cuota0) {
      const fechaCuota0Str = fechaCuota0.toISOString().split("T")[0];
      
      await tx
        .update(cuotas_credito)
        .set({
          fecha_vencimiento: fechaCuota0Str,
        })
        .where(eq(cuotas_credito.cuota_id, cuota0.cuota_id));
      
      await tx
        .update(pagos_credito)
        .set({
          fecha_vencimiento: fechaCuota0Str,
          fecha_pago: new Date(fechaCuota0Str),
        })
        .where(eq(pagos_credito.cuota_id, cuota0.cuota_id));
      
      console.log(`   🔧 Cuota 0 actualizada - fecha_vencimiento Y fecha_pago: ${fechaCuota0Str}`);
    }

    // 6️⃣ Recargar cuotas y pagos
    const cuotasConPagos = await tx
      .select({
        cuota_id: cuotas_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        pago_id: pagos_credito.pago_id,
      })
      .from(cuotas_credito)
      .leftJoin(pagos_credito, eq(pagos_credito.cuota_id, cuotas_credito.cuota_id))
      .where(
        and(
          eq(cuotas_credito.credito_id, credito.credito_id),
          gt(cuotas_credito.numero_cuota, 0),
          lte(cuotas_credito.numero_cuota, plazo_completo)
        )
      )
      .orderBy(asc(cuotas_credito.numero_cuota));

    console.log(`\n📦 Total de cuotas válidas: ${cuotasConPagos.length}`);

    console.log(
      `\n🔄 Reprocesando ${cuotasConPagos.length} cuotas (cuota 1 hasta ${plazo_completo})...`
    );
    console.log(`   🎯 Cuotas que se marcarán como PAGADAS: 1-${cuotaRealmentePagada}`);

    // 8️⃣ Preparar BATCH UPDATES con cálculo DINÁMICO de abonos
    const cuotasParaActualizar: Array<{
      cuota_id: number;
      data: any;
    }> = [];

    const pagosParaActualizar: Array<{
      pago_id: number;
      data: any;
    }> = [];

    const pagosParaCrear: Array<any> = [];

    // 🔥 Capital en memoria para ir reduciendo (DESDE SIFCO)
    let capitalEnMemoria = capitalInicial;

    for (const row of cuotasConPagos) {
      const numeroCuota = row.numero_cuota;
      const fechaVencimientoCuota = calcularFechaVencimiento(numeroCuota);
      const esCuotaPagada = numeroCuota <= cuotaRealmentePagada;

      if (esCuotaPagada) {
        // ✅ CUOTAS PAGADAS - CÁLCULOS DINÁMICOS
        const { interes: interesMes, iva: ivaMes } = calcularInteresEIva(capitalEnMemoria);

        // 🔥 Montos extras
        const montosExtras = interesMes
          .plus(ivaMes)
          .plus(seguroFijoPorMes)
          .plus(gpsFijoPorMes)
          .plus(membresiasFijoPorMes);

        // 🔥 Abono a capital = Cuota - montos extras
        const abonoCapital = cuotaMensual.minus(montosExtras).round(2);

        // 🔥 Reducir capital para la siguiente cuota
        const capitalDespues = capitalEnMemoria.minus(abonoCapital);
        if (capitalDespues.lt(0)) {
          capitalEnMemoria = new Big(0);
        } else {
          capitalEnMemoria = capitalDespues;
        }

        console.log(
          `   ✅ Cuota #${numeroCuota} PAGADA - Vence: ${fechaVencimientoCuota} - Abono capital: Q${abonoCapital} - Capital después: Q${capitalEnMemoria}`
        );

        const montoBoleta = cuotaMensual.round(2);

        cuotasParaActualizar.push({
          cuota_id: row.cuota_id,
          data: {
            fecha_vencimiento: fechaVencimientoCuota,
            pagado: true,
            liquidado_inversionistas: true,
            fecha_liquidacion_inversionistas: new Date(),
          },
        });

        if (row.pago_id) {
          pagosParaActualizar.push({
            pago_id: row.pago_id,
            data: {
              cuota: cuotaMensual.toString(),
              cuota_interes: cuotaInteresCredito,
              pago_del_mes: cuotaMensual.toString(),

              // 🔥 ABONOS (lo que SE PAGÓ en esta cuota)
              abono_capital: abonoCapital.toString(),
              abono_interes: interesMes.toString(),
              abono_iva_12: ivaMes.toString(),
              abono_seguro: seguroFijoPorMes.toString(),
              abono_gps: gpsFijoPorMes.toString(),

              // 🔥 RESTANTES = 0 (porque ya se pagó esta cuota)
              capital_restante: "0",
              interes_restante: "0",
              iva_12_restante: "0",
              seguro_restante: "0",
              gps_restante: "0",
              total_restante: deudaTotal.toString(),

              membresias: membresiasFijoPorMes.toString(),
              membresias_pago: membresiasFijoPorMes.toString(),
              membresias_mes: membresiasFijoPorMes.toString(),

              monto_boleta: montoBoleta.toString(),
              fecha_vencimiento: fechaVencimientoCuota,
              fecha_pago: new Date(fechaVencimientoCuota),
              pagado: true,
              validationStatus: "no_required" as const,
              registerBy: "SIFCO_IMPORT",
            },
          });
        } else {
          console.log(`   ⚠️ Cuota #${numeroCuota} sin pago, creando registro...`);
          pagosParaCrear.push({
            credito_id: credito.credito_id,
            cuota_id: row.cuota_id,
            cuota: cuotaMensual.toString(),
            cuota_interes: cuotaInteresCredito,
            pago_del_mes: cuotaMensual.toString(),
            abono_capital: abonoCapital.toString(),
            abono_interes: interesMes.toString(),
            abono_iva_12: ivaMes.toString(),
            abono_seguro: seguroFijoPorMes.toString(),
            abono_gps: gpsFijoPorMes.toString(),
            capital_restante: "0",
            interes_restante: "0",
            iva_12_restante: "0",
            seguro_restante: "0",
            gps_restante: "0",
            total_restante: deudaTotal.toString(),
            membresias: membresiasFijoPorMes.toString(),
            membresias_pago: membresiasFijoPorMes.toString(),
            membresias_mes: membresiasFijoPorMes.toString(),
            monto_boleta: montoBoleta.toString(),
            fecha_vencimiento: fechaVencimientoCuota,
            fecha_pago: new Date(fechaVencimientoCuota),
            pagado: true,
            validationStatus: "no_required" as const,
            registerBy: "SIFCO_IMPORT",
            pagoConvenio: "0",
            monto_aplicado: "0",
            fecha_boleta: null,
          });
        }
      } else {
        // 📋 CUOTAS PENDIENTES - USAR VARIABLES PRE-CALCULADAS
        console.log(
          `   📋 Cuota #${numeroCuota} PENDIENTE - Vence: ${fechaVencimientoCuota}`
        );

        const montosExtrasPendiente = interesPendienteBase
          .plus(ivaPendienteBase)
          .plus(seguroFijoPorMes)
          .plus(gpsFijoPorMes)
          .plus(membresiasFijoPorMes);

        const abonoCapitalPendiente = cuotaMensual.minus(montosExtrasPendiente).round(2);

        cuotasParaActualizar.push({
          cuota_id: row.cuota_id,
          data: {
            fecha_vencimiento: fechaVencimientoCuota,
            pagado: false,
            liquidado_inversionistas: false,
          },
        });

        if (row.pago_id) {
          pagosParaActualizar.push({
            pago_id: row.pago_id,
            data: {
              cuota: cuotaMensual.toString(),
              cuota_interes: cuotaInteresCredito,
              pago_del_mes: "0",

              // 🔥 ABONOS = 0 (porque no se ha pagado)
              abono_capital: "0",
              abono_interes: "0",
              abono_iva_12: "0",
              abono_seguro: "0",
              abono_gps: "0",

              // 🔥 RESTANTES - Calculados sobre el capital ACTUAL del crédito
              capital_restante: capitalActualCredito.toString(),
              interes_restante: interesPendienteBase.toString(),
              iva_12_restante: ivaPendienteBase.toString(),
              seguro_restante: seguroFijoPorMes.toString(),
              gps_restante: gpsFijoPorMes.toString(),
              total_restante: deudaTotal.toString(),

              membresias: membresiasFijoPorMes.toString(),
              membresias_pago: membresiasFijoPorMes.toString(),
              membresias_mes: membresiasFijoPorMes.toString(),

              monto_boleta: null,
              monto_boleta_cuota: null,

              fecha_vencimiento: fechaVencimientoCuota,
              fecha_pago: null,
              pagado: false,
              validationStatus: "no_required" as const,
              registerBy: "SIFCO_IMPORT",
            },
          });
        } else {
          console.log(`   ⚠️ Cuota #${numeroCuota} sin pago, creando registro...`);
          pagosParaCrear.push({
            credito_id: credito.credito_id,
            cuota_id: row.cuota_id,
            cuota: cuotaMensual.toString(),
            cuota_interes: cuotaInteresCredito,
            pago_del_mes: "0",
            abono_capital: "0",
            abono_interes: "0",
            abono_iva_12: "0",
            abono_seguro: "0",
            abono_gps: "0",
            capital_restante: capitalActualCredito.toString(),
            interes_restante: interesPendienteBase.toString(),
            iva_12_restante: ivaPendienteBase.toString(),
            seguro_restante: seguroFijoPorMes.toString(),
            gps_restante: gpsFijoPorMes.toString(),
            total_restante: deudaTotal.toString(),
            membresias: membresiasFijoPorMes.toString(),
            membresias_pago: "0",
            membresias_mes: "0",
            monto_boleta: null,
            monto_boleta_cuota: null,
            fecha_vencimiento: fechaVencimientoCuota,
            fecha_pago: null,
            pagado: false,
            validationStatus: "no_required" as const,
            registerBy: "SIFCO_IMPORT",
            pagoConvenio: "0",
            monto_aplicado: "0",
            fecha_boleta: null,
          });
        }
      }
    }

    console.log(`\n🚀 Ejecutando batch updates...`);
    
    // 🔥 OPTIMIZACIÓN: Separar en dos Promise.all más claros
    const [, ] = await Promise.all([
      Promise.all(
        cuotasParaActualizar.map(({ cuota_id, data }) =>
          tx
            .update(cuotas_credito)
            .set(data)
            .where(eq(cuotas_credito.cuota_id, cuota_id))
        )
      ),
      Promise.all(
        pagosParaActualizar.map(({ pago_id, data }) =>
          tx
            .update(pagos_credito)
            .set(data)
            .where(eq(pagos_credito.pago_id, pago_id))
        )
      ),
    ]);

    // Crear pagos faltantes (cuotas que no tenían registro en pagos_credito)
    if (pagosParaCrear.length > 0) {
      await tx.insert(pagos_credito).values(pagosParaCrear);
      console.log(`   ✅ ${pagosParaCrear.length} pagos CREADOS (cuotas sin registro)`);
    }

    console.log(`   ✅ ${cuotasParaActualizar.length} cuotas actualizadas`);
    console.log(`   ✅ ${pagosParaActualizar.length} pagos actualizados`);
  });

  console.log(`\n🎉 AJUSTE COMPLETADO - MIGRACIÓN A TU SISTEMA`);
  console.log(`📊 Resumen final:`);
  console.log(`   💰 Capital inicial (SIFCO): Q${capitalInicial.toString()}`); 
  console.log(`   💰 Capital actual del crédito (BD): Q${capitalActualCredito.toString()}`);
  console.log(`   💰 Deuda total: Q${deudaTotal.toString()}`);
  console.log(`   📐 Plazo completo (TU sistema): ${plazo_completo} cuotas`);
  console.log(`   ✅ Cuotas pagadas (JSON pagos): ${cuotaRealmentePagada}`);
  console.log(`   📋 Cuotas pendientes: ${plazo_completo - cuotaRealmentePagada}`);
  console.log(`   🎯 Vencimientos: día ${diaVencimiento === 30 ? "30 (28 en febrero)" : "15"} de cada mes`);
};
interface CreditoPagoSIFCO {
  numeroCredito: string;
  fechaUltimoPago: string;
  numeroCuota: string;
  cuota: string;
  montoBoleta: string;
  pagado: string;
}

interface CreditoConPagos {
  numeroCredito: string;
  creditos: CreditoPagoSIFCO[];
}

export const procesarPagosSIFCODesdeJSON = async (
  jsonData: CreditoConPagos[]
): Promise<void> => {
  console.log(`\n🎯 INICIANDO PROCESAMIENTO DE PAGOS DESDE JSON SIFCO`);
  console.log(`📦 Total de créditos a procesar: ${jsonData.length}`);

  let procesados = 0;
  let errores = 0;

  for (const creditoData of jsonData) {
    const numeroCreditoPadre = creditoData.numeroCredito;
    
    // 🎯 Agarrar SOLO el primer elemento del array
    const primerPago = creditoData.creditos[0];
    
    if (!primerPago) {
      console.warn(`⚠️ Crédito ${numeroCreditoPadre} no tiene pagos en el array`);
      continue;
    }

    try {
      console.log(`\n🔄 Procesando: ${numeroCreditoPadre}`);
      console.log(`   📍 Marcar como PAGADAS desde cuota 1 hasta cuota #${primerPago.numeroCuota}`);
      
      await marcarCuotasPagadasHastaNumero({
        numero_credito_sifco: numeroCreditoPadre,
        hasta_cuota: parseInt(primerPago.numeroCuota),
      });

      procesados++;
      console.log(`   ✅ Cuotas marcadas como PAGADAS`);
    } catch (error) {
      errores++;
      console.error(`   ❌ Error procesando ${numeroCreditoPadre}:`, error);
    }
  }

  console.log(`\n🎉 PROCESAMIENTO COMPLETADO`);
  console.log(`   ✅ Exitosos: ${procesados}`);
  console.log(`   ❌ Errores: ${errores}`);
};

interface MarcarCuotasPagadasParams {
  numero_credito_sifco: string;
  hasta_cuota: number;
  fecha_primer_pago?: string; // e.g. "2026-01-30 00:00:00"
}

export const marcarCuotasPagadasHastaNumero = async ({
  numero_credito_sifco,
  hasta_cuota,
  fecha_primer_pago,
}: MarcarCuotasPagadasParams): Promise<void> => {

  /* =====================================================
     1️⃣ CRÉDITO
     ===================================================== */
  const creditoResult = await db
    .select({
      credito_id: creditos.credito_id,
      capital: creditos.capital,              // 👈 capital ACTUAL BD
      deudatotal: creditos.deudatotal,
      cuota: creditos.cuota,
      porcentaje_interes: creditos.porcentaje_interes,
      cuota_interes: creditos.cuota_interes,
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      gps: creditos.gps,
      membresias_pago: creditos.membresias_pago,
    })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
    .limit(1);

  const credito = creditoResult[0];
  if (!credito) throw new Error("Crédito no encontrado");

  /* =====================================================
     2️⃣ CAPITAL INICIAL REAL (SIFCO)
     ===================================================== */
  let capitalInicialSifco = new Big(credito.capital);

  try {
    const infoPagos = await consultarEstadoCuentaPrestamo(numero_credito_sifco);
    const trx = infoPagos.ConsultaResultado.EstadoCuenta_Transacciones?.[0];
    const liquido = trx?.EstadoCuenta_Detalles?.find(
      (d: any) => d.CrMoDeSalCod === 59
    );

    if (liquido?.CrMoDeValor) {
      capitalInicialSifco = new Big(liquido.CrMoDeValor);
    }
  } catch {
    // fallback: usar BD
  }

  const capitalActualBD = new Big(credito.capital);
  const deudaTotal = new Big(credito.deudatotal);

  /* =====================================================
     3️⃣ CUOTAS + PAGOS
     ===================================================== */
  const cuotasConPagosRaw = await db
    .select({
      cuota_id: cuotas_credito.cuota_id,
      numero_cuota: cuotas_credito.numero_cuota,
      pago_id: pagos_credito.pago_id,
      fecha_vencimiento: cuotas_credito.fecha_vencimiento,
    })
    .from(cuotas_credito)
    .leftJoin(pagos_credito, eq(pagos_credito.cuota_id, cuotas_credito.cuota_id))
    .where(
      and(
        eq(cuotas_credito.credito_id, credito.credito_id),
        gt(cuotas_credito.numero_cuota, 0)
      )
    )
    .orderBy(asc(cuotas_credito.numero_cuota));

  // Deduplicar: si una cuota tiene varios pagos, quedarse solo con el primero
  const cuotasVistas = new Set<number>();
  const cuotasConPagos = cuotasConPagosRaw.filter((row) => {
    if (cuotasVistas.has(row.cuota_id)) return false;
    cuotasVistas.add(row.cuota_id);
    return true;
  });

  /* =====================================================
     4️⃣ CONSTANTES FINANCIERAS
     ===================================================== */
  const cuotaMensual = new Big(credito.cuota);
  const porcentajeInteres = new Big(credito.porcentaje_interes).div(100);
  const seguro = new Big(credito.seguro_10_cuotas ?? 0);
  const gps = new Big(credito.gps ?? 0);
  const membresias = new Big(credito.membresias_pago ?? 0);
  const cuotaInteresCredito = credito.cuota_interes;

  const calcularInteresIva = (capital: Big) => {
    const interes = capital.times(porcentajeInteres).round(2);
    const iva = interes.times(0.12).round(2);
    return { interes, iva };
  };

  /* =====================================================
     5️⃣ CALCULAR FECHAS DESDE CUOTA 0
     ===================================================== */
  // Obtener fecha de cuota 0 como base
  const [cuota0] = await db
    .select({ fecha_vencimiento: cuotas_credito.fecha_vencimiento })
    .from(cuotas_credito)
    .where(
      and(
        eq(cuotas_credito.credito_id, credito.credito_id),
        eq(cuotas_credito.numero_cuota, 0)
      )
    )
    .limit(1);

  const fechaCuota0 = cuota0?.fecha_vencimiento ? new Date(cuota0.fecha_vencimiento) : null;
  // Día de pago del JSON (ej: "2026-01-30" → 30)
  const fechaJsonPago = fecha_primer_pago ? new Date(fecha_primer_pago.replace(" ", "T")) : null;
  const diaPago = fechaJsonPago?.getDate() ?? null;

  // Calcula la fecha para cuota N: cuota0 + N meses, con el día del JSON
  const calcularFechaCuota = (numeroCuota: number): Date | null => {
    if (!fechaCuota0 || !diaPago) return null;
    const mesBase = fechaCuota0.getMonth();
    const añoBase = fechaCuota0.getFullYear();
    const mesTarget = mesBase + numeroCuota;
    const añoTarget = añoBase + Math.floor(mesTarget / 12);
    const mesAjustado = ((mesTarget % 12) + 12) % 12;
    const ultimoDiaMes = new Date(añoTarget, mesAjustado + 1, 0).getDate();
    return new Date(añoTarget, mesAjustado, Math.min(diaPago, ultimoDiaMes));
  };

  /* =====================================================
     6️⃣ PROCESAMIENTO
     ===================================================== */
  let capitalEnMemoria = capitalInicialSifco;

  const cuotasParaActualizar: any[] = [];
  const pagosParaActualizar: any[] = [];

  await db.transaction(async (tx) => {
    for (const row of cuotasConPagos) {
      const esPagada = row.numero_cuota <= hasta_cuota;

      if (esPagada) {
        // 🔥 CUOTA PAGADA → CAPITAL SIFCO
        const { interes, iva } = calcularInteresIva(capitalEnMemoria);

        const extras = interes.plus(iva).plus(seguro).plus(gps).plus(membresias);
        const abonoCapital = cuotaMensual.minus(extras).round(2);

        const nuevoCapital = capitalEnMemoria.minus(abonoCapital);
        capitalEnMemoria = nuevoCapital.lt(0) ? new Big(0) : nuevoCapital;

        const fechaCuota = calcularFechaCuota(row.numero_cuota);
        cuotasParaActualizar.push({
          cuota_id: row.cuota_id,
          data: {
            pagado: true,
            liquidado_inversionistas: true,
            fecha_liquidacion_inversionistas: new Date(),
            ...(fechaCuota ? { fecha_vencimiento: fechaCuota.toISOString().slice(0, 10) } : {}),
          },
        });

        pagosParaActualizar.push({
          pago_id: row.pago_id,
          data: {
            cuota: cuotaMensual.toString(),
            cuota_interes: cuotaInteresCredito,
            pago_del_mes: cuotaMensual.toString(),

            abono_capital: abonoCapital.toString(),
            abono_interes: interes.toString(),
            abono_iva_12: iva.toString(),
            abono_seguro: seguro.toString(),
            abono_gps: gps.toString(),

            capital_restante: capitalEnMemoria.toString(),
            interes_restante: "0",
            iva_12_restante: "0",
            seguro_restante: "0",
            gps_restante: "0",
            total_restante: capitalEnMemoria.toString(),

            membresias: membresias.toString(),
            membresias_pago: membresias.toString(),
            membresias_mes: membresias.toString(),

            monto_boleta: cuotaMensual.toString(),
            monto_boleta_cuota: cuotaMensual.toString(),

            fecha_pago: fechaCuota ?? new Date(row.fecha_vencimiento ?? new Date()),
            ...(fechaCuota ? { fecha_vencimiento: fechaCuota.toISOString().slice(0, 10) } : {}),
            pagado: true,
            validationStatus: "no_required",
            registerBy: "SIFCO_IMPORT",
          },
        });
      } else {
        // 📋 CUOTA PENDIENTE → CAPITAL BD
        const { interes, iva } = calcularInteresIva(capitalActualBD);

        const fechaCuotaPend = calcularFechaCuota(row.numero_cuota);
        cuotasParaActualizar.push({
          cuota_id: row.cuota_id,
          data: {
            pagado: false,
            liquidado_inversionistas: false,
            ...(fechaCuotaPend ? { fecha_vencimiento: fechaCuotaPend.toISOString().slice(0, 10) } : {}),
          },
        });

        pagosParaActualizar.push({
          pago_id: row.pago_id,
          data: {
            cuota: cuotaMensual.toString(),
            cuota_interes: cuotaInteresCredito,
            pago_del_mes: "0",

            abono_capital: "0",
            abono_interes: "0",
            abono_iva_12: "0",
            abono_seguro: "0",
            abono_gps: "0",

            capital_restante: capitalActualBD.toString(),
            interes_restante: interes.toString(),
            iva_12_restante: iva.toString(),
            seguro_restante: seguro.toString(),
            gps_restante: gps.toString(),
            total_restante: deudaTotal.toString(),

            membresias: membresias.toString(),
            membresias_pago: membresias.toString(),
            membresias_mes: membresias.toString(),

            fecha_pago: null,
            ...(fechaCuotaPend ? { fecha_vencimiento: fechaCuotaPend.toISOString().slice(0, 10) } : {}),
            pagado: false,
            validationStatus: "no_required",
            registerBy: "SIFCO_IMPORT",
          },
        });
      }
    }

    await Promise.all([
      ...cuotasParaActualizar.map(({ cuota_id, data }) =>
        tx.update(cuotas_credito).set(data).where(eq(cuotas_credito.cuota_id, cuota_id))
      ),
      ...pagosParaActualizar.map(({ pago_id, data }) =>
        tx.update(pagos_credito).set(data).where(eq(pagos_credito.pago_id, pago_id))
      ),
    ]);
  });

  console.log(`✅ Cuotas marcadas correctamente hasta la ${hasta_cuota}`);

  // Recalcular cuotas pendientes con el capital correcto
  await updateInstallments({
    numero_credito_sifco,
    nueva_cuota: Number(credito.cuota),
  });
  console.log(`✅ Cuotas pendientes recalculadas para ${numero_credito_sifco}`);
};
