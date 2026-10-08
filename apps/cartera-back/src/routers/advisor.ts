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
import { authMiddleware, rechazoSiNoEsAdminActivo } from "./midleware";

export const advisorRouter = new Elysia()
  .use(authMiddleware)

  // Crear asesores (con su login) y editarlos —clave incluida— es de ADMIN:
  // sólo con `authMiddleware` cualquier token vivo (un ASESOR, un CONTA) podía
  // cambiarle la contraseña a otro asesor y entrar como él.
  .post("/advisor", async (ctx: any) => {
    const rechazo = await rechazoSiNoEsAdminActivo(ctx.user, ctx.set);
    if (rechazo) return rechazo;
    return insertAdvisor(ctx);
  })
  .post("/updateAdvisor", async (ctx: any) => {
    const rechazo = await rechazoSiNoEsAdminActivo(ctx.user, ctx.set);
    if (rechazo) return rechazo;
    return updateAdvisor(ctx);
  })
  .get("/advisor", getAdvisors)
  .get("/creditos-crm", getCreditosCRM)
  // Reasignar el asesor de un crédito es de ADMIN. El dashboard Nexa acota al
  // ASESOR por `creditos.asesor_id`: con sólo `authMiddleware` un ASESOR podía
  // meterse créditos ajenos en su dashboard. Ningún front ni el CRM la llaman
  // (sólo el script de migración `actualizar_asesores.py`, a mano); el token de
  // servicio del CRM es ADMIN, así que su camino sigue pasando este gate.
  .post(
    "/updateCreditAdvisor",
    async (ctx: any) => {
      const rechazo = await rechazoSiNoEsAdminActivo(ctx.user, ctx.set);
      if (rechazo) return rechazo;
      return updateCreditAdvisor(ctx);
    },
    {
      body: t.Object({
        credito_id: t.Number(),
        nombre_asesor: t.String(),
      }),
    }
  )
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