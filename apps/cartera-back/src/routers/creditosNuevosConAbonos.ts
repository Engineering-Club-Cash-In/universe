import { Elysia } from "elysia";
import {
  getCreditosNuevosConAbonos,
  diagnosticoCreditosAbonos,
} from "../controllers/creditosNuevosConAbonos";
import {
  emitCreditCapitalPaymentAuditDiagnosticCompleted,
  emitCreditCapitalPaymentAuditFailed,
} from "../utils/structuredLogger";

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.min(86_400_000, Math.round(Date.now() - startedAt)));
}

/**
 * Router: /creditos-nuevos-con-abonos
 *
 * GET /creditos-nuevos-con-abonos
 *   Identifica créditos nuevos que ya tienen abonos de capital registrados.
 *   Query params:
 *     - fecha_desde   (YYYY-MM-DD) — default: 1 de marzo del año actual
 *     - fecha_hasta   (YYYY-MM-DD) — default: hoy
 *     - solo_con_abonos ("true"/"false") — default: true
 *
 * GET /creditos-nuevos-con-abonos/diagnostico
 *   Ejecuta raw SQL para verificar el estado real de la BD y descartar
 *   bugs de query (total de créditos, rango de fechas, distribución por mes, etc.)
 */
export const creditosNuevosConAbonosRouter = new Elysia()
  // ── Diagnóstico ──────────────────────────────────────────────────────────
  .get("/creditos-nuevos-con-abonos/diagnostico", async ({ set }) => {
    const startedAt = Date.now();
    try {
      const result = await diagnosticoCreditosAbonos();
      emitCreditCapitalPaymentAuditDiagnosticCompleted({
        durationMs: elapsedMilliseconds(startedAt),
      });
      set.status = 200;
      return result;
    } catch (error) {
      emitCreditCapitalPaymentAuditFailed({
        operation: "diagnostic",
        durationMs: elapsedMilliseconds(startedAt),
      });
      set.status = 500;
      return {
        message: "Error ejecutando diagnóstico",
        error: String(error),
      };
    }
  })
  // ── Endpoint principal ────────────────────────────────────────────────────
  .get("/creditos-nuevos-con-abonos", async ({ query, set }) => {
    const startedAt = Date.now();
    const { fecha_desde, fecha_hasta, solo_con_abonos } =
      query as Record<string, string>;

    if (fecha_desde && isNaN(Date.parse(fecha_desde))) {
      set.status = 400;
      return {
        message: "Parámetro 'fecha_desde' debe ser una fecha válida (YYYY-MM-DD)",
      };
    }
    if (fecha_hasta && isNaN(Date.parse(fecha_hasta))) {
      set.status = 400;
      return {
        message: "Parámetro 'fecha_hasta' debe ser una fecha válida (YYYY-MM-DD)",
      };
    }

    const soloConAbonosBool = solo_con_abonos !== "false"; // default true

    try {
      const result = await getCreditosNuevosConAbonos(
        fecha_desde,
        fecha_hasta,
        soloConAbonosBool
      );
      set.status = 200;
      return result;
    } catch (error) {
      emitCreditCapitalPaymentAuditFailed({
        operation: "query",
        durationMs: elapsedMilliseconds(startedAt),
      });
      set.status = 500;
      return {
        message: "Error consultando créditos nuevos con abonos",
        error: String(error),
      };
    }
  });

