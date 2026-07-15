import { desc, eq } from "drizzle-orm";
import { db } from "../database";
import { creditos, historial_capital_credito } from "../database/db";

/**
 * Historial de cambios del capital de un crédito (tabla historial_capital_credito,
 * poblada por el trigger trg_historial_capital_credito). Devuelve los cambios más
 * recientes primero, con fuente/motivo/usuario para la vista del front.
 */
export const getHistorialCapital = async ({
  numero_credito_sifco,
  set,
}: {
  numero_credito_sifco: string;
  set: { status: number };
}) => {
  try {
    if (!numero_credito_sifco) {
      set.status = 400;
      return { success: false, message: "Falta numero_credito_sifco" };
    }

    const [creditoDb] = await db
      .select({ credito_id: creditos.credito_id })
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
      .limit(1);

    if (!creditoDb) {
      set.status = 404;
      return { success: false, message: "Crédito no encontrado" };
    }

    const historial = await db
      .select({
        id: historial_capital_credito.id,
        operacion: historial_capital_credito.operacion,
        capital_anterior: historial_capital_credito.capital_anterior,
        capital_nuevo: historial_capital_credito.capital_nuevo,
        fuente: historial_capital_credito.fuente,
        motivo: historial_capital_credito.motivo,
        platform_user_id: historial_capital_credito.platform_user_id,
        user_email: historial_capital_credito.user_email,
        fecha: historial_capital_credito.fecha,
      })
      .from(historial_capital_credito)
      .where(eq(historial_capital_credito.credito_id, creditoDb.credito_id))
      .orderBy(desc(historial_capital_credito.fecha), desc(historial_capital_credito.id));

    return { success: true, historial };
  } catch (error) {
    console.error("Error en getHistorialCapital:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error interno del servidor",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
