import { Elysia, t } from "elysia";
import { authMiddleware } from "./midleware";
import {
  getMetasFacturacion,
  upsertMetaFacturacion,
} from "../controllers/metasFacturacion";

export const metasFacturacionRouter = new Elysia({
  prefix: "/api/metas-facturacion",
})
  .use(authMiddleware)

  // POST - Crear o actualizar la meta de un (anio, mes). Upsert por (anio, mes).
  .post(
    "/",
    async ({ body, set }: any) => {
      try {
        const result = await upsertMetaFacturacion(body);
        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Error guardando meta", error: String(error) };
      }
    },
    {
      body: t.Object({
        anio: t.Number(),
        mes: t.Number(), // 1-12
        meta_mensual: t.Optional(t.Union([t.Number(), t.String(), t.Null()])),
        meta_semanal: t.Optional(t.Union([t.Number(), t.String(), t.Null()])),
        meta_diaria: t.Optional(t.Union([t.Number(), t.String(), t.Null()])),
        deuda_mensual: t.Optional(t.Union([t.Number(), t.String(), t.Null()])),
        deuda_semanal: t.Optional(t.Union([t.Number(), t.String(), t.Null()])),
        deuda_diaria: t.Optional(t.Union([t.Number(), t.String(), t.Null()])),
      }),
    }
  )

  // GET - Consultar metas. ?anio=2026&mes=6 (ambos opcionales).
  .get("/", async ({ query, set }: any) => {
    try {
      return await getMetasFacturacion({
        anio: query.anio ? Number(query.anio) : undefined,
        mes: query.mes ? Number(query.mes) : undefined,
      });
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Error obteniendo metas", error: String(error) };
    }
  });
