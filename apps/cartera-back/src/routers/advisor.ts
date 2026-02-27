// routes/inversionistas.ts
import { Elysia, t } from "elysia";
import {
  getAdvisors,
  getCreditosPorAsesorController,
  getCreditosCRM,
  updateCreditAdvisor,
  insertAdvisor,
  updateAdvisor,
} from "../controllers/advisor";
import { authMiddleware } from "./midleware";

export const advisorRouter = new Elysia()
 
  .post("/advisor", insertAdvisor)
  .post("/updateAdvisor", updateAdvisor)
  .get("/advisor", getAdvisors)
  .get("/creditos-crm", getCreditosCRM)
  .post("/updateCreditAdvisor", updateCreditAdvisor, {
    body: t.Object({
      credito_id: t.Number(),
      nombre_asesor: t.String(),
    }),
  })
.get(
  "/creditos-por-asesor",
  async ({ query, set }) => {
    try {
      const { numero_credito_sifco, email_asesor } = query; // 🔥 NUEVO PARÁMETRO
      
      console.log(`🚀 GET /creditos-por-asesor | numero_credito_sifco: ${numero_credito_sifco}, email_asesor: ${email_asesor}`);
      
      const data = await getCreditosPorAsesorController(
        numero_credito_sifco,
        email_asesor // 🔥 NUEVO PARÁMETRO
      );

      set.status = 200;
      return {
        success: true,
        message: "Créditos por asesor obtenidos correctamente.",
        data,
      };
    } catch (error) {
      console.error("❌ [ERROR] getCreditosPorAsesor:", error);
      set.status = 500;
      return {
        success: false,
        message: "[ERROR] No se pudieron obtener los créditos por asesor.",
        error: String(error),
      };
    }
  },
  {
    query: t.Object({
      numero_credito_sifco: t.Optional(t.String()),
      email_asesor: t.Optional(t.String()), // 🔥 NUEVO PARÁMETRO
    }),
  }
);