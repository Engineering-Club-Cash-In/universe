import { db } from "../database";
import { creditos_inversionistas_espejo, creditos_inversionistas } from "../database/db";
import { eq, inArray, and } from "drizzle-orm";
import z from "zod";

// ========================================
// SCHEMA DE VALIDACIÓN
// ========================================

const completeEspejoSchema = z.object({
  creditos: z.union([
    z.number().int().positive(),
    z.array(z.number().int().positive()).min(1),
  ]),
  inversionista_id: z.number().int().positive().optional(),
});

// ========================================
// CONTROLLER
// ========================================

export const completeEspejo = async ({ body, set }: any) => {
  try {
    const parseResult = completeEspejoSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const { creditos: creditosInput, inversionista_id } = parseResult.data;

    // Normalizar a array
    const creditoIds = Array.isArray(creditosInput)
      ? creditosInput
      : [creditosInput];

    const resultados: any[] = [];

    await db.transaction(async (tx) => {
      for (const credito_id of creditoIds) {
        const whereConditions = inversionista_id
          ? and(
              eq(creditos_inversionistas_espejo.credito_id, credito_id),
              eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
            )
          : eq(creditos_inversionistas_espejo.credito_id, credito_id);

        const updated = await tx
          .update(creditos_inversionistas_espejo)
          .set({
            status: "completado",
            fecha_inicio_participacion: new Date().toISOString().split('T')[0],
            updated_at: new Date(),
          })
          .where(whereConditions)
          .returning({
            id: creditos_inversionistas_espejo.id,
            credito_id: creditos_inversionistas_espejo.credito_id,
            inversionista_id: creditos_inversionistas_espejo.inversionista_id,
            status: creditos_inversionistas_espejo.status,
          });

        const whereConditionsPadre = inversionista_id
          ? and(
              eq(creditos_inversionistas.credito_id, credito_id),
              eq(creditos_inversionistas.inversionista_id, inversionista_id),
            )
          : eq(creditos_inversionistas.credito_id, credito_id);

        await tx
          .update(creditos_inversionistas)
          .set({
            fecha_inicio_participacion: new Date().toISOString().split('T')[0],
          })
          .where(whereConditionsPadre);

        resultados.push({
          credito_id,
          registros_actualizados: updated.length,
          detalle: updated,
        });

        console.log(
          `✅ Crédito ${credito_id} - ${updated.length} registros espejo marcados como completado`,
        );
      }
    });

    set.status = 200;
    return {
      success: true,
      message: `${resultados.reduce((acc, r) => acc + r.registros_actualizados, 0)} registros marcados como completado`,
      resultados,
    };
  } catch (error) {
    console.error("[completeEspejo] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al completar registros espejo",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
