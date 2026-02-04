import { eq, and, asc, desc } from "drizzle-orm";
import { db } from "../database";
import { creditos, cuotas_credito, pagos_credito } from "../database/db";
import z from "zod";

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
function calcularFechaPorNumeroCuota(
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

export const updateDueDates = async ({
  body,
  set,
}: {
  body: unknown;
  set: { status: number };
}): Promise<UpdateDueDatesResult | { message: string; errors?: unknown }> => {
  try {
    // 1. Validar body
    const parseResult = updateDueDatesBodySchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const { creditos: creditosInput } = parseResult.data;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`ACTUALIZANDO FECHAS DE VENCIMIENTO`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Total creditos a procesar: ${creditosInput.length}\n`);

    const resultados: UpdateDueDatesResult["detalle"] = [];
    let exitosos = 0;
    let fallidos = 0;

    // 2. Procesar cada credito
    for (const creditoInput of creditosInput) {
      const { numero_credito_sifco, dia_pago } = creditoInput;

      console.log(`\n--- Procesando: ${numero_credito_sifco} (dia ${dia_pago}) ---`);

      try {
        // 2.1 Buscar el credito
        const [creditoDb] = await db
          .select({ credito_id: creditos.credito_id })
          .from(creditos)
          .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
          .limit(1);

        if (!creditoDb) {
          console.log(`   Credito NO encontrado`);
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
          console.log(`   Sin cuotas`);
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

        console.log(`   Referencia: Cuota #${numeroCuotaReferencia} (${cuotasPagadas.length > 0 ? 'última pagada' : 'primera'}) = ${fechaReferencia.anio}-${fechaReferencia.mes.toString().padStart(2, "0")}`);

        if (cuotasNoPagadas.length === 0) {
          console.log(`   Sin cuotas pendientes`);
          resultados.push({
            numero_credito_sifco,
            status: "sin_cuotas",
            cuotas_actualizadas: 0,
          });
          exitosos++;
          continue;
        }

        console.log(`   Cuotas pendientes: ${cuotasNoPagadas.length}`);

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
          const fechaOriginalStr = typeof fechaOriginal === "string"
            ? fechaOriginal
            : `${fechaOriginal.getFullYear()}-${(fechaOriginal.getMonth() + 1).toString().padStart(2, "0")}-${fechaOriginal.getDate().toString().padStart(2, "0")}`;

          if (nuevaFecha !== fechaOriginalStr) {
            // Actualizar cuotas_credito
            await db
              .update(cuotas_credito)
              .set({ fecha_vencimiento: nuevaFecha })
              .where(eq(cuotas_credito.cuota_id, cuota.cuota_id));

            // También actualizar pagos_credito que tengan este cuota_id
            await db
              .update(pagos_credito)
              .set({ fecha_vencimiento: nuevaFecha })
              .where(eq(pagos_credito.cuota_id, cuota.cuota_id));

            console.log(
              `   Cuota #${cuota.numero_cuota}: ${fechaOriginalStr} -> ${nuevaFecha} (cuotas + pagos)`
            );
            cuotasActualizadas++;
          }
        }

        console.log(`   Cuotas actualizadas: ${cuotasActualizadas}`);

        resultados.push({
          numero_credito_sifco,
          status: "ok",
          cuotas_actualizadas: cuotasActualizadas,
        });
        exitosos++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`   ERROR: ${errorMsg}`);

        resultados.push({
          numero_credito_sifco,
          status: "error",
          error: errorMsg,
        });
        fallidos++;
      }
    }

    // 3. Resumen
    console.log(`\n${"=".repeat(60)}`);
    console.log(`RESUMEN`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Exitosos: ${exitosos}`);
    console.log(`Fallidos: ${fallidos}`);
    console.log(`Total: ${creditosInput.length}`);

    set.status = 200;
    return {
      success: fallidos === 0,
      total_procesados: creditosInput.length,
      exitosos,
      fallidos,
      detalle: resultados,
    };
  } catch (error) {
    console.error("Error en updateDueDates:", error);
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
  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`ARREGLANDO CRÉDITOS SIN FEBRERO ${anio}`);
    console.log(`${"=".repeat(60)}\n`);

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

    console.log(`Créditos sin febrero ${anio}: ${creditosSinFebrero.rows.length}`);

    if (creditosSinFebrero.rows.length === 0) {
      set.status = 200;
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
        const dia = typeof fecha === "string"
          ? parseInt(fecha.split("-")[2], 10)
          : fecha.getDate();

        // Si el día es 28 o 29, probablemente es un ajuste de febrero, usar 30
        const diaPago = dia >= 28 && dia <= 29 ? 30 : dia;

        creditosConDiaPago.push({
          numero_credito_sifco: credito.numero_credito_sifco,
          dia_pago: diaPago,
        });

        console.log(`  ${credito.numero_credito_sifco}: día ${diaPago}`);
      }
    }

    console.log(`\nProcesando ${creditosConDiaPago.length} créditos...`);

    // 3. Llamar a updateDueDates con todos los créditos
    const resultado = await updateDueDates({
      body: { creditos: creditosConDiaPago },
      set,
    });

    return resultado;
  } catch (error) {
    console.error("Error en fixCreditosWithoutFebruary:", error);
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
  const parseResult = singleUpdateSchema.safeParse(body);
  if (!parseResult.success) {
    set.status = 400;
    return {
      message: "Validation failed",
      errors: parseResult.error.flatten().fieldErrors,
    };
  }

  // Reutilizar el controller principal con un solo credito
  return updateDueDates({
    body: { creditos: [parseResult.data] },
    set,
  });
};
