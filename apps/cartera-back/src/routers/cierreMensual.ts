import { Elysia, t } from "elysia";
import { generarCierreMensual, getCierreMensual } from "../controllers/cierreMensual";
import { authMiddleware } from "./midleware";

export const cierreMensualRouter = new Elysia()
  .use(authMiddleware)

  // POST - Generar (o regenerar) la foto de cierre de un mes.
  //   Sin body → usa el mes anterior a hoy (hora Guatemala).
  //   Con { periodo: "2026-05-01" } → regenera ese mes específico.
  .post(
    "/cierre-mensual/generar",
    async ({ body, set }) => {
      try {
        const periodo = (body as { periodo?: string })?.periodo;
        const result = await generarCierreMensual(periodo);
        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { message: "Error generando cierre mensual", error: String(error) };
      }
    },
    {
      body: t.Optional(
        t.Object({
          periodo: t.Optional(t.String()), // "YYYY-MM-01"
        })
      ),
    }
  )

  // GET - Consultar el cierre. ?periodo=2026-05-01 para filtrar un mes.
  .get("/cierre-mensual", async ({ query, set }) => {
    try {
      const { periodo } = query as Record<string, string>;
      const rows = await getCierreMensual(periodo || undefined);
      set.status = 200;
      return rows;
    } catch (error) {
      set.status = 500;
      return { message: "Error obteniendo cierre mensual", error: String(error) };
    }
  });
