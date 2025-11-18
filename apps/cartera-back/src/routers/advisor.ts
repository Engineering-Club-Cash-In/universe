// routes/inversionistas.ts
import { Elysia, t } from "elysia";
import {
  getAdvisors,
  getCreditosPorAsesorController,
  insertAdvisor,
  updateAdvisor,
} from "../controllers/advisor";
import { authMiddleware } from "./midleware";

export const advisorRouter = new Elysia()
.use(authMiddleware) 
  .post("/advisor", insertAdvisor)
  .post("/updateAdvisor", updateAdvisor)
  .get("/advisor", getAdvisors)
  .get(
    "/creditos-por-asesor",
    async ({ query }) => {
      try {
        const { numero_credito_sifco } = query;
        const data = await getCreditosPorAsesorController(numero_credito_sifco);

        return {
          success: true,
          message: "Créditos por asesor obtenidos correctamente.",
          data,
        };
      } catch (error) {
        console.error("[ERROR] getCreditosPorAsesor:", error);
        return {
          success: false,
          message: "[ERROR] No se pudieron obtener los créditos por asesor.",
        };
      }
    },
    {
      query: t.Object({
        numero_credito_sifco: t.Optional(t.String()),
      }),
    }
  );
