import { eq, and, asc, desc } from "drizzle-orm";
import { db } from "../database";
import { creditos, cuotas_credito, pagos_credito, historial_cambio_fecha } from "../database/db";
import z from "zod";
import { emitCreditDueDate, type CarteraStructuredLogger } from "../utils/structuredLogger";

const MAX_TELEMETRY_DURATION_MS = 86_400_000;

function safeNow(): number {
  try {
    const value = Date.now();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function elapsedMilliseconds(startedAt: number): number {
  try {
    return Math.min(MAX_TELEMETRY_DURATION_MS, Math.max(0, safeNow() - startedAt));
  } catch {
    return 0;
  }
}

// ============================================
// SCHEMAS
// ============================================

const creditoDiaPagoSchema = z.object({
  numero_credito_sifco: z.string().min(1),
  dia_pago: z.number().int().min(1).max(31),
});

const updateDueDatesBodySchema = z.object({
  creditos: z.array(creditoDiaPagoSchema).min(1),
});

type CreditoDiaPago = z.infer<typeof creditoDiaPagoSchema>;

// ============================================
// HELPERS
// ============================================

/**
 * Calcula la fecha de vencimiento basándose en una fecha de referencia,
 * el número de cuota de referencia, el número de cuota actual y el día de pago.
 *
 * Ejemplo: Si cuota 5 = Enero 2025, entonces:
 * - Cuota 6 = Febrero 2025
 * - Cuota 17 = Enero 2026 (12 meses después)
 * - Cuota 18 = Febrero 2026
 */
export function calcularFechaPorNumeroCuota(
  fechaReferencia: { anio: number; mes: number },
  numeroCuotaReferencia: number,
  numeroCuotaActual: number,
  diaPago: number
): string {
  // Calcular cuántos meses hay de diferencia
  const diferenciaMeses = numeroCuotaActual - numeroCuotaReferencia;

  // Calcular el nuevo mes y año
  // mes es 1-indexed (enero = 1)
  let totalMeses = fechaReferencia.mes - 1 + diferenciaMeses; // Convertir a 0-indexed para calcular
  let nuevoAnio = fechaReferencia.anio + Math.floor(totalMeses / 12);
  let nuevoMes = (totalMeses % 12) + 1; // Volver a 1-indexed

  // Manejar meses negativos (si la cuota actual es menor que la de referencia)
  if (nuevoMes <= 0) {
    nuevoMes += 12;
    nuevoAnio -= 1;
  }

  // Obtener el último día del mes calculado
  const ultimoDiaMes = new Date(nuevoAnio, nuevoMes, 0).getDate();

  // Usar el menor entre diaPago y ultimoDiaMes
  const diaFinal = Math.min(diaPago, ultimoDiaMes);

  // Formatear como YYYY-MM-DD
  const mesStr = nuevoMes.toString().padStart(2, "0");
  const diaStr = diaFinal.toString().padStart(2, "0");

  return `${nuevoAnio}-${mesStr}-${diaStr}`;
}

/**
 * Extrae año y mes de una fecha (string o Date)
 */
function extraerAnioMes(fecha: string | Date): { anio: number; mes: number } {
  if (typeof fecha === "string") {
    const partes = fecha.split("-");
    return {
      anio: parseInt(partes[0], 10),
      mes: parseInt(partes[1], 10),
    };
  } else {
    return {
      anio: fecha.getFullYear(),
      mes: fecha.getMonth() + 1,
    };
  }
}

// ============================================
// CONTROLLER PRINCIPAL
// ============================================

interface UpdateDueDatesResult {
  success: boolean;
  total_procesados: number;
  exitosos: number;
  fallidos: number;
  detalle: {
    numero_credito_sifco: string;
    status: "ok" | "error" | "no_encontrado" | "sin_cuotas";
    cuotas_actualizadas?: number;
    error?: string;
  }[];
}

type DelegatedDueDateOperation = "batch_update" | "repair_missing_february" | "single_update";

export function classifyDueDateBatchTerminal({
  operation,
  processedCount,
  succeededCount,
  failedCount,
  skippedCount,
}: {
  operation: DelegatedDueDateOperation;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
}) {
  const counts = { operation, processedCount, succeededCount, failedCount, skippedCount };
  if (processedCount > 0 && skippedCount === processedCount && succeededCount === 0 && failedCount === 0) {
    return { outcome: "skipped" as const, ...counts, reasonCode: "missing_payment_reference" as const };
  }
  return failedCount > 0
    ? { outcome: "partially_completed" as const, ...counts, reasonCode: "item_failures" as const }
    : { outcome: "completed" as const, ...counts };
}

export function classifyDueDatePersistenceFailure(
  operation: "change_start_date" | "json_bulk_update",
  hasPersistedChanges: boolean,
) {
  return {
    outcome: hasPersistedChanges ? "partially_persisted" as const : "failed" as const,
    operation,
    errorCode: "unknown" as const,
  };
}

export const updateDueDates = async ({
  body,
  set,
  telemetryOperation = "batch_update",
  telemetryProcessedCount,
  telemetrySkippedCount = 0,
  telemetryStartedAt,
  telemetryLogger,
}: {
  body: unknown;
  set: { status: number };
  telemetryOperation?: "batch_update" | "repair_missing_february" | "single_update";
  telemetryProcessedCount?: number;
  telemetrySkippedCount?: number;
  telemetryStartedAt?: number;
  telemetryLogger?: CarteraStructuredLogger;
}): Promise<UpdateDueDatesResult | { message: string; errors?: unknown }> => {
  const startedAt = telemetryStartedAt ?? safeNow();
  try {
    // 1. Validar body
    const parseResult = updateDueDatesBodySchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      if (
        telemetryOperation === "repair_missing_february"
        && telemetryProcessedCount !== undefined
        && telemetryProcessedCount > 0
        && telemetrySkippedCount === telemetryProcessedCount
      ) {
        emitCreditDueDate({
          outcome: "skipped",
          operation: telemetryOperation,
          durationMs: elapsedMilliseconds(startedAt),
          processedCount: telemetryProcessedCount,
          succeededCount: 0,
          failedCount: 0,
          skippedCount: telemetrySkippedCount,
          reasonCode: "missing_payment_reference",
        }, telemetryLogger);
      } else {
        emitCreditDueDate({ outcome: "rejected", operation: telemetryOperation, durationMs: elapsedMilliseconds(startedAt), reasonCode: "schema_invalid" }, telemetryLogger);
      }
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const { creditos: creditosInput } = parseResult.data;


    const resultados: UpdateDueDatesResult["detalle"] = [];
    let exitosos = 0;
    let fallidos = 0;
    let hasPartiallyPersistedItem = false;

    // 2. Procesar cada credito
    for (const creditoInput of creditosInput) {
      const { numero_credito_sifco, dia_pago } = creditoInput;
      let itemPersisted = false;


      try {
        // 2.1 Buscar el credito
        const [creditoDb] = await db
          .select({ credito_id: creditos.credito_id })
          .from(creditos)
          .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
          .limit(1);

        if (!creditoDb) {
          resultados.push({
            numero_credito_sifco,
            status: "no_encontrado",
          });
          fallidos++;
          continue;
        }

        // 2.2 Buscar TODAS las cuotas para obtener una referencia
        const todasLasCuotas = await db
          .select({
            cuota_id: cuotas_credito.cuota_id,
            fecha_vencimiento: cuotas_credito.fecha_vencimiento,
            numero_cuota: cuotas_credito.numero_cuota,
            pagado: cuotas_credito.pagado,
          })
          .from(cuotas_credito)
          .where(eq(cuotas_credito.credito_id, creditoDb.credito_id))
          .orderBy(asc(cuotas_credito.numero_cuota));

        if (todasLasCuotas.length === 0) {
          resultados.push({
            numero_credito_sifco,
            status: "sin_cuotas",
            cuotas_actualizadas: 0,
          });
          exitosos++;
          continue;
        }

        // 2.3 Obtener cuota de referencia (la ÚLTIMA cuota PAGADA)
        const cuotasPagadas = todasLasCuotas.filter((c) => c.pagado);
        const cuotasNoPagadas = todasLasCuotas.filter((c) => !c.pagado);

        // Si no hay cuotas pagadas, usar la primera cuota como referencia
        const cuotaReferencia = cuotasPagadas.length > 0
          ? cuotasPagadas[cuotasPagadas.length - 1] // Última pagada (ya está ordenado ASC)
          : todasLasCuotas[0];

        const fechaReferencia = extraerAnioMes(cuotaReferencia.fecha_vencimiento);
        const numeroCuotaReferencia = cuotaReferencia.numero_cuota;


        if (cuotasNoPagadas.length === 0) {
          resultados.push({
            numero_credito_sifco,
            status: "sin_cuotas",
            cuotas_actualizadas: 0,
          });
          exitosos++;
          continue;
        }


        // 2.5 Actualizar cada cuota basándose en el número de cuota
        let cuotasActualizadas = 0;

        for (const cuota of cuotasNoPagadas) {
          const fechaOriginal = cuota.fecha_vencimiento;

          // Calcular la nueva fecha basándose en el número de cuota
          const nuevaFecha = calcularFechaPorNumeroCuota(
            fechaReferencia,
            numeroCuotaReferencia,
            cuota.numero_cuota,
            dia_pago
          );

          // Solo actualizar si la fecha cambió
          const fechaOriginalStr = fechaOriginal;

          if (nuevaFecha !== fechaOriginalStr) {
            // Actualizar cuotas_credito
            await db
              .update(cuotas_credito)
              .set({ fecha_vencimiento: nuevaFecha })
              .where(eq(cuotas_credito.cuota_id, cuota.cuota_id));
            itemPersisted = true;

            // También actualizar pagos_credito que tengan este cuota_id
            await db
              .update(pagos_credito)
              .set({ fecha_vencimiento: nuevaFecha })
              .where(eq(pagos_credito.cuota_id, cuota.cuota_id));
            itemPersisted = false;

            cuotasActualizadas++;
          }
        }


        resultados.push({
          numero_credito_sifco,
          status: "ok",
          cuotas_actualizadas: cuotasActualizadas,
        });
        exitosos++;
      } catch (error) {
        if (itemPersisted) hasPartiallyPersistedItem = true;
        const errorMsg = error instanceof Error ? error.message : String(error);

        resultados.push({
          numero_credito_sifco,
          status: "error",
          error: errorMsg,
        });
        fallidos++;
      }
    }

    // 3. Resumen

    set.status = 200;
    const processedCount = telemetryProcessedCount ?? creditosInput.length;
    if (hasPartiallyPersistedItem) {
      emitCreditDueDate({
        outcome: "partially_persisted",
        operation: telemetryOperation,
        durationMs: elapsedMilliseconds(startedAt),
        errorCode: "unknown",
      }, telemetryLogger);
    } else {
      const terminal = classifyDueDateBatchTerminal({
        operation: telemetryOperation,
        processedCount,
        succeededCount: exitosos,
        failedCount: fallidos,
        skippedCount: telemetrySkippedCount,
      });
      if (terminal.outcome === "skipped") {
        emitCreditDueDate({
          outcome: terminal.outcome,
          operation: terminal.operation,
          durationMs: elapsedMilliseconds(startedAt),
          processedCount: terminal.processedCount,
          succeededCount: terminal.succeededCount,
          failedCount: terminal.failedCount,
          skippedCount: terminal.skippedCount,
          reasonCode: terminal.reasonCode,
        }, telemetryLogger);
      } else if (terminal.outcome === "partially_completed") {
        emitCreditDueDate({
          outcome: terminal.outcome,
          operation: terminal.operation,
          durationMs: elapsedMilliseconds(startedAt),
          processedCount: terminal.processedCount,
          succeededCount: terminal.succeededCount,
          failedCount: terminal.failedCount,
          skippedCount: terminal.skippedCount,
          reasonCode: terminal.reasonCode,
        }, telemetryLogger);
      } else {
        emitCreditDueDate({
          outcome: terminal.outcome,
          operation: terminal.operation,
          durationMs: elapsedMilliseconds(startedAt),
          processedCount: terminal.processedCount,
          succeededCount: terminal.succeededCount,
          failedCount: terminal.failedCount,
          skippedCount: terminal.skippedCount,
        }, telemetryLogger);
      }
    }
    return {
      success: fallidos === 0,
      total_procesados: creditosInput.length,
      exitosos,
      fallidos,
      detalle: resultados,
    };
  } catch (error) {
    emitCreditDueDate({ outcome: "failed", operation: telemetryOperation, durationMs: elapsedMilliseconds(startedAt), errorCode: "unknown" }, telemetryLogger);
    set.status = 500;
    return {
      message: "Error interno del servidor",
      errors: error instanceof Error ? error.message : String(error),
    };
  }
};

// ============================================
// ARREGLAR CREDITOS SIN FEBRERO
// ============================================

/**
 * Obtiene los créditos activos que no tienen cuota en febrero de un año específico
 * y recalcula sus fechas de vencimiento basándose en la última cuota pagada.
 */
export const fixCreditosWithoutFebruary = async ({
  anio = 2026,
  set,
}: {
  anio?: number;
  set: { status: number };
}) => {
  const startedAt = safeNow();
  try {

    // 1. Obtener créditos sin cuota en febrero del año especificado
    const creditosSinFebrero = await db.execute<{
      credito_id: number;
      numero_credito_sifco: string;
    }>(
      `SELECT c.credito_id, c.numero_credito_sifco
       FROM cartera.creditos c
       WHERE c."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
         AND c.credito_id NOT IN (
           SELECT DISTINCT cc.credito_id
           FROM cartera.cuotas_credito cc
           WHERE EXTRACT(MONTH FROM cc.fecha_vencimiento::date) = 2
             AND EXTRACT(YEAR FROM cc.fecha_vencimiento::date) = ${anio}
         )
         AND EXISTS (
           SELECT 1 FROM cartera.cuotas_credito cc2
           WHERE cc2.credito_id = c.credito_id
             AND cc2.pagado = false
             AND EXTRACT(YEAR FROM cc2.fecha_vencimiento::date) >= ${anio}
         )`
    );


    if (creditosSinFebrero.rows.length === 0) {
      set.status = 200;
      emitCreditDueDate({ outcome: "completed", operation: "repair_missing_february", durationMs: elapsedMilliseconds(startedAt), processedCount: 0, succeededCount: 0, failedCount: 0, skippedCount: 0 });
      return {
        success: true,
        message: `No hay créditos sin cuota en febrero ${anio}`,
        total: 0,
      };
    }

    // 2. Para cada crédito, obtener el día de pago de la última cuota pagada
    const creditosConDiaPago: { numero_credito_sifco: string; dia_pago: number }[] = [];

    for (const credito of creditosSinFebrero.rows) {
      // Obtener la última cuota pagada para inferir el día de pago
      const [ultimaCuotaPagada] = await db
        .select({
          fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        })
        .from(cuotas_credito)
        .where(
          and(
            eq(cuotas_credito.credito_id, credito.credito_id),
            eq(cuotas_credito.pagado, true)
          )
        )
        .orderBy(desc(cuotas_credito.numero_cuota)) // DESC para obtener la ÚLTIMA pagada
        .limit(1);

      if (ultimaCuotaPagada) {
        const fecha = ultimaCuotaPagada.fecha_vencimiento;
        const dia = parseInt(fecha.split("-")[2], 10);

        // Si el día es 28 o 29, probablemente es un ajuste de febrero, usar 30
        const diaPago = dia >= 28 && dia <= 29 ? 30 : dia;

        creditosConDiaPago.push({
          numero_credito_sifco: credito.numero_credito_sifco,
          dia_pago: diaPago,
        });

      }
    }


    // 3. Llamar a updateDueDates con todos los créditos
    const resultado = await updateDueDates({
      body: { creditos: creditosConDiaPago },
      set,
      telemetryOperation: "repair_missing_february",
      telemetryProcessedCount: creditosSinFebrero.rows.length,
      telemetrySkippedCount: creditosSinFebrero.rows.length - creditosConDiaPago.length,
      telemetryStartedAt: startedAt,
    });

    return resultado;
  } catch (error) {
    emitCreditDueDate({ outcome: "failed", operation: "repair_missing_february", durationMs: elapsedMilliseconds(startedAt), errorCode: "unknown" });
    set.status = 500;
    return {
      message: "Error interno del servidor",
      errors: error instanceof Error ? error.message : String(error),
    };
  }
};

// ============================================
// ENDPOINT PARA UN SOLO CREDITO
// ============================================

// ============================================
// CAMBIAR FECHA DE INICIO DE UN CRÉDITO
// ============================================

const cambiarFechaInicioSchema = z.object({
  numero_credito_sifco: z.string().min(1),
  nueva_fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato debe ser YYYY-MM-DD"),
  changed_by: z.string().min(1),
  razon: z.string().min(1),
});

/**
 * Cambia la fecha de inicio (cuota 0) de un crédito y recalcula
 * fecha_vencimiento de TODAS las cuotas (pagadas y no pagadas).
 * No toca montos, abonos, ni fecha_pago.
 */
export const cambiarFechaInicio = async ({
  body,
  set,
}: {
  body: unknown;
  set: { status: number };
}) => {
  const startedAt = safeNow();
  let hasPersistedChanges = false;
  try {
    const parseResult = cambiarFechaInicioSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      emitCreditDueDate({ outcome: "rejected", operation: "change_start_date", durationMs: elapsedMilliseconds(startedAt), reasonCode: "schema_invalid" });
      return {
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const { numero_credito_sifco, nueva_fecha_inicio, changed_by, razon } = parseResult.data;

    // Cuota mínima a partir de la cual, si está pagada, se bloquea el cambio de fecha.
    // Ej: 2 = permite cambio si solo cuotas 0 y/o 1 están pagadas.
    //     1 = solo permite si únicamente cuota 0 está pagada.
    const CUOTA_MINIMA_BLOQUEO = 2;


    // 1. Buscar el crédito
    const [creditoDb] = await db
      .select({ credito_id: creditos.credito_id })
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
      .limit(1);

    if (!creditoDb) {
      set.status = 404;
      emitCreditDueDate({ outcome: "rejected", operation: "change_start_date", durationMs: elapsedMilliseconds(startedAt), reasonCode: "credit_not_found" });
      return { success: false, message: "Crédito no encontrado" };
    }

    // 2. Obtener todas las cuotas
    const todasLasCuotas = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        numero_cuota: cuotas_credito.numero_cuota,
        pagado: cuotas_credito.pagado,
      })
      .from(cuotas_credito)
      .where(eq(cuotas_credito.credito_id, creditoDb.credito_id))
      .orderBy(asc(cuotas_credito.numero_cuota));

    if (todasLasCuotas.length === 0) {
      set.status = 400;
      emitCreditDueDate({ outcome: "rejected", operation: "change_start_date", durationMs: elapsedMilliseconds(startedAt), reasonCode: "installments_not_found" });
      return { success: false, message: "El crédito no tiene cuotas" };
    }

    // 2.5 Validar que no haya cuotas >= CUOTA_MINIMA_BLOQUEO pagadas
    const cuotaPagadaMayor = todasLasCuotas.find(
      (c) => c.numero_cuota >= CUOTA_MINIMA_BLOQUEO && c.pagado
    );
    if (cuotaPagadaMayor) {
      set.status = 400;
      emitCreditDueDate({ outcome: "rejected", operation: "change_start_date", durationMs: elapsedMilliseconds(startedAt), reasonCode: "paid_installment_conflict" });
      return {
        success: false,
        message: `No se puede cambiar la fecha de inicio porque la cuota ${cuotaPagadaMayor.numero_cuota} ya está pagada. Solo se permite el cambio si únicamente las cuotas menores a ${CUOTA_MINIMA_BLOQUEO} están pagadas.`,
      };
    }

    // 3. Guardar historial del cambio (fecha anterior de cuota 1)
    const cuotaUno = todasLasCuotas.find((c) => c.numero_cuota === 1);
    if (!cuotaUno) {
      set.status = 400;
      emitCreditDueDate({ outcome: "rejected", operation: "change_start_date", durationMs: elapsedMilliseconds(startedAt), reasonCode: "installments_not_found" });
      return { success: false, message: "El crédito no tiene cuota 1" };
    }

    const fechaAnterior = cuotaUno.fecha_vencimiento;

    await db.insert(historial_cambio_fecha).values({
      credito_id: creditoDb.credito_id,
      fecha_inicio_anterior: fechaAnterior,
      fecha_inicio_nueva: nueva_fecha_inicio,
      razon,
      changed_by,
    });
    hasPersistedChanges = true;

    // 4. Extraer día de pago de la nueva fecha inicio
    const partesFecha = nueva_fecha_inicio.split("-");
    const anioInicio = parseInt(partesFecha[0], 10);
    const mesInicio = parseInt(partesFecha[1], 10);
    const diaInicio = parseInt(partesFecha[2], 10);

    // 5. Recalcular fechas solo para cuotas >= 1 (cuota 0 es desembolso, no se mueve)
    const cuotasAMover = todasLasCuotas.filter((c) => c.numero_cuota >= 1);
    let cuotasActualizadas = 0;

    for (const cuota of cuotasAMover) {
      // Cuota 1 = nueva_fecha_inicio, cuota N = (N-1) meses después
      const nuevaFecha = calcularFechaPorNumeroCuota(
        { anio: anioInicio, mes: mesInicio },
        1, // referencia es cuota 1
        cuota.numero_cuota,
        diaInicio
      );

      const fechaOriginalStr = cuota.fecha_vencimiento;

      if (nuevaFecha !== fechaOriginalStr) {
        // Actualizar cuotas_credito
        await db
          .update(cuotas_credito)
          .set({ fecha_vencimiento: nuevaFecha })
          .where(eq(cuotas_credito.cuota_id, cuota.cuota_id));

        // Actualizar fecha_vencimiento en pagos_credito
        await db
          .update(pagos_credito)
          .set({ fecha_vencimiento: nuevaFecha })
          .where(eq(pagos_credito.cuota_id, cuota.cuota_id));

        cuotasActualizadas++;
      }
    }


    set.status = 200;
    emitCreditDueDate({ outcome: "completed", operation: "change_start_date", durationMs: elapsedMilliseconds(startedAt) });
    return {
      success: true,
      message: `Fecha de inicio cambiada a ${nueva_fecha_inicio}`,
      cuotas_actualizadas: cuotasActualizadas,
      total_cuotas: todasLasCuotas.length,
    };
  } catch (error) {
    const terminal = classifyDueDatePersistenceFailure("change_start_date", hasPersistedChanges);
    emitCreditDueDate({ outcome: terminal.outcome, operation: terminal.operation, durationMs: elapsedMilliseconds(startedAt), errorCode: terminal.errorCode });
    set.status = 500;
    return {
      success: false,
      message: "Error interno del servidor",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// ============================================
// OBTENER HISTORIAL DE CAMBIOS DE FECHA
// ============================================

export const getHistorialCambioFecha = async ({
  numero_credito_sifco,
  set,
}: {
  numero_credito_sifco: string;
  set: { status: number };
}) => {
  const startedAt = safeNow();
  try {
    const [creditoDb] = await db
      .select({ credito_id: creditos.credito_id })
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
      .limit(1);

    if (!creditoDb) {
      set.status = 404;
      emitCreditDueDate({ outcome: "rejected", operation: "list_change_history", durationMs: elapsedMilliseconds(startedAt), reasonCode: "credit_not_found" });
      return { success: false, message: "Crédito no encontrado" };
    }

    const historial = await db
      .select()
      .from(historial_cambio_fecha)
      .where(eq(historial_cambio_fecha.credito_id, creditoDb.credito_id))
      .orderBy(desc(historial_cambio_fecha.created_at));

    emitCreditDueDate({ outcome: "completed", operation: "list_change_history", durationMs: elapsedMilliseconds(startedAt) });
    return {
      success: true,
      historial,
    };
  } catch (error) {
    emitCreditDueDate({ outcome: "failed", operation: "list_change_history", durationMs: elapsedMilliseconds(startedAt), errorCode: "unknown" });
    set.status = 500;
    return {
      success: false,
      message: "Error interno del servidor",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// ============================================
// ENDPOINT PARA UN SOLO CREDITO
// ============================================

const singleUpdateSchema = z.object({
  numero_credito_sifco: z.string().min(1),
  dia_pago: z.number().int().min(1).max(31),
});

export const updateSingleDueDate = async ({
  body,
  set,
}: {
  body: unknown;
  set: { status: number };
}) => {
  const startedAt = safeNow();
  const parseResult = singleUpdateSchema.safeParse(body);
  if (!parseResult.success) {
    set.status = 400;
    emitCreditDueDate({ outcome: "rejected", operation: "single_update", durationMs: elapsedMilliseconds(startedAt), reasonCode: "schema_invalid" });
    return {
      message: "Validation failed",
      errors: parseResult.error.flatten().fieldErrors,
    };
  }

  // Reutilizar el controller principal con un solo credito
  return updateDueDates({
    body: { creditos: [parseResult.data] },
    set,
    telemetryOperation: "single_update",
    telemetryStartedAt: startedAt,
  });
};

// ============================================
// ACTUALIZAR FECHAS DESDE JSON (TODAS LAS CUOTAS)
// ============================================

/**
 * Lee resultado_ultimos_pagos.json, extrae el día del campo "pago" de cada crédito,
 * y actualiza fecha_vencimiento de TODAS las cuotas (pagadas y no pagadas).
 * También actualiza fecha_pago y fecha_boleta SOLO si ya tienen valor.
 */
export const updateDueDatesFromJson = async ({
  set,
}: {
  set: { status: number };
}) => {
  const startedAt = safeNow();
  let hasPersistedChanges = false;
  const { promises: fs } = await import("fs");
  const rutaArchivoPagos =
    "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\resultado_ultimos_pagos.json";

  try {

    // 1. Leer JSON
    const contenido = await fs.readFile(rutaArchivoPagos, "utf-8");
    const jsonPagos = JSON.parse(contenido);

    // 2. Agrupar créditos por diaPago
    const gruposPorDia: Map<number, string[]> = new Map();
    let sinPago = 0;

    for (const registro of jsonPagos) {
      const creditoInfo = registro.creditos?.[0];
      if (!creditoInfo?.pago) {
        sinPago++;
        continue;
      }
      const diaPago = new Date(creditoInfo.pago).getDate();
      if (!gruposPorDia.has(diaPago)) gruposPorDia.set(diaPago, []);
      gruposPorDia.get(diaPago)!.push(registro.numeroCredito);
    }

    // Helper SQL: último día del mes = EXTRACT(DAY FROM (DATE_TRUNC('month', fecha) + INTERVAL '1 month' - INTERVAL '1 day'))
    const ultimoDia = (col: string) =>
      `EXTRACT(DAY FROM (DATE_TRUNC('month', ${col}) + INTERVAL '1 month' - INTERVAL '1 day'))::int`;

    // 3. Por cada grupo de día, ejecutar 2 queries masivos
    const resultados: { dia: number; creditos: number; cuotas: number; pagos: number }[] = [];

    for (const [diaPago, creditNumbers] of gruposPorDia) {
      const inClause = creditNumbers.map((n) => `'${n}'`).join(", ");

      // 3a. UPDATE cuotas_credito: solo cambiar el día de fecha_vencimiento
      const cuotasResult = await db.execute(
        `UPDATE cartera.cuotas_credito cc
         SET fecha_vencimiento = MAKE_DATE(
             EXTRACT(YEAR FROM cc.fecha_vencimiento)::int,
             EXTRACT(MONTH FROM cc.fecha_vencimiento)::int,
             LEAST(${diaPago}, ${ultimoDia("cc.fecha_vencimiento")})
           )
         WHERE cc.credito_id IN (
           SELECT credito_id FROM cartera.creditos
           WHERE numero_credito_sifco IN (${inClause})
         )
         AND cc.numero_cuota > 0`
      );
      const cuotasCount = (cuotasResult as unknown as { rowCount?: number }).rowCount ?? 0;
      if (cuotasCount > 0) hasPersistedChanges = true;

      // 3b. UPDATE pagos_credito: fecha_vencimiento siempre,
      //     fecha_pago + fecha_boleta SOLO donde fecha_pago ya tiene valor
      const pagosResult = await db.execute(
        `UPDATE cartera.pagos_credito pc
         SET
           fecha_vencimiento = MAKE_DATE(
               EXTRACT(YEAR FROM pc.fecha_vencimiento)::int,
               EXTRACT(MONTH FROM pc.fecha_vencimiento)::int,
               LEAST(${diaPago}, ${ultimoDia("pc.fecha_vencimiento")})
             ),
           fecha_pago = CASE WHEN pc.fecha_pago IS NOT NULL THEN
             MAKE_DATE(
               EXTRACT(YEAR FROM pc.fecha_pago)::int,
               EXTRACT(MONTH FROM pc.fecha_pago)::int,
               LEAST(${diaPago}, ${ultimoDia("pc.fecha_pago")})
             )
             ELSE pc.fecha_pago END,
           fecha_boleta = CASE WHEN pc.fecha_pago IS NOT NULL THEN
             MAKE_DATE(
                 EXTRACT(YEAR FROM pc.fecha_vencimiento)::int,
                 EXTRACT(MONTH FROM pc.fecha_vencimiento)::int,
                 LEAST(${diaPago}, ${ultimoDia("pc.fecha_vencimiento")})
               )
             ELSE pc.fecha_boleta END
         WHERE pc.cuota_id IN (
           SELECT cc.cuota_id FROM cartera.cuotas_credito cc
           INNER JOIN cartera.creditos c ON cc.credito_id = c.credito_id
           WHERE c.numero_credito_sifco IN (${inClause})
             AND cc.numero_cuota > 0
         )`
      );

      const pagosCount = (pagosResult as unknown as { rowCount?: number }).rowCount ?? 0;
      if (pagosCount > 0) hasPersistedChanges = true;

      resultados.push({ dia: diaPago, creditos: creditNumbers.length, cuotas: cuotasCount, pagos: pagosCount });
    }


    set.status = 200;
    emitCreditDueDate({
      outcome: "completed",
      operation: "json_bulk_update",
      durationMs: elapsedMilliseconds(startedAt),
      processedCount: jsonPagos.length,
      succeededCount: jsonPagos.length - sinPago,
      failedCount: 0,
      skippedCount: sinPago,
    });
    return {
      success: true,
      total_json: jsonPagos.length,
      sin_pago: sinPago,
      procesados: jsonPagos.length - sinPago,
      queries_ejecutados: gruposPorDia.size * 2,
      resultados,
    };
  } catch (error: any) {
    const terminal = classifyDueDatePersistenceFailure("json_bulk_update", hasPersistedChanges);
    emitCreditDueDate({ outcome: terminal.outcome, operation: terminal.operation, durationMs: elapsedMilliseconds(startedAt), errorCode: terminal.errorCode });
    set.status = 500;
    return {
      message: "Error interno del servidor",
      error: error.message,
    };
  }
};
