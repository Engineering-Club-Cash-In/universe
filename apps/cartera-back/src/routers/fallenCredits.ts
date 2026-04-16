import { Elysia, t } from "elysia";
import { marcarCreditoComoCaido, getCreditosCaidos } from "../controllers/fallenCredits";

export const fallenCreditsRouter = new Elysia()

  // POST - Marcar crédito como caído
  .post(
    "/fallen-credits",
    async ({ body, set }) => {
      try {
        const result = await marcarCreditoComoCaido(body);
        if (!result.success) {
          set.status = 400;
          return result;
        }
        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { message: "Error marcando crédito como caído", error: String(error) };
      }
    },
    {
      body: t.Object({
        credito_id: t.Number(),
        motivo: t.String(),
        observaciones: t.Optional(t.String()),
      }),
    }
  )

  // GET - Obtener créditos caídos con filtros
  .get("/fallen-credits", async ({ query, set }) => {
    const {
      page = "1",
      perPage = "10",
      numero_credito_sifco,
      fecha_desde,
      fecha_hasta,
    } = query as Record<string, string>;

    const pageNum = Number(page);
    const perPageNum = Number(perPage);

    if (isNaN(pageNum) || isNaN(perPageNum)) {
      set.status = 400;
      return { message: "Parámetros 'page' y 'perPage' deben ser números válidos." };
    }

    try {
      const result = await getCreditosCaidos({
        page: pageNum,
        perPage: perPageNum,
        numero_credito_sifco: numero_credito_sifco || undefined,
        fecha_desde: fecha_desde || undefined,
        fecha_hasta: fecha_hasta || undefined,
      });
      set.status = 200;
      return result;
    } catch (error) {
      set.status = 500;
      return { message: "Error obteniendo créditos caídos", error: String(error) };
    }
  });
