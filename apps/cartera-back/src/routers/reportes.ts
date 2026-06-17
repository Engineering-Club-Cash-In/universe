import { Elysia } from "elysia";
import { getCobradoDelMes, getColocacionPorPeriodo, getComparativoHistorico, getEsperadoDelMes, getFlujoCuotasInversiones, getFlujoCuotasPorInversionista, getMontoACobrar, getMontoACobrarPeriodo, getReinversionLiquidaciones } from "../controllers/reportes";
import { authMiddleware } from "./midleware";

const PERIODOS_VALIDOS = ["anio", "trimestre", "mes", "semana", "dia"] as const;
type PeriodoValido = typeof PERIODOS_VALIDOS[number];

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validarPeriodo(periodo: string | undefined, set: { status: number }): PeriodoValido | null {
  const p = periodo || "mes";
  if (!PERIODOS_VALIDOS.includes(p as PeriodoValido)) {
    set.status = 400;
    return null;
  }
  return p as PeriodoValido;
}

function fechaValida(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export const reportesRouter = new Elysia().use(authMiddleware)

  .get("/reportes/monto-cobrar", async ({ query, set }) => {
    try {
      const { periodo, fechaInicio, fechaFin } = query as Record<string, string>;
      if (!fechaInicio || !fechaFin) {
        set.status = 400;
        return { error: "fechaInicio y fechaFin son requeridos" };
      }
      if (!FECHA_REGEX.test(fechaInicio) || !FECHA_REGEX.test(fechaFin)) {
        set.status = 400;
        return { error: "Formato de fecha inválido. Use YYYY-MM-DD" };
      }
      if (!fechaValida(fechaInicio) || !fechaValida(fechaFin)) {
        set.status = 400;
        return { error: "Fecha inválida. Verifique que el día exista en el mes." };
      }
      if (fechaInicio > fechaFin) {
        set.status = 400;
        return { error: "fechaInicio debe ser menor o igual a fechaFin" };
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
  })

  .get("/reportes/monto-cobrar-periodo", async ({ query, set }) => {
    try {
      const { periodo, fechaInicio, fechaFin } = query as Record<string, string>;
      if (!fechaInicio || !fechaFin) {
        set.status = 400;
        return { error: "fechaInicio y fechaFin son requeridos" };
      }
      if (!FECHA_REGEX.test(fechaInicio) || !FECHA_REGEX.test(fechaFin)) {
        set.status = 400;
        return { error: "Formato de fecha inválido. Use YYYY-MM-DD" };
      }
      if (!fechaValida(fechaInicio) || !fechaValida(fechaFin)) {
        set.status = 400;
        return { error: "Fecha inválida. Verifique que el día exista en el mes." };
      }
      if (fechaInicio > fechaFin) {
        set.status = 400;
        return { error: "fechaInicio debe ser menor o igual a fechaFin" };
      }
      const p = validarPeriodo(periodo, set);
      if (!p) return { error: "periodo inválido. Valores: anio, trimestre, mes, semana, dia" };
      const data = await getMontoACobrarPeriodo({ periodo: p, fechaInicio, fechaFin });
      set.status = 200;
      return { data };
    } catch (error) {
      console.error("[/reportes/monto-cobrar-periodo]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  })

  .get("/reportes/facturacion-mes-cobrado", async ({ query, set }) => {
    try {
      const { mes, anio } = query as Record<string, string>;
      const m = Number(mes);
      const a = Number(anio);
      if (!m || !a || m < 1 || m > 12 || a < 2020) {
        set.status = 400;
        return { error: "mes y anio son requeridos y deben ser válidos" };
      }
      const data = await getCobradoDelMes({ mes: m, anio: a });
      set.status = 200;
      return data;
    } catch (error) {
      console.error("[/reportes/facturacion-mes-cobrado]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  })

  .get("/reportes/flujo-cuotas-inversiones", async ({ query, set }) => {
    try {
      const { fechaInicio, fechaFin } = query as Record<string, string>;
      if (!fechaInicio || !fechaFin) {
        set.status = 400;
        return { error: "fechaInicio y fechaFin son requeridos" };
      }
      if (!FECHA_REGEX.test(fechaInicio) || !FECHA_REGEX.test(fechaFin)) {
        set.status = 400;
        return { error: "Formato de fecha inválido. Use YYYY-MM-DD" };
      }
      if (!fechaValida(fechaInicio) || !fechaValida(fechaFin)) {
        set.status = 400;
        return { error: "Fecha inválida. Verifique que el día exista en el mes." };
      }
      if (fechaInicio > fechaFin) {
        set.status = 400;
        return { error: "fechaInicio debe ser menor o igual a fechaFin" };
      }
      const data = await getFlujoCuotasInversiones({ fechaInicio, fechaFin });
      set.status = 200;
      return data;
    } catch (error) {
      console.error("[/reportes/flujo-cuotas-inversiones]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  })

  .get("/reportes/reinversion-liquidaciones", async ({ query, set }) => {
    try {
      const { mes, anio } = query as Record<string, string>;
      const m = Number(mes);
      const a = Number(anio);
      if (!m || !a || m < 1 || m > 12 || a < 2020) {
        set.status = 400;
        return { error: "mes y anio son requeridos y deben ser válidos" };
      }
      const data = await getReinversionLiquidaciones({ mes: m, anio: a });
      set.status = 200;
      return data;
    } catch (error) {
      console.error("[/reportes/reinversion-liquidaciones]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  })

  .get("/reportes/flujo-cuotas-inversiones/por-inversionista", async ({ query, set }) => {
    try {
      const { fechaInicio, fechaFin } = query as Record<string, string>;
      if (!fechaInicio || !fechaFin) {
        set.status = 400;
        return { error: "fechaInicio y fechaFin son requeridos" };
      }
      if (!FECHA_REGEX.test(fechaInicio) || !FECHA_REGEX.test(fechaFin)) {
        set.status = 400;
        return { error: "Formato de fecha inválido. Use YYYY-MM-DD" };
      }
      if (!fechaValida(fechaInicio) || !fechaValida(fechaFin)) {
        set.status = 400;
        return { error: "Fecha inválida. Verifique que el día exista en el mes." };
      }
      if (fechaInicio > fechaFin) {
        set.status = 400;
        return { error: "fechaInicio debe ser menor o igual a fechaFin" };
      }
      const data = await getFlujoCuotasPorInversionista({ fechaInicio, fechaFin });
      set.status = 200;
      return data;
    } catch (error) {
      console.error("[/reportes/flujo-cuotas-inversiones/por-inversionista]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  })

  .get("/reportes/facturacion-mes-esperado", async ({ query, set }) => {
    try {
      const { mes, anio } = query as Record<string, string>;
      const m = Number(mes);
      const a = Number(anio);
      if (!m || !a || m < 1 || m > 12 || a < 2020) {
        set.status = 400;
        return { error: "mes y anio son requeridos y deben ser válidos" };
      }
      const data = await getEsperadoDelMes({ mes: m, anio: a });
      set.status = 200;
      return data;
    } catch (error) {
      console.error("[/reportes/facturacion-mes-esperado]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  })

  .get("/reportes/colocacion-periodo", async ({ query, set }) => {
    try {
      const { periodo, fechaInicio, fechaFin } = query as Record<string, string>;
      if (!fechaInicio || !fechaFin) {
        set.status = 400;
        return { error: "fechaInicio y fechaFin son requeridos" };
      }
      if (!FECHA_REGEX.test(fechaInicio) || !FECHA_REGEX.test(fechaFin)) {
        set.status = 400;
        return { error: "Formato de fecha inválido. Use YYYY-MM-DD" };
      }
      if (!fechaValida(fechaInicio) || !fechaValida(fechaFin)) {
        set.status = 400;
        return { error: "Fecha inválida. Verifique que el día exista en el mes." };
      }
      if (fechaInicio > fechaFin) {
        set.status = 400;
        return { error: "fechaInicio debe ser menor o igual a fechaFin" };
      }
      const p = validarPeriodo(periodo, set);
      if (!p) return { error: "periodo inválido. Valores: anio, trimestre, mes, semana, dia" };
      const data = await getColocacionPorPeriodo({ periodo: p, fechaInicio, fechaFin });
      set.status = 200;
      return { data };
    } catch (error) {
      console.error("[/reportes/colocacion-periodo]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  })

  .get("/reportes/comparativo-historico", async ({ query, set }) => {
    try {
      const anio = Number((query as Record<string, string>).anio);
      if (!anio || anio < 2020 || anio > 2100) {
        set.status = 400;
        return { error: "anio es requerido y debe ser válido" };
      }
      const data = await getComparativoHistorico({ anio });
      set.status = 200;
      return data;
    } catch (error) {
      console.error("[/reportes/comparativo-historico]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  });
