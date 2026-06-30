import { and, eq, gte, inArray, isNull, lte, sql, sum } from "drizzle-orm";
import { db } from "../database";
import {
  pagos_credito,
  convenios_pago,
  convenios_pagos_resume,
  creditos,
  cuotas_credito,
  usuarios,
  platform_users,
  creditos_inversionistas,
  boletas,
  convenio_cuotas,
  moras_credito,
} from "../database/db";
import Big from "big.js";
import { createMora } from "./latefee";
import { getPagosDelMesActual } from "./payments";
import { creditRouter } from "../routers";

interface CreatePaymentAgreementInput {
  credit_id: number;
  payment_ids: number[];
  total_agreement_amount: number;
  number_of_months: number;
  reason?: string;
  observations?: string;
  created_by: number;
}

export async function createPaymentAgreement(
  input: CreatePaymentAgreementInput
) {
  try {
    console.log("🚀 ========== INICIANDO CREACIÓN DE CONVENIO ==========");
    console.log("📦 Input recibido:", JSON.stringify(input, null, 2));

    const {
      credit_id,
      payment_ids,
      total_agreement_amount,
      number_of_months,
      reason,
      observations,
      created_by,
    } = input;

    // ============================================
    // 📋 VALIDACIONES DE INPUT
    // ============================================
    console.log("✅ Paso 1: Validando input...");
    
    if (!credit_id || !payment_ids || payment_ids.length === 0) {
      throw new Error("Credit ID and payment IDs are required");
    }

    if (total_agreement_amount <= 0) {
      throw new Error("Total agreement amount must be greater than 0");
    }

    if (number_of_months <= 0) {
      throw new Error("Number of months must be greater than 0");
    }

    console.log("✅ Input validado correctamente");

    // ============================================
    // 👤 BUSCAR USUARIO CREADOR
    // ============================================
    console.log("✅ Paso 2: Buscando usuario creador...");
    
    const [usuario] = await db
      .select({ email: platform_users.email })
      .from(platform_users)
      .where(eq(platform_users.id, created_by))
      .limit(1);

    if (!usuario) {
      throw new Error("Usuario no encontrado");
    }

    console.log("✅ Usuario encontrado:", usuario.email);

    // ============================================
    // 💰 BUSCAR LOS PAGOS Y CUOTAS
    // ============================================
    console.log("✅ Paso 3: Buscando pagos y cuotas asociadas...");
    console.log("🔍 Payment IDs:", payment_ids);
    
    const pagos = await db
      .select({
        pago: pagos_credito,
        cuota: cuotas_credito,
      })
      .from(pagos_credito)
      .innerJoin(
        cuotas_credito,
        eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
      )
      .where(inArray(pagos_credito.pago_id, payment_ids));

    console.log("📊 Pagos encontrados:", pagos.length);
    console.log("📋 Detalle de pagos:", JSON.stringify(pagos, null, 2));

    if (pagos.length === 0) {
      throw new Error("No se encontraron pagos con los IDs proporcionados");
    }

    if (pagos.length !== payment_ids.length) {
      throw new Error("Algunos pagos no existen");
    }

    console.log("✅ Todos los pagos existen");

    // ============================================
    // 🔍 VERIFICAR QUE PERTENEZCAN AL MISMO CRÉDITO
    // ============================================
    console.log("✅ Paso 4: Verificando que todos los pagos pertenezcan al crédito...");
    
    const allFromSameCredit = pagos.every(
      (item) => (item.pago.credito_id ?? item.cuota.credito_id) === credit_id
    );
    console.log("📊 Crédito esperado:", credit_id);
    console.log("📊 Créditos en pagos:", pagos.map(p => p.pago.credito_id ?? p.cuota.credito_id));
    if (!allFromSameCredit) {
      console.error("❌ Pagos de diferentes créditos detectados!");
      console.error("Crédito esperado:", credit_id);
      console.error("Créditos en pagos:", pagos.map(p => p.pago.credito_id ?? p.cuota.credito_id));
      throw new Error("Todos los pagos deben pertenecer al mismo crédito");
    }

    console.log("✅ Todos los pagos pertenecen al crédito:", credit_id);

    // ============================================
    // ⚠️ VALIDAR QUE LOS PAGOS NO ESTÉN PAGADOS
    // ============================================
    console.log("✅ Paso 5: Validando que los pagos NO estén marcados como pagados...");
    
    const pagosPagados = pagos.filter((item) => item.pago.pagado === true);

    if (pagosPagados.length > 0) {
      console.error("❌ Pagos pagados detectados:", pagosPagados.length);
      const numerosCuotasPagadas = pagosPagados
        .map((item) => `Cuota #${item.cuota.numero_cuota}`)
        .join(", ");
      throw new Error(
        `Los siguientes pagos ya están marcados como pagados: ${numerosCuotasPagadas}`
      );
    }

    console.log("✅ Ningún pago está marcado como pagado");

    // ============================================
    // ⚠️ VALIDAR QUE LAS CUOTAS NO ESTÉN PAGADAS
    // ============================================
    console.log("✅ Paso 6: Validando que las cuotas NO estén pagadas (doble verificación)...");
    
    const cuotasPagadas = pagos.filter((item) => item.cuota.pagado === true);

    if (cuotasPagadas.length > 0) {
      console.error("❌ Cuotas pagadas detectadas:", cuotasPagadas.length);
      const numerosCuotasPagadas = cuotasPagadas
        .map((item) => `Cuota #${item.cuota.numero_cuota}`)
        .join(", ");
      throw new Error(
        `Las siguientes cuotas ya están pagadas: ${numerosCuotasPagadas}`
      );
    }

    console.log("✅ Ninguna cuota está pagada");

    // ============================================
    // 🏦 VERIFICAR QUE EL CRÉDITO EXISTA
    // ============================================
    console.log("✅ Paso 7: Verificando que el crédito exista...");
    
    const [creditExists] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, credit_id));

    if (!creditExists) {
      throw new Error("Crédito no encontrado");
    }

    console.log("✅ Crédito encontrado!");
    console.log("📊 Estado actual del crédito:", creditExists.statusCredit);
    console.log("📊 Cliente:", creditExists.credito_id);

    // ============================================
    // 🔍 VERIFICAR QUE NO TENGA CONVENIO ACTIVO
    // ============================================
    console.log("✅ Paso 8: Verificando que NO tenga un convenio activo...");
    
    const existingAgreement = await db
      .select()
      .from(convenios_pago)
      .where(
        and(
          eq(convenios_pago.credito_id, credit_id),
          eq(convenios_pago.activo, true),
          eq(convenios_pago.completado, false)
        )
      );

    if (existingAgreement.length > 0) {
      console.error("❌ Ya existe un convenio activo!");
      console.error("Convenio existente:", existingAgreement[0]);
      throw new Error("El crédito ya tiene un convenio de pago activo");
    }

    console.log("✅ No hay convenios activos para este crédito");

    // ============================================
    // 💵 CALCULAR CUOTA MENSUAL
    // ============================================
    console.log("✅ Paso 9: Calculando cuota mensual...");
    
    const monthly_installment = total_agreement_amount / number_of_months;
    
    console.log("💰 Monto total convenio:", total_agreement_amount);
    console.log("📅 Número de meses:", number_of_months);
    console.log("💵 Cuota mensual calculada:", monthly_installment);

    // ============================================
    // 📝 CREAR EL CONVENIO DE PAGO
    // ============================================
    console.log("✅ Paso 10: Creando el convenio de pago...");
    
    const [agreement] = await db
      .insert(convenios_pago)
      .values({
        credito_id: credit_id,
        monto_total_convenio: total_agreement_amount.toString(),
        numero_meses: number_of_months,
        cuota_mensual: monthly_installment.toString(),
        fecha_convenio: new Date(),
        monto_pagado: "0",
        monto_pendiente: total_agreement_amount.toString(),
        pagos_realizados: 0,
        pagos_pendientes: number_of_months,
        activo: false,
        completado: false,
        motivo: reason,
        observaciones: observations,
        created_by,
      })
      .returning();

    if (!agreement) {
      throw new Error("Error al crear el convenio de pago");
    }

    console.log("✅ Convenio creado exitosamente!");
    console.log("🆔 Convenio ID:", agreement.convenio_id);
    console.log("📋 Convenio completo:", JSON.stringify(agreement, null, 2));

    // ============================================
    // 🔗 ASOCIAR PAGOS AL CONVENIO (Tabla Pivot)
    // ============================================
    console.log("✅ Paso 11: Asociando pagos al convenio...");
    
    const agreementPaymentsData = payment_ids.map((pago_id) => ({
      convenio_id: agreement.convenio_id,
      pago_id: pago_id,
    }));

    console.log("📦 Datos a insertar en pivot:", agreementPaymentsData);

    await db.insert(convenios_pagos_resume).values(agreementPaymentsData);

    console.log("✅ Pagos asociados al convenio correctamente");

    // ============================================
    // 📅 CREAR LAS CUOTAS DEL CONVENIO
    // ============================================
    console.log("✅ Paso 12: Creando las cuotas del convenio...");

    // Obtener las cuotas pendientes del crédito para usar sus fechas de vencimiento
    const cuotasPendientesCredito = await db
      .select({
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
      })
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, credit_id),
          eq(cuotas_credito.pagado, false)
        )
      )
      .orderBy(cuotas_credito.numero_cuota)
      .limit(number_of_months);

    console.log(`📅 Cuotas pendientes del crédito encontradas: ${cuotasPendientesCredito.length}`);

    const cuotasConvenio = [];

    for (let i = 0; i < number_of_months; i++) {
      // Usar la fecha de vencimiento de la cuota del crédito si existe
      const fechaVencimiento = cuotasPendientesCredito[i]
        ? cuotasPendientesCredito[i].fecha_vencimiento
        : null;

      if (!fechaVencimiento) {
        console.log(`⚠️ No hay cuota pendiente #${i + 1} en el crédito, se omite`);
        continue;
      }

      cuotasConvenio.push({
        convenio_id: agreement.convenio_id,
        numero_cuota: i + 1,
        fecha_vencimiento: fechaVencimiento,
        fecha_pago: null, // NULL = no pagada
      });

      console.log(`📋 Cuota ${i + 1}: Vence el ${fechaVencimiento}`);
    }

    await db.insert(convenio_cuotas).values(cuotasConvenio);
    
    console.log("✅ Cuotas del convenio creadas exitosamente!");

    // ============================================
    // 🔄 ACTUALIZAR ESTADO DEL CRÉDITO
    // ============================================
    console.log("🔥 ========== ACTUALIZANDO ESTADO DEL CRÉDITO ==========");
    console.log("🔥 Crédito ID:", credit_id);
    console.log("🔥 Estado actual:", creditExists.statusCredit);
    console.log("🔥 Estado nuevo: EN_CONVENIO");
    console.log("🔥 Convenio ID:", agreement.convenio_id);
  // ============================================
    // 💸 ELIMINAR MORA ACTIVA (si existe)
    // ============================================
    console.log("✅ Paso 13: Eliminando mora activa del crédito (si existe)...");

    const morasEliminadas = await db
      .delete(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, credit_id),
          eq(moras_credito.activa, true)
        )
      )
      .returning();

    if (morasEliminadas.length > 0) {
      console.log(`✅ Se eliminaron ${morasEliminadas.length} mora(s) activa(s)`);
    } else {
      console.log("ℹ️ No había moras activas para eliminar");
    }
    const resultadoUpdate = await db
      .update(creditos)
      .set({
        statusCredit: "EN_CONVENIO",
      })
      .where(eq(creditos.credito_id, credit_id))
      .returning();

    console.log("🔥 Resultado del UPDATE:", JSON.stringify(resultadoUpdate, null, 2));
    console.log("🔥 Cantidad de registros actualizados:", resultadoUpdate.length);

    if (resultadoUpdate.length > 0) {
      console.log("✅ Nuevo estado del crédito:", resultadoUpdate[0].statusCredit);
      console.log("✅ ¡Estado actualizado correctamente!");
    } else {
      console.error("❌ NO SE ACTUALIZÓ NINGÚN REGISTRO!");
      console.error("❌ Verificar que el credit_id existe:", credit_id);
    }

    console.log("🔥 ========== FIN ACTUALIZACIÓN DE ESTADO ==========");

    // ============================================
    // 🎉 RESPUESTA EXITOSA
    // ============================================
    console.log("🎉 ========== CONVENIO CREADO EXITOSAMENTE ==========");
    console.log("✅ Todo el proceso completado sin errores");
    console.log("🆔 Convenio ID:", agreement.convenio_id);
    console.log("💰 Monto total:", total_agreement_amount);
    console.log("📅 Cuotas creadas:", number_of_months);
    console.log("📊 Estado del crédito:", resultadoUpdate[0]?.statusCredit || "UNKNOWN");
    console.log("🎉 ========================================");

    return {
      success: true,
      data: agreement,
      message: "Convenio de pago creado exitosamente",
    };
  } catch (error) {
    console.error("💥 ========== ERROR EN CREACIÓN DE CONVENIO ==========");
    console.error("❌ Error:", error);
    console.error("❌ Mensaje:", error instanceof Error ? error.message : "Error desconocido");
    console.error("❌ Stack:", error instanceof Error ? error.stack : "No stack available");
    console.error("💥 ========================================");

    return {
      success: false,
      data: null,
      message: error instanceof Error ? error.message : "Error desconocido",
      error: error,
    };
  }
}
interface GetPaymentAgreementsFilters {
  credit_id?: number;
  start_date?: Date;
  end_date?: Date;
  year?: number;
  month?: number;
  day?: number;
  status?: "active" | "completed" | "inactive" | "all";
}

export async function getPaymentAgreements(
  filters: GetPaymentAgreementsFilters = {}
) {
  try {
    const {
      credit_id,
      start_date,
      end_date,
      year,
      month,
      day,
      status = "all",
    } = filters;

    // Validate date inputs
    if (start_date && end_date && start_date > end_date) {
      throw new Error("Start date cannot be after end date");
    }

    if (month && (month < 1 || month > 12)) {
      throw new Error("Month must be between 1 and 12");
    }

    if (day && (day < 1 || day > 31)) {
      throw new Error("Day must be between 1 and 31");
    }

    if (year && year < 1900) {
      throw new Error("Invalid year");
    }

    // Build the query dynamically based on filters
    const conditions = [];

    // Filter by credit_id if provided
    if (credit_id) {
      conditions.push(eq(convenios_pago.credito_id, credit_id));
    }

    // Filter by status
    if (status === "active") {
      conditions.push(eq(convenios_pago.activo, true));
      conditions.push(eq(convenios_pago.completado, false));
    } else if (status === "completed") {
      conditions.push(eq(convenios_pago.completado, true));
    } else if (status === "inactive") {
      conditions.push(eq(convenios_pago.activo, false));
    }

    // Filter by date range
    if (start_date) {
      conditions.push(gte(convenios_pago.fecha_convenio, start_date));
    }
    if (end_date) {
      conditions.push(lte(convenios_pago.fecha_convenio, end_date));
    }

    // Filter by year
    if (year) {
      conditions.push(
        sql`EXTRACT(YEAR FROM ${convenios_pago.fecha_convenio}) = ${year}`
      );
    }

    // Filter by month
    if (month) {
      conditions.push(
        sql`EXTRACT(MONTH FROM ${convenios_pago.fecha_convenio}) = ${month}`
      );
    }

    // Filter by day
    if (day) {
      conditions.push(
        sql`EXTRACT(DAY FROM ${convenios_pago.fecha_convenio}) = ${day}`
      );
    }

    // Apply all conditions and execute query
    const agreements =
      conditions.length > 0
        ? await db
            .select()
            .from(convenios_pago)
            .where(and(...conditions))
        : await db.select().from(convenios_pago);

    if (!agreements || agreements.length === 0) {
      return {
        success: true,
        data: [],
        message: "No payment agreements found",
      };
    }

    // Get detailed info for each agreement
    const agreementsWithDetails = await Promise.all(
      agreements.map(async (agreement) => {
        try {
          // Get all payments associated with this agreement
          const paymentsResume = await db
            .select({
              payment_id: convenios_pagos_resume.pago_id,
              payment: pagos_credito,
            })
            .from(convenios_pagos_resume)
            .innerJoin(
              pagos_credito,
              eq(convenios_pagos_resume.pago_id, pagos_credito.pago_id)
            )
            .where(
              eq(convenios_pagos_resume.convenio_id, agreement.convenio_id)
            );

          // Format payment details
          const payments = paymentsResume.map((pr) => ({
            payment_id: pr.payment_id,
            cuota_id: pr.payment.cuota_id,
            fecha_pago: pr.payment.fecha_pago,
            monto_boleta: pr.payment.monto_boleta,
            pagado: pr.payment.pagado,
            // Payment breakdown
            abonos: {
              abono_capital: pr.payment.abono_capital,
              abono_interes: pr.payment.abono_interes,
              abono_iva_12: pr.payment.abono_iva_12,
              abono_interes_ci: pr.payment.abono_interes_ci,
              abono_iva_ci: pr.payment.abono_iva_ci,
              abono_seguro: pr.payment.abono_seguro,
              abono_gps: pr.payment.abono_gps,
              pago_del_mes: pr.payment.pago_del_mes,
            },
            // Remaining amounts
            restantes: {
              capital_restante: pr.payment.capital_restante,
              interes_restante: pr.payment.interes_restante,
              iva_12_restante: pr.payment.iva_12_restante,
              seguro_restante: pr.payment.seguro_restante,
              gps_restante: pr.payment.gps_restante,
              total_restante: pr.payment.total_restante,
            },
            mora: pr.payment.mora,
            otros: pr.payment.otros,
            observaciones: pr.payment.observaciones,
            mes_pagado: pr.payment.mes_pagado,
          }));

          // Calculate totals from payments
          const total_paid_from_payments = payments.reduce(
            (sum, p) => sum + (Number(p.monto_boleta) || 0),
            0
          );

          const paid_payments_count = payments.filter((p) => p.pagado).length;

          const progress =
            Number(agreement.monto_total_convenio) > 0
              ? (
                  (Number(agreement.monto_pagado) /
                    Number(agreement.monto_total_convenio)) *
                  100
                ).toFixed(2)
              : "0.00";

          return {
            ...agreement,
            payments,
            summary: {
              total_payments: payments.length,
              paid_payments: paid_payments_count,
              unpaid_payments: payments.length - paid_payments_count,
              total_paid_from_payments,
              progress_percentage: progress,
            },
          };
        } catch (error) {
          console.error(
            `Error processing agreement ${agreement.convenio_id}:`,
            error
          );
          // Return agreement without details if there's an error
          return {
            ...agreement,
            payments: [],
            summary: {
              total_payments: 0,
              paid_payments: 0,
              unpaid_payments: 0,
              total_paid_from_payments: 0,
              progress_percentage: "0.00",
            },
            error: "Failed to load payment details",
          };
        }
      })
    );

    return {
      success: true,
      data: agreementsWithDetails,
      message: `Found ${agreementsWithDetails.length} payment agreement(s)`,
    };
  } catch (error) {
    console.error("Error getting payment agreements:", error);

    return {
      success: false,
      data: [],
      message:
        error instanceof Error ? error.message : "Unknown error occurred",
      error: error,
    };
  }
}

interface ProcessConvenioPaymentParams {
  credito_id: number;
  numero_credito_sifco?: string;
  monto_pago: number;
  // 🔥 Info precargada del crédito
  creditoInfo: {
    credito: typeof creditos.$inferSelect;
    inversionistas: Array<typeof creditos_inversionistas.$inferSelect>;
    cuotasPendientes: Array<{
      cuotas_credito: typeof cuotas_credito.$inferSelect;
      pagos_credito: typeof pagos_credito.$inferSelect;
    }>;
    mora?: {
      activa: boolean;
      cuotas_atrasadas: number;
      monto_mora: Big;
      porcentaje_mora: number;
      mora_id: number;
      credito_id: number;
      created_at: Date;
      updated_at: Date;
    } | null;
  };
  // 🔥 Metadata del pago
  pagoMetadata: {
    montoBoleta: string;
    llamada?: string;
    renuevo_o_nuevo?: string;
    observaciones?: string;
    numeroAutorizacion?: string;
    banco_id?: number;
    registerBy: number;
    urlCompletas?: string[];
  };
}

interface ProcessConvenioPaymentResult {
  success: boolean;
  message: string;
  convenio: {
    convenio_id: number;
    monto_total_convenio: string;
    monto_pagado: string;
    monto_pendiente: string;
    cuota_mensual: string;
    pagos_realizados: number;
    pagos_pendientes: number;
    completado: boolean;
    activo: boolean;
  } | null;
  pago_completo: boolean;
  monto_aplicado: string;
  monto_restante: string; 
}

export async function processConvenioPayment(
  params: ProcessConvenioPaymentParams
): Promise<ProcessConvenioPaymentResult> {
  try {
    const { credito_id, numero_credito_sifco, monto_pago, creditoInfo, pagoMetadata } = params;

    // 1. Validar que se haya proporcionado credito_id o numero_credito_sifco
    if (!credito_id && !numero_credito_sifco) {
      throw new Error("Debe proporcionar credito_id o numero_credito_sifco");
    }

    // 2. Buscar el convenio activo del crédito
    const [convenio] = await db
      .select()
      .from(convenios_pago)
      .where(
        and(
          eq(convenios_pago.credito_id, credito_id!),
          eq(convenios_pago.activo, true),
          eq(convenios_pago.completado, false)
        )
      )
      .limit(1);

    if (!convenio) {
      return {
        success: false,
        message: "No active payment agreement found for this credit",
        convenio: null,
        pago_completo: false,
        monto_aplicado: "0",
        monto_restante: "0",  
      };
    }

    // 3. Convertir valores a Big.js para cálculos precisos
    const montoPagoBig = new Big(monto_pago);
    const cuotaMensualBig = new Big(convenio.cuota_mensual);
    const montoPagadoActualBig = new Big(convenio.monto_pagado);
    const montoPendienteActualBig = new Big(convenio.monto_pendiente);

    // 4. Determinar el monto a aplicar
    let montoAplicarBig: Big;
    let pagoCompleto = false;

    // Si el monto es >= a la cuota mensual, usar solo la cuota mensual
    if (montoPagoBig.gte(cuotaMensualBig)) {
      montoAplicarBig = cuotaMensualBig;
      pagoCompleto = true;
    } else {
      // Si es menor, usar el monto completo
      montoAplicarBig = montoPagoBig;
      pagoCompleto = false;
    }

    // 5. Calcular nuevo monto pagado
    const nuevoMontoPagadoBig = montoPagadoActualBig.plus(montoAplicarBig);

    // 6. Calcular nuevo monto pendiente
    const nuevoMontoPendienteBig = montoPendienteActualBig.minus(montoAplicarBig);

    // 7. Actualizar pagos realizados y pendientes solo si se completó la cuota
    let nuevosPagosRealizados = convenio.pagos_realizados;
    let nuevosPagosPendientes = convenio.pagos_pendientes;

    if (pagoCompleto) {
      nuevosPagosRealizados = convenio.pagos_realizados + 1;
      nuevosPagosPendientes = convenio.pagos_pendientes - 1;
    }

    // 8. Verificar si se completó el convenio
    const convenioCompletado = nuevoMontoPendienteBig.lte(0) || nuevosPagosPendientes <= 0;

    // 9. Actualizar el convenio
    const [convenioActualizado] = await db
      .update(convenios_pago)
      .set({
        monto_pagado: nuevoMontoPagadoBig.toFixed(2),
        monto_pendiente: nuevoMontoPendienteBig.toFixed(2),
        pagos_realizados: nuevosPagosRealizados,
        pagos_pendientes: nuevosPagosPendientes,
        completado: convenioCompletado,
        activo: !convenioCompletado, // Si se completó, ya no está activo
        updated_at: new Date(),
      })
      .where(eq(convenios_pago.convenio_id, convenio.convenio_id))
      .returning();

    // 10. 🔥 SI SE COMPLETÓ LA CUOTA DEL CONVENIO, MARCAR LA CUOTA COMO PAGADA
   if (pagoCompleto) {
  console.log("✅ Pago completo detectado, marcando cuota del convenio como pagada");
  
  // Buscar la primera cuota pendiente del convenio (fecha_pago = NULL)
  const [cuotaPendiente] = await db
    .select()
    .from(convenio_cuotas)
    .where(
      and(
        eq(convenio_cuotas.convenio_id, convenio.convenio_id),
        isNull(convenio_cuotas.fecha_pago) // Las que NO tienen fecha_pago
      )
    )
    .orderBy(convenio_cuotas.numero_cuota)
    .limit(1);
  
  if (cuotaPendiente) {
    console.log(`📅 Marcando cuota #${cuotaPendiente.numero_cuota} como pagada`);
    
    // 🔥 Obtener fecha y hora de Guatemala
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
    const fechaGuatemala = new Date(`${year}-${month}-${day}T${timePart}`);
    
    await db
      .update(convenio_cuotas)
      .set({
        fecha_pago: fechaGuatemala, // 👈 Fecha y hora de Guatemala
      })
      .where(eq(convenio_cuotas.cuota_convenio_id, cuotaPendiente.cuota_convenio_id));
    
    console.log(`✅ Cuota #${cuotaPendiente.numero_cuota} marcada como pagada exitosamente`);
  } else {
    console.log("⚠️ No se encontró cuota pendiente para marcar como pagada");
  }
} else {
  console.log("⚠️ Pago parcial - no se marca cuota del convenio como pagada");
}

   

    // 12. Retornar resultado
    return {
      success: true,
      message: convenioCompletado
        ? "¡Convenio completado exitosamente!"
        : pagoCompleto
          ? "Pago de cuota completa registrado exitosamente"
          : "Pago parcial registrado exitosamente",
      convenio: {
        convenio_id: convenioActualizado.convenio_id,
        monto_total_convenio: convenioActualizado.monto_total_convenio,
        monto_pagado: convenioActualizado.monto_pagado,
        monto_pendiente: convenioActualizado.monto_pendiente,
        cuota_mensual: convenioActualizado.cuota_mensual,
        pagos_realizados: convenioActualizado.pagos_realizados,
        pagos_pendientes: convenioActualizado.pagos_pendientes,
        completado: convenioActualizado.completado,
        activo: convenioActualizado.activo,
      },
      pago_completo: pagoCompleto,
      monto_aplicado: montoAplicarBig.toFixed(2),
      monto_restante: nuevoMontoPendienteBig.toFixed(2),
    };
  } catch (error) {
    console.error("Error procesando pago de convenio:", error);
    throw new Error(
      `Error al procesar pago de convenio: ${error instanceof Error ? error.message : "Error desconocido"}`
    );
  }
}

interface ProcessConvenioCuotasParams {
  convenio_id: number;
  monto_disponible: number;
  // 🔥 Info precargada del crédito (OPTIMIZADO)
  creditoInfo: {
    credito: typeof creditos.$inferSelect;
    inversionistas: Array<typeof creditos_inversionistas.$inferSelect>;
    cuotasPendientes: Array<{
      cuotas_credito: typeof cuotas_credito.$inferSelect;
      pagos_credito: typeof pagos_credito.$inferSelect;
    }>;
    mora?: {
      activa: boolean;
      cuotas_atrasadas: number;
      monto_mora: Big;
      porcentaje_mora: number;
      mora_id: number;
      credito_id: number;
      created_at: Date;
      updated_at: Date;
    } | null;
  };
  // 🔥 Datos adicionales del pago
  pagoMetadata: {
    montoBoleta: string;
    llamada?: string;
    renuevo_o_nuevo?: string;
    observaciones?: string;
    numeroAutorizacion?: string;
    banco_id?: number;
    registerBy: number;
    urlCompletas?: string[];
  };
}

interface ConvenioCuotaProcessed {
  pago_id: number;
  numero_cuota: number;
  monto_original: string;
  monto_aplicado: string;
  pagado_completo: boolean;
  restantes: {
    capital: string;
    interes: string;
    iva: string;
    seguro: string;
    gps: string;
    membresias: string;
  };
}

export async function processConvenioCuotas(
  params: ProcessConvenioCuotasParams
) {
  try {
    const { convenio_id, monto_disponible, creditoInfo, pagoMetadata } = params;

    console.log("\n🔵 ========== INICIANDO PROCESO DE CUOTAS DE CONVENIO ==========");
    console.log("📋 Convenio ID:", convenio_id);
    console.log("💰 Monto disponible:", monto_disponible);

    // 1. Obtener cuotas del convenio (las que están en convenios_pagos_resume)
    const cuotasConvenio = await db
      .select({
        resume_id: convenios_pagos_resume.id,
        pago_id: convenios_pagos_resume.pago_id,
        created_at: convenios_pagos_resume.created_at,
        pago: pagos_credito,
        cuota: cuotas_credito,
        convenio: convenios_pago,
      })
      .from(convenios_pagos_resume)
      .innerJoin(
        pagos_credito,
        eq(convenios_pagos_resume.pago_id, pagos_credito.pago_id)
      )
      .innerJoin(
        cuotas_credito,
        eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
      )
      .innerJoin(convenios_pago, eq(convenios_pagos_resume.convenio_id, convenios_pago.convenio_id))
      .where(eq(convenios_pagos_resume.convenio_id, convenio_id))
      .orderBy(cuotas_credito.numero_cuota);

    if (cuotasConvenio.length === 0) {
      throw new Error("No se encontraron cuotas para este convenio");
    }

    console.log(`📊 Total de cuotas en convenio: ${cuotasConvenio.length}`);

    // 2. 🔥 Usar info precargada (YA NO HACEMOS QUERIES)
    const { credito, inversionistas, mora } = creditoInfo;
    const { montoBoleta, urlCompletas, registerBy, numeroAutorizacion, banco_id, observaciones, llamada, renuevo_o_nuevo } = pagoMetadata;

    console.log("✅ Usando información precargada del crédito (OPTIMIZADO)");
    console.log(`👥 Total inversionistas: ${inversionistas.length}`);

    // 3. Calcular totales de cash_in de inversionistas
    let total_monto_cash_in = new Big(0);
    let total_iva_cash_in = new Big(0);

    inversionistas.forEach(({ monto_cash_in, iva_cash_in }) => {
      total_monto_cash_in = total_monto_cash_in.plus(monto_cash_in);
      total_iva_cash_in = total_iva_cash_in.plus(iva_cash_in);
    });

    console.log("💰 Total monto cash in:", total_monto_cash_in.toString());
    console.log("💰 Total IVA cash in:", total_iva_cash_in.toString());

    // 4. Variables de control
    let disponible_restante = new Big(monto_disponible);
    const cuotasProcesadas: ConvenioCuotaProcessed[] = [];
    let cuotas_completas = 0;
    let cuotas_parciales = 0;

    // 5. 🔥 PROCESAR CADA CUOTA (IGUAL QUE EL FOR ORIGINAL)
    for (const cuotaData of cuotasConvenio) {
      console.log("\n===============================");
      console.log(`🚀 Procesando cuota #${cuotaData.cuota.numero_cuota}`);
      console.log(`💰 Disponible antes de cuota: $${disponible_restante.toString()}`);

      if (disponible_restante.lte(0)) {
        console.log("⛔ Sin saldo disponible, deteniendo proceso");
        break;
      }

      // 6. Obtener los restantes del pago existente
      const interes_restante = new Big(cuotaData.pago.interes_restante ?? 0);
      const iva_restante = new Big(cuotaData.pago.iva_12_restante ?? 0);
      const seguro_restante = new Big(cuotaData.pago.seguro_restante ?? 0);
      const gps_restante = new Big(cuotaData.pago.gps_restante ?? 0);
      const membresias_restante = new Big(cuotaData.pago.membresias ?? 0);
      const capital_restante_pago = new Big(cuotaData.pago.capital_restante ?? 0);

      // 7. Inicializar abonos
      let abono_interes = new Big(0);
      let abono_iva_12 = new Big(0);
      let abono_seguro = new Big(0);
      let abono_gps = new Big(0);
      let abono_capital = new Big(0);
      let abono_membresias = new Big(0);
      
      // Abonos de cash in (de inversionistas)
      const abono_interes_ci = new Big(total_monto_cash_in);
      const abono_iva_ci = new Big(total_iva_cash_in);

      console.log("🔍 ========== INICIO DISTRIBUCIÓN DE PAGO ==========");
      console.log("💰 Monto disponible inicial:", disponible_restante.toString());

      // 8. 🔥 APLICAR PAGOS EN CASCADA (IGUAL QUE EL FOR ORIGINAL)

      // 8.1 Pagar interés
      console.log("\n📌 PASO 1: Pagar Interés");
      console.log("   Interés restante:", interes_restante.toString());
      if (disponible_restante.gt(0) && interes_restante.gt(0)) {
        const pago = disponible_restante.lt(interes_restante)
          ? disponible_restante
          : interes_restante;
        console.log("   ✅ Pago a aplicar:", pago.toString());
        abono_interes = pago;
        disponible_restante = disponible_restante.minus(pago);
        console.log("   💵 Disponible restante:", disponible_restante.toString());
      } else {
        console.log("   ⏭️  Saltado (sin saldo o sin deuda)");
      }

      // 8.2 Pagar IVA
      console.log("\n📌 PASO 2: Pagar IVA");
      console.log("   IVA restante:", iva_restante.toString());
      if (disponible_restante.gt(0) && iva_restante.gt(0)) {
        const pago = disponible_restante.lt(iva_restante)
          ? disponible_restante
          : iva_restante;
        console.log("   ✅ Pago a aplicar:", pago.toString());
        abono_iva_12 = pago;
        disponible_restante = disponible_restante.minus(pago);
        console.log("   💵 Disponible restante:", disponible_restante.toString());
      } else {
        console.log("   ⏭️  Saltado (sin saldo o sin deuda)");
      }

      // 8.3 Pagar seguro
      console.log("\n📌 PASO 3: Pagar Seguro");
      console.log("   Seguro restante:", seguro_restante.toString());
      if (disponible_restante.gt(0) && seguro_restante.gt(0)) {
        const pago = disponible_restante.lt(seguro_restante)
          ? disponible_restante
          : seguro_restante;
        console.log("   ✅ Pago a aplicar:", pago.toString());
        abono_seguro = pago;
        disponible_restante = disponible_restante.minus(pago);
        console.log("   💵 Disponible restante:", disponible_restante.toString());
      } else {
        console.log("   ⏭️  Saltado (sin saldo o sin deuda)");
      }

      // 8.4 Pagar GPS
      console.log("\n📌 PASO 4: Pagar GPS");
      console.log("   GPS restante:", gps_restante.toString());
      if (disponible_restante.gt(0) && gps_restante.gt(0)) {
        const pago = disponible_restante.lt(gps_restante)
          ? disponible_restante
          : gps_restante;
        console.log("   ✅ Pago a aplicar:", pago.toString());
        abono_gps = pago;
        disponible_restante = disponible_restante.minus(pago);
        console.log("   💵 Disponible restante:", disponible_restante.toString());
      } else {
        console.log("   ⏭️  Saltado (sin saldo o sin deuda)");
      }

      // 8.5 Pagar membresías
      console.log("\n📌 PASO 5: Pagar Membresías");
      console.log("   Membresías restante:", membresias_restante.toString());
      if (disponible_restante.gt(0) && membresias_restante.gt(0)) {
        const pago = disponible_restante.lt(membresias_restante)
          ? disponible_restante
          : membresias_restante;
        console.log("   ✅ Pago a aplicar:", pago.toString());
        abono_membresias = pago;
        disponible_restante = disponible_restante.minus(pago);
        console.log("   💵 Disponible restante:", disponible_restante.toString());
      } else {
        console.log("   ⏭️  Saltado (sin saldo o sin deuda)");
      }

      // 8.6 Pagar capital
      console.log("\n📌 PASO 6: Pagar Capital");
      console.log("   Capital restante:", capital_restante_pago.toString());
      if (disponible_restante.gt(0) && capital_restante_pago.gt(0)) {
        const pago = disponible_restante.lt(capital_restante_pago)
          ? disponible_restante
          : capital_restante_pago;
        console.log("   ✅ Pago a aplicar:", pago.toString());
        abono_capital = pago;
        disponible_restante = disponible_restante.minus(pago);
        console.log("   💵 Disponible restante:", disponible_restante.toString());
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

      // 9. CALCULAR NUEVOS RESTANTES
      console.log("\n🔍 ========== CALCULANDO NUEVOS RESTANTES ==========");
      const nuevo_interes_restante = interes_restante.minus(abono_interes);
      const nuevo_iva_restante = iva_restante.minus(abono_iva_12);
      const nuevo_seguro_restante = seguro_restante.minus(abono_seguro);
      const nuevo_gps_restante = gps_restante.minus(abono_gps);
      const nuevo_membresias_restante = membresias_restante.minus(abono_membresias);
      const nuevo_capital_restante = capital_restante_pago.minus(abono_capital);

      console.log("📊 Nuevo Interés Restante:", nuevo_interes_restante.toString());
      console.log("📊 Nuevo IVA Restante:", nuevo_iva_restante.toString());
      console.log("📊 Nuevo Seguro Restante:", nuevo_seguro_restante.toString());
      console.log("📊 Nuevo GPS Restante:", nuevo_gps_restante.toString());
      console.log("📊 Nuevo Membresías Restante:", nuevo_membresias_restante.toString());
      console.log("📊 Nuevo Capital Restante:", nuevo_capital_restante.toString());

      // 10. Calcular pago del mes
      console.log("\n🔍 ========== CALCULANDO PAGO DEL MES ==========");
      const pago_del_mes = await getPagosDelMesActual(credito.credito_id);
      console.log("💰 Pago del mes actual (DB):", pago_del_mes);
      console.log("💵 Monto boleta actual:", montoBoleta);

      const montoBig = new Big(montoBoleta);
      const pago_del_mesBig = new Big(pago_del_mes ?? 0).add(montoBig);
      console.log("💵 Pago del mes TOTAL:", pago_del_mesBig.toString());
      console.log("🔍 ========== FIN ==========\n");

      // 11. Verificar si la cuota está pagada completamente
      const cuota_pagada =
        nuevo_interes_restante.eq(0) &&
        nuevo_iva_restante.eq(0) &&
        nuevo_seguro_restante.eq(0) &&
        nuevo_gps_restante.eq(0) &&
        nuevo_membresias_restante.eq(0) &&
        nuevo_capital_restante.eq(0);

      console.log(cuota_pagada ? "✅ CUOTA PAGADA COMPLETAMENTE" : "⚠️ CUOTA CON PAGO PARCIAL");

      // 12. 🔥 Calcular mora (si hay)
      const moraBig = mora?.activa ? new Big(mora.monto_mora) : new Big(0);

      // 13. Preparar datos del pago
      const currentDate = new Date();
      const months = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
      ];
      const mes_pagado = months[currentDate.getMonth()];
      
      const paymentFalse = cuotaData.pago.paymentFalse ?? false;
      
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
      const fechaGuatemala = new Date(`${year}-${month}-${day}T${timePart}`);

      // 14. Preparar pagoData
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
        monto_boleta: montoBig.toString(),
        capital_restante: nuevo_capital_restante.toString(),
        interes_restante: nuevo_interes_restante.toString(),
        iva_12_restante: nuevo_iva_restante.toString(),
        seguro_restante: nuevo_seguro_restante.toString(),
        gps_restante: nuevo_gps_restante.toString(),
        numero_cuota: cuotaData.cuota.numero_cuota,
        llamada: llamada ?? "",
        fecha_pago: fechaGuatemala,
        renuevo_o_nuevo: renuevo_o_nuevo ?? "",
        tipoCredito: " ",
        membresias: nuevo_membresias_restante.toString(),
        membresias_pago: abono_membresias.toString(),
        membresias_mes: abono_membresias.toString(),
        otros: "0",
        mora: moraBig.toString(),
        monto_boleta_cuota: montoBig.toString(),
        seguro_total: credito.seguro_10_cuotas?.toString() ?? "0",
        pagado: cuota_pagada,
        facturacion: "si",
        mes_pagado,
        seguro_facturado: abono_seguro.toString() ?? "0",
        gps_facturado: abono_gps.toString() ?? "0",
        reserva: "0",
        observaciones: observaciones ?? "",
        validate: false,
        validationStatus: "pending" as const,
        paymentFalse: paymentFalse,
        numeroAutorizacion: numeroAutorizacion ?? null,
        banco_id: banco_id ?? null,
        registerBy: registerBy.toString(),
        pagoConvenio: cuotaData.convenio.cuota_mensual
      };

      // 15. 🔥 UPDATE O INSERT SEGÚN ESTÉ PAGADA O NO
      type PagoCredito = typeof pagos_credito.$inferSelect;
      let pagoInsertado: PagoCredito | undefined;

      if (cuota_pagada) {
        // ✅ CUOTA PAGADA COMPLETAMENTE - UPDATE
        cuotas_completas++;
        console.log(`✅ Cuota ${cuotaData.cuota.numero_cuota} PAGADA COMPLETAMENTE`);

        [pagoInsertado] = await db
          .update(pagos_credito)
          .set(pagoData)
          .where(eq(pagos_credito.pago_id, cuotaData.pago_id))
          .returning();

        // Marcar la cuota como pagada
        await db
          .update(cuotas_credito)
          .set({ pagado: true })
          .where(eq(cuotas_credito.cuota_id, cuotaData.cuota.cuota_id));

        // Insertar boletas si hay
        if (pagoInsertado?.pago_id && urlCompletas && urlCompletas.length > 0) {
          await db.insert(boletas).values(
            urlCompletas.map((url) => ({
              pago_id: pagoInsertado!.pago_id,
              url_boleta: url,
            }))
          );
        }
      } else {
        // ⚠️ CUOTA CON PAGO PARCIAL - UPDATE RESTANTES + INSERT NUEVO PAGO
        cuotas_parciales++;
        console.log(`⚠️ Cuota ${cuotaData.cuota.numero_cuota} con PAGO PARCIAL`);

        // Actualizar restantes en el pago existente
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
          .where(eq(pagos_credito.pago_id, cuotaData.pago_id));

        // Insertar nuevo registro de pago parcial
        [pagoInsertado] = await db
          .insert(pagos_credito)
          .values({
            cuota_id: cuotaData.cuota.cuota_id,
            monto_boleta: pagoData.monto_boleta,
            renuevo_o_nuevo: pagoData.renuevo_o_nuevo,
            credito_id: pagoData.credito_id,
            cuota: credito.cuota.toString(),
            cuota_interes: credito.cuota_interes.toString(),
            fecha_pago: fechaGuatemala,
            fecha_vencimiento: cuotaData.cuota.fecha_vencimiento,
            abono_capital: pagoData.abono_capital,
            abono_interes: pagoData.abono_interes,
            abono_iva_12: pagoData.abono_iva_12,
            abono_interes_ci: pagoData.abono_interes_ci,
            abono_iva_ci: pagoData.abono_iva_ci,
            abono_seguro: pagoData.abono_seguro,
            abono_gps: pagoData.abono_gps,
            pago_del_mes: pagoData.pago_del_mes,
            capital_restante: pagoData.capital_restante,
            interes_restante: pagoData.interes_restante,
            iva_12_restante: pagoData.iva_12_restante,
            seguro_restante: pagoData.seguro_restante,
            gps_restante: pagoData.gps_restante,
            membresias: pagoData.membresias,
            membresias_pago: pagoData.membresias_pago,
            membresias_mes: pagoData.membresias_mes,
            llamada: pagoData.llamada || "",
            otros: pagoData.otros,
            mora: pagoData.mora,
            monto_boleta_cuota: pagoData.monto_boleta_cuota,
            observaciones: pagoData.observaciones,
            seguro_total: pagoData.seguro_total,
            seguro_facturado: pagoData.seguro_facturado,
            gps_facturado: pagoData.gps_facturado,
            reserva: pagoData.reserva,
            pagado: false,
            facturacion: pagoData.facturacion || "si",
            mes_pagado: pagoData.mes_pagado,
            paymentFalse: pagoData.paymentFalse || false,
            validationStatus: pagoData.validationStatus || "pending",
            banco_id: pagoData.banco_id || null,
            numeroAutorizacion: pagoData.numeroAutorizacion || null,
            registerBy: pagoData.registerBy.toString(),
            pagoConvenio: pagoData.pagoConvenio,
            monto_aplicado: pagoData.monto_boleta,
          })
          .returning();

        console.log("pagoInsertado cuota parcial:", pagoInsertado);

        // Insertar boletas si hay
        if (pagoInsertado?.pago_id && urlCompletas && urlCompletas.length > 0) {
          await db.insert(boletas).values(
            urlCompletas.map((url) => ({
              pago_id: pagoInsertado!.pago_id,
              url_boleta: url,
            }))
          );
        }
      }

      // 16. Guardar resultado procesado
      const montoAplicado = abono_interes
        .plus(abono_iva_12)
        .plus(abono_seguro)
        .plus(abono_gps)
        .plus(abono_membresias)
        .plus(abono_capital);

      cuotasProcesadas.push({
        pago_id: pagoInsertado?.pago_id ?? cuotaData.pago_id,
        numero_cuota: cuotaData.cuota.numero_cuota,
        monto_original: cuotaData.pago.monto_boleta ?? "0",
        monto_aplicado: montoAplicado.toString(),
        pagado_completo: cuota_pagada,
        restantes: {
          capital: nuevo_capital_restante.toString(),
          interes: nuevo_interes_restante.toString(),
          iva: nuevo_iva_restante.toString(),
          seguro: nuevo_seguro_restante.toString(),
          gps: nuevo_gps_restante.toString(),
          membresias: nuevo_membresias_restante.toString(),
        },
      });

      // 17. Si ya no hay saldo disponible, salir del loop
      if (disponible_restante.lte(0)) {
        console.log("⛔ Sin saldo disponible, deteniendo proceso");
        break;
      }
    }

    console.log("\n🔵 ========== FIN PROCESO DE CUOTAS DE CONVENIO ==========");
    console.log(`✅ Total de cuotas procesadas: ${cuotasProcesadas.length}`);
    console.log(`✅ Cuotas completadas: ${cuotas_completas}`);
    console.log(`⚠️ Cuotas parciales: ${cuotas_parciales}`);
    console.log(`💰 Saldo restante: ${disponible_restante.toString()}`);

    return {
      success: true,
      cuotas_procesadas: cuotasProcesadas,
      monto_aplicado_total: new Big(monto_disponible)
        .minus(disponible_restante)
        .toString(),
      saldo_restante: disponible_restante.toString(),
      cuotas_completas,
      cuotas_parciales,
    };
  } catch (error) {
    console.error("Error procesando cuotas del convenio:", error);
    throw new Error(
      `Error al procesar cuotas del convenio: ${error instanceof Error ? error.message : "Error desconocido"}`
    );
  }
}


export const updateConvenioStatus = async (
  convenio_id: number,
  status: boolean
) => {
  try {
    // 1. Obtener el convenio para saber el credito_id
    const [convenio] = await db
      .select({ credito_id: convenios_pago.credito_id })
      .from(convenios_pago)
      .where(eq(convenios_pago.convenio_id, convenio_id));

    if (!convenio) {
      return { success: false, message: "Convenio no encontrado" };
    }

    const creditoId = convenio.credito_id;

    // 2. Si status = false, ELIMINAR el convenio y procesar mora
    if (!status) {
      console.log("🔴 Eliminando convenio y procesando mora...");

      // Eliminar cuotas del convenio
      await db
        .delete(convenio_cuotas)
        .where(eq(convenio_cuotas.convenio_id, convenio_id));
      console.log("✅ Cuotas del convenio eliminadas");

      // Eliminar pagos asociados al convenio (pivot)
      await db
        .delete(convenios_pagos_resume)
        .where(eq(convenios_pagos_resume.convenio_id, convenio_id));
      console.log("✅ Relación pagos-convenio eliminada");

      // Eliminar el convenio
      await db
        .delete(convenios_pago)
        .where(eq(convenios_pago.convenio_id, convenio_id));
      console.log("✅ Convenio eliminado");

      // Obtener el capital del crédito para calcular mora
      const [credito] = await db
        .select({ capital: creditos.capital })
        .from(creditos)
        .where(eq(creditos.credito_id, creditoId));

      if (!credito) {
        return { success: false, message: "Crédito no encontrado" };
      }

      // Contar cuotas atrasadas (vencidas y no pagadas)
      const hoy = new Date().toISOString().slice(0, 10);

      const cuotasAtrasadas = await db
        .select({ cuota_id: cuotas_credito.cuota_id })
        .from(cuotas_credito)
        .where(
          and(
            eq(cuotas_credito.credito_id, creditoId),
            eq(cuotas_credito.pagado, false),
            lte(cuotas_credito.fecha_vencimiento, hoy)
          )
        );

      const numCuotasAtrasadas = cuotasAtrasadas.length;

      console.log(`📊 Cuotas atrasadas encontradas: ${numCuotasAtrasadas}`);

      if (numCuotasAtrasadas > 0) {
        // Calcular mora: capital * 1.12% * cuotas_atrasadas
        const capital = new Big(credito.capital);
        const porcentaje = new Big("0.0112");
        const montoMora = capital.times(porcentaje).times(numCuotasAtrasadas);

        console.log(`💰 Monto mora calculado: Q${montoMora.toFixed(2)}`);

        // El convenio se eliminó: sacar el crédito de EN_CONVENIO ANTES de recrear la mora.
        // createMora ya NO escribe mora sobre estados excluidos (no des-castiga); si dejáramos
        // EN_CONVENIO rechazaría la operación y el crédito quedaría huérfano (sin convenio,
        // sin mora, nunca MOROSO).
        await db
          .update(creditos)
          .set({ statusCredit: "MOROSO" })
          .where(eq(creditos.credito_id, creditoId));

        // Recrear la mora (monto = fórmula capital × 1.12% × cuotas). createMora reconfirma MOROSO.
        const resultMora = await createMora({
          credito_id: creditoId,
          monto_mora: Number(montoMora.toFixed(2)),
          cuotas_atrasadas: numCuotasAtrasadas,
        });
        if (!resultMora.success) {
          console.error("⚠️ createMora falló al eliminar convenio:", resultMora.message);
        }

        console.log("✅ Resultado createMora:", resultMora);
      } else {
        // Si no hay cuotas atrasadas, solo cambiar a ACTIVO
        await db
          .update(creditos)
          .set({ statusCredit: "ACTIVO" })
          .where(eq(creditos.credito_id, creditoId));

        console.log("✅ Crédito actualizado a ACTIVO (sin cuotas atrasadas)");
      }

      return { success: true, message: "Convenio eliminado exitosamente" };
    }

    // Si status = true, solo activar el convenio
    await db
      .update(convenios_pago)
      .set({ activo: status, updated_at: new Date() })
      .where(eq(convenios_pago.convenio_id, convenio_id));

    return { success: true, message: "Convenio activado exitosamente" };
  } catch (error) {
    console.error("Error updating convenio status:", error);
    return { success: false, message: "Error updating convenio status", error };
  }
}