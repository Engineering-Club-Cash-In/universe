import { z } from "zod";
import { insertPagosCreditoInversionistasV2 } from "./payments";

// ============================================================================
// SCHEMA DE VALIDACIÓN
// ============================================================================
export const processInvestorsSchema = z.object({
  credito_id: z.number().int().positive(),
  pago_id: z.number().int().positive(),
});

// ============================================================================
// FUNCIÓN PRINCIPAL: PROCESAR INVERSIONISTAS MANUALMENTE
// ============================================================================
export const processInvestors = async ({ body, set }: any) => {
  try {
    console.log("\n💼 ========== INICIO PROCESAMIENTO MANUAL DE INVERSIONISTAS ==========");

    // 1️⃣ VALIDAR ENTRADA
    const parseResult = processInvestorsSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }
    const { credito_id, pago_id } = parseResult.data;
    console.log(`📋 Crédito ID: ${credito_id}`);
    console.log(`🧾 Pago ID: ${pago_id}`);

    // 2️⃣ EJECUTAR INVERSIONISTAS
    console.log("\n💼 ========== PROCESANDO INVERSIONISTAS ==========");
    await insertPagosCreditoInversionistasV2(pago_id, credito_id);
    console.log("✅ Pagos a inversionistas procesados correctamente");

    set.status = 200;
    return {
      message: "Investors processed successfully",
      data: { pago_id, credito_id },
    };
  } catch (error: any) {
    console.error("\n❌ ========== ERROR EN PROCESO DE INVERSIONISTAS ==========");
    console.error(error);
    
    set.status = 500;
    return {
      message: "Internal server error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
