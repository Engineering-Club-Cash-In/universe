import { Elysia } from "elysia";
import { db } from "../database";
import { buildActivePortfolioRows, buildActivePortfolioWorkbook, getActivePortfolioCredits } from "../controllers/activePortfolioReport";
import { getCobradoDelMesSnapshot, getColocacionPorPeriodo, getComparativoHistorico, getCuotasPorFecha, getEsperadoDelMesMeta, getFlujoCuotasInversiones, getFlujoCuotasPorInversionista, getMoraByEtapaYAsesor, getMoraCobradaPorAsesor, getMontoACobrar, getMontoACobrarPeriodo, getReinversionLiquidaciones } from "../controllers/reportes";
import { getVehiclesBySifcoMap } from "../services/crm.service";
import { getCobranzaDiaria, getCobranzaDiariaDetalle } from "../controllers/cobranzaDiariaReporte";
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

function puedeDescargarCarteraActiva(user: { role?: string } | undefined): boolean {
  return user?.role === "ADMIN" || user?.role === "CONTA";
}

export const reportesRouter = new Elysia().use(authMiddleware)

  .get("/reportes/cartera-activa/excel", async ({ set, user }) => {
    if (!puedeDescargarCarteraActiva(user)) {
      set.status = 403;
      return { error: "No autorizado" };
    }

    try {
      const credits = await getActivePortfolioCredits(db);
      const vehicles = await getVehiclesBySifcoMap(credits.map((credit) => credit.numero_credito_sifco));
      const buf = await buildActivePortfolioWorkbook(buildActivePortfolioRows(credits, vehicles));
      return new Response(new Uint8Array(buf), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": 'attachment; filename="reporte-cartera-activa.xlsx"',
        },
      });
    } catch (error) {
      console.error("[/reportes/cartera-activa/excel]", error);
      set.status = 500;
      return { error: "Error generando reporte de cartera activa" };
    }
  })

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
      const data = await getCobradoDelMesSnapshot({ mes: m, anio: a });
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
      const data = await getEsperadoDelMesMeta({ mes: m, anio: a });
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
  })

  .get("/reportes/mora-por-etapa-asesor", async ({ query, set }) => {
    try {
      const { email_cobrador, fecha, asesores } = query as Record<string, string>;

      if (fecha) {
        if (!FECHA_REGEX.test(fecha)) {
          set.status = 400;
          return { error: "Formato de fecha inválido. Use YYYY-MM-DD" };
        }
        if (!fechaValida(fecha)) {
          set.status = 400;
          return { error: "Fecha inválida. Verifique que el día exista en el mes." };
        }
        const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
        if (fecha > hoy) {
          set.status = 400;
          return { error: "La fecha no puede ser futura" };
        }
      }

      let asesoresIds: number[] | undefined;
      if (asesores) {
        asesoresIds = asesores
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0);
        if (!asesoresIds.length) {
          set.status = 400;
          return { error: "Parámetro 'asesores' inválido" };
        }
      }

      const data = await getMoraByEtapaYAsesor({
        emailCobrador: email_cobrador,
        fecha: fecha || undefined,
        asesores: asesoresIds,
      });
      set.status = 200;
      return data;
    } catch (error) {
      console.error("[/reportes/mora-por-etapa-asesor]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  })

  .get("/reportes/mora-cobrada-por-asesor", async ({ query, set }) => {
    try {
      const { mes, anio, asesores, email_cobrador } = query as Record<string, string>;
      const mesNum = Number(mes);
      const anioNum = Number(anio);
      if (!Number.isInteger(mesNum) || mesNum < 1 || mesNum > 12) {
        set.status = 400;
        return { error: "Parámetro 'mes' inválido (1-12)" };
      }
      if (!Number.isInteger(anioNum) || anioNum < 2000 || anioNum > 2100) {
        set.status = 400;
        return { error: "Parámetro 'anio' inválido" };
      }

      let asesoresIds: number[] | undefined;
      if (asesores) {
        asesoresIds = asesores
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0);
        if (!asesoresIds.length) {
          set.status = 400;
          return { error: "Parámetro 'asesores' inválido" };
        }
      }

      const data = await getMoraCobradaPorAsesor({
        mes: mesNum,
        anio: anioNum,
        asesores: asesoresIds,
        emailCobrador: email_cobrador,
      });
      set.status = 200;
      return data;
    } catch (error) {
      console.error("[/reportes/mora-cobrada-por-asesor]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  })

  .get("/reportes/cuotas-por-fecha", async ({ query, set }) => {
    try {
      const { fecha_inicio, fecha_fin, asesor_id } = query as Record<string, string>;
      if (!fecha_inicio || !fecha_fin) {
        set.status = 400;
        return { error: "fecha_inicio y fecha_fin son requeridos" };
      }
      if (!FECHA_REGEX.test(fecha_inicio) || !FECHA_REGEX.test(fecha_fin)) {
        set.status = 400;
        return { error: "Formato de fecha inválido. Use YYYY-MM-DD" };
      }
      const data = await getCuotasPorFecha({
        fechaInicio: fecha_inicio,
        fechaFin: fecha_fin,
        asesorId: asesor_id ? Number(asesor_id) : undefined,
      });
      set.status = 200;
      return { ok: true, data };
    } catch (error) {
      console.error("[/reportes/cuotas-por-fecha]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  })

  .get("/reportes/cobranza-diaria", async ({ query, set }) => {
    try {
      const { anio, mes, dia, asesor_id } = query as Record<string, string>;
      if (!anio || !mes || !dia) {
        set.status = 400;
        return { error: "anio, mes y dia son requeridos" };
      }
      const a = Number(anio);
      const m = Number(mes);
      const d = Number(dia);
      const asesorId = asesor_id ? Number(asesor_id) : undefined;
      if (Number.isNaN(a) || Number.isNaN(m) || Number.isNaN(d) || (asesorId !== undefined && Number.isNaN(asesorId))) {
        set.status = 400;
        return { error: "anio, mes, dia y asesor_id deben ser numéricos válidos" };
      }
      const data = await getCobranzaDiaria({
        anio: a,
        mes: m,
        dia: d,
        asesorId,
      });
      set.status = 200;
      return { ok: true, data };
    } catch (error) {
      console.error("[/reportes/cobranza-diaria]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  })

  .get("/reportes/cobranza-diaria/detalle", async ({ query, set }) => {
    try {
      const { anio, mes, dia, asesor_id, limit, offset } = query as Record<string, string>;
      if (!anio || !mes || !dia || !asesor_id) {
        set.status = 400;
        return { error: "anio, mes, dia y asesor_id son requeridos" };
      }
      const a = Number(anio);
      const m = Number(mes);
      const d = Number(dia);
      const asesorId = Number(asesor_id);
      if (Number.isNaN(a) || Number.isNaN(m) || Number.isNaN(d) || Number.isNaN(asesorId)) {
        set.status = 400;
        return { error: "anio, mes, dia y asesor_id deben ser numéricos válidos" };
      }
      const data = await getCobranzaDiariaDetalle({
        anio: a,
        mes: m,
        dia: d,
        asesorId,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });
      set.status = 200;
      return { ok: true, data };
    } catch (error) {
      console.error("[/reportes/cobranza-diaria/detalle]", error);
      set.status = 500;
      return { error: "Error interno del servidor" };
    }
  });
