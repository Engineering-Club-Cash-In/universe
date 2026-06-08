import { Elysia } from "elysia";
import { getMontoACobrar } from "../controllers/reportes";
import { authMiddleware } from "./midleware";

const PERIODOS_VALIDOS = ["anio", "trimestre", "mes", "semana", "dia"] as const;
type PeriodoValido = typeof PERIODOS_VALIDOS[number];

function validarPeriodo(periodo: string | undefined, set: { status: number }): PeriodoValido | null {
  const p = periodo || "mes";
  if (!PERIODOS_VALIDOS.includes(p as PeriodoValido)) {
    set.status = 400;
    return null;
  }
  return p as PeriodoValido;
}

export const reportesRouter = new Elysia().use(authMiddleware)

  .get("/reportes/monto-cobrar", async ({ query, set }) => {
    try {
      const { periodo, fechaInicio, fechaFin } = query as Record<string, string>;
      if (!fechaInicio || !fechaFin) {
        set.status = 400;
        return { error: "fechaInicio y fechaFin son requeridos" };
      }
      const p = validarPeriodo(periodo, set);
      if (!p) return { error: "periodo inválido. Valores: anio, trimestre, mes, semana, dia" };
      const data = await getMontoACobrar({ periodo: p, fechaInicio, fechaFin });
      set.status = 200;
      return { data };
    } catch (error) {
      console.error("[/reportes/monto-cobrar]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  });
