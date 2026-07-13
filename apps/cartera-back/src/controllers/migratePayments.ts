import Big from "big.js";
import { eq, and, gt, asc, inArray, lte } from "drizzle-orm";
import { db } from "../database";
import { creditos, cuotas_credito, pagos_credito } from "../database/db";
import { consultarEstadoCuentaPrestamo } from "../services/sifcoIntegrations";
import { updateInstallments } from "./updateCredit";

interface AjustarCuotasConSIFCOParams {
  numero_credito_sifco: string;
  cuota_esperada: number; // 20  → cuota cuya fecha conocemos
  fecha_cuota: string;    // "2025-12-28" → fecha de esa cuota
  plazo_completo: number; // 60  → plazo total objetivo
  dia_vencimiento?: number; // 1-31 → si viene, se respeta este día exacto (no aplica la regla día 1 → 30)
}

export const ajustarCuotasConSIFCO = async ({
  numero_credito_sifco,
  cuota_esperada,
  fecha_cuota,
  plazo_completo,
  dia_vencimiento,
}: AjustarCuotasConSIFCOParams): Promise<void> => {
  console.log(`\n🔧 Ajustando crédito ${numero_credito_sifco} - SOLO FECHAS Y PLAZO`);
  console.log(`   📊 Cuota esperada: ${cuota_esperada} (fecha: ${fecha_cuota})`);
  console.log(`   📐 Plazo completo (TU sistema): ${plazo_completo}`);

  if (!fecha_cuota || fecha_cuota.trim() === "") return;

  // 1️⃣ Obtener crédito local
  const creditoResult = await db
    .select({
      credito_id: creditos.credito_id,
      cuota: creditos.cuota,
      cuota_interes: creditos.cuota_interes,
    })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
    .limit(1);

  const credito = creditoResult[0];
  if (!credito) throw new Error("Crédito no encontrado");

  // 2️⃣ Obtener TODAS las cuotas (incluyendo la 0)
  const todasLasCuotas = await db
    .select()
    .from(cuotas_credito)
    .where(eq(cuotas_credito.credito_id, credito.credito_id))
    .orderBy(asc(cuotas_credito.numero_cuota));

  const cuota0 = todasLasCuotas.find(c => c.numero_cuota === 0);
  const cuotasExistentes = todasLasCuotas.filter(c => c.numero_cuota > 0);

  console.log(`📦 Cuotas existentes en BD (sin la 0): ${cuotasExistentes.length}`);

  // 3️⃣ Calcular fechas basadas en la cuota esperada
  // Parseo manual de "YYYY-MM-DD" para evitar shift por timezone (America/Guatemala UTC-6)
  const [yyyy, mm, dd] = fecha_cuota.split("-").map(Number);
  const fechaEsperada = new Date(yyyy, mm - 1, dd);
  const diaEsperado = fechaEsperada.getDate();

  let diaVencimiento: number;
  const fechaBase = new Date(fechaEsperada);

  if (dia_vencimiento != null) {
    // Día explícito (ej. créditos que pagan el 1): se respeta tal cual
    diaVencimiento = dia_vencimiento;
    const ultimoDia = new Date(fechaBase.getFullYear(), fechaBase.getMonth() + 1, 0).getDate();
    fechaBase.setDate(Math.min(diaVencimiento, ultimoDia));
    console.log(`   📌 Día de vencimiento explícito: ${diaVencimiento}`);
  } else if (diaEsperado === 1) {
    // Día 1 = SIFCO manda el mes correcto, día 30 del mismo mes
    diaVencimiento = 30;
    const ultimoDia = new Date(fechaBase.getFullYear(), fechaBase.getMonth() + 1, 0).getDate();
    fechaBase.setDate(Math.min(30, ultimoDia));
    console.log(`   ⚠️ Fecha en día 1 detectada, vencimiento día 30 mismo mes`);
  } else {
    diaVencimiento = diaEsperado;
    const ultimoDia = new Date(fechaBase.getFullYear(), fechaBase.getMonth() + 1, 0).getDate();
    fechaBase.setDate(Math.min(diaVencimiento, ultimoDia));
  }

  const ajustarDiaVencimiento = (fecha: Date, dia: number): void => {
    const ultimoDiaMes = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0).getDate();
    fecha.setDate(Math.min(dia, ultimoDiaMes));
  };

  const fechaCuotaEsperadaAjustada = new Date(fechaBase.getFullYear(), fechaBase.getMonth(), 1);
  ajustarDiaVencimiento(fechaCuotaEsperadaAjustada, diaVencimiento);

  // Retroceder desde la cuota esperada hasta la cuota 1 (día 1 antes de setMonth para evitar overflow)
  const fechaPrimeraCuota = new Date(fechaCuotaEsperadaAjustada.getFullYear(), fechaCuotaEsperadaAjustada.getMonth(), 1);
  fechaPrimeraCuota.setMonth(fechaPrimeraCuota.getMonth() - (cuota_esperada - 1));
  ajustarDiaVencimiento(fechaPrimeraCuota, diaVencimiento);

  const fechaCuota0 = new Date(fechaPrimeraCuota.getFullYear(), fechaPrimeraCuota.getMonth(), 1);
  fechaCuota0.setMonth(fechaCuota0.getMonth() - 1);
  ajustarDiaVencimiento(fechaCuota0, diaVencimiento);

  const calcularFechaVencimiento = (numeroCuota: number): string => {
    const fecha = new Date(fechaPrimeraCuota.getFullYear(), fechaPrimeraCuota.getMonth(), 1);
    fecha.setMonth(fecha.getMonth() + (numeroCuota - 1));
    ajustarDiaVencimiento(fecha, diaVencimiento);
    return fecha.toISOString().split("T")[0];
  };

  console.log(`   ✅ Cuota 1 vence: ${calcularFechaVencimiento(1)}`);
  console.log(`   ✅ Cuota ${cuota_esperada} vence: ${fechaCuotaEsperadaAjustada.toISOString().split("T")[0]}`);
  console.log(`   ✅ Cuota 0 vence: ${fechaCuota0.toISOString().split("T")[0]}`);

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

    // 🔥 ACTUALIZAR LA CUOTA 0 - SOLO fecha_vencimiento (respetar pagado)
    if (cuota0) {
      const fechaCuota0Str = fechaCuota0.toISOString().split("T")[0];

      await tx
        .update(cuotas_credito)
        .set({ fecha_vencimiento: fechaCuota0Str })
        .where(eq(cuotas_credito.cuota_id, cuota0.cuota_id));

      await tx
        .update(pagos_credito)
        .set({ fecha_vencimiento: fechaCuota0Str })
        .where(eq(pagos_credito.cuota_id, cuota0.cuota_id));

      console.log(`   🔧 Cuota 0 fecha_vencimiento: ${fechaCuota0Str}`);
    }

    // 6️⃣ Recargar cuotas válidas y actualizar SOLO fecha_vencimiento
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
    console.log(`🔄 Actualizando fecha_vencimiento de ${cuotasConPagos.length} cuotas...`);

    await Promise.all(
      cuotasConPagos.map((row) => {
        const fechaVencimientoCuota = calcularFechaVencimiento(row.numero_cuota);
        const ops: Promise<unknown>[] = [
          tx
            .update(cuotas_credito)
            .set({ fecha_vencimiento: fechaVencimientoCuota })
            .where(eq(cuotas_credito.cuota_id, row.cuota_id)),
        ];
        if (row.pago_id) {
          ops.push(
            tx
              .update(pagos_credito)
              .set({ fecha_vencimiento: fechaVencimientoCuota })
              .where(eq(pagos_credito.pago_id, row.pago_id))
          );
        }
        return Promise.all(ops);
      })
    );

    console.log(`   ✅ ${cuotasConPagos.length} cuotas con fecha_vencimiento actualizada`);
  });

  console.log(`\n🎉 AJUSTE COMPLETADO`);
  console.log(`   📐 Plazo completo: ${plazo_completo} cuotas`);
  console.log(`   📅 Día de vencimiento: ${diaVencimiento}`);
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
    const trx = infoPagos?.ConsultaResultado?.EstadoCuenta_Transacciones?.[0];
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
      pago_pagado: pagos_credito.pagado,
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
        // Si el pago ya está marcado como pagado, no tocarlo
        if (row.pago_pagado) continue;

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
