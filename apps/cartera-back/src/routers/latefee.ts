// routes/moras.ts
import { Elysia, t } from "elysia";
 
 
import { authMiddleware } from "./midleware";
import { createMora, updateMora, procesarMoras, condonarMora, getCreditosWithMoras, getCondonacionesMora } from "../controllers/latefee";

export const morasRouter = new Elysia()
  .use(authMiddleware)

  /**
   * Crear una mora manualmente
   */
  .post("/mora", async ({ body, set }) => {
    try {
      const result = await createMora(body);
      set.status = result.success ? 201 : 400;
      return result;
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo crear la mora", error: String(err) };
    }
  }, {
    body: t.Object({
      credito_id: t.Number(),
      monto_mora: t.Optional(t.Number()),
      cuotas_atrasadas: t.Optional(t.Number()),
    })
  })

  /**
   * Actualizar una mora (incremento o decremento)
   */
  .post("/mora/update", async ({ body, set }) => {
    try {
      const result = await updateMora(body);
      set.status = result.success ? 200 : 400;
      return result;
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo actualizar la mora", error: String(err) };
    }
  }, {
    body: t.Object({
      credito_id: t.Optional(t.Number()),
      numero_credito_sifco: t.Optional(t.String()),
      monto_cambio: t.Number(),
      tipo: t.Union([t.Literal("INCREMENTO"), t.Literal("DECREMENTO")]),
      cuotas_atrasadas: t.Optional(t.Number()),
      activa: t.Optional(t.Boolean()),
    })
  })

  /**
   * Procesar todas las moras de forma automática
   */
  .post("/moras/procesar", async ({ set }) => {
    try {
      const result = await procesarMoras();
      return { success: true, message: "Proceso de moras ejecutado", result };
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo procesar las moras", error: String(err) };
    }
  })

  /**
   * Condonar mora de un crédito
   */
  .post("/mora/condonar", async ({ body, set }) => {
    try {
      const result = await condonarMora(body);
      set.status = result.success ? 200 : 400;
      return result;
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo condonar la mora", error: String(err) };
    }
  }, {
    body: t.Object({
      credito_id: t.Number(),
      motivo: t.String(),
      usuario_email: t.String(),
    })
  })

  /**
   * Obtener créditos con moras (JSON o Excel)
   */
  .get("/moras/creditos", async ({ query, set }) => {
    try {
      const { numero_credito_sifco, cuotas_atrasadas, estado, excel } = query;
      const result = await getCreditosWithMoras({
        numero_credito_sifco,
        cuotas_atrasadas: cuotas_atrasadas ? Number(cuotas_atrasadas) : undefined,
        estado: estado as any,
        excel: excel === "true",
      });
      return result;
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo obtener créditos con moras", error: String(err) };
    }
  }, {
    query: t.Object({
      numero_credito_sifco: t.Optional(t.String()),
      cuotas_atrasadas: t.Optional(t.String()),
      estado: t.Optional(t.String()),
      excel: t.Optional(t.String()),
    })
  })

  /**
   * Obtener historial de condonaciones de mora (JSON o Excel)
   */
  .get("/moras/condonaciones", async ({ query, set }) => {
    try {
      const { numero_credito_sifco, usuario_email, fecha_desde, fecha_hasta, excel } = query;
      const result = await getCondonacionesMora({
        numero_credito_sifco,
        usuario_email,
        fecha_desde: fecha_desde ? new Date(fecha_desde) : undefined,
        fecha_hasta: fecha_hasta ? new Date(fecha_hasta) : undefined,
        excel: excel === "true",
      });
      return result;
    } catch (err) {
      set.status = 500;
      return { success: false, message: "[ERROR] No se pudo obtener condonaciones", error: String(err) };
    }
  }, {
    query: t.Object({
      numero_credito_sifco: t.Optional(t.String()),
      usuario_email: t.Optional(t.String()),
      fecha_desde: t.Optional(t.String()), // ISO date string
      fecha_hasta: t.Optional(t.String()), // ISO date string
      excel: t.Optional(t.String()),
    })
  });
 