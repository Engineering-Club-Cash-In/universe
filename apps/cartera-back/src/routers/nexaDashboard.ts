import { Elysia, t } from "elysia";
import { getNexaDashboard, parseNexaDashboardParams, getNexaCreditPayments } from "../controllers/nexaDashboard";
import { authMiddleware } from "./midleware";

// `authMiddleware` solo valida la firma del JWT. El dashboard expone tokens
// completos y pagos de todos los créditos: solo roles de operación.
const ROLES_NEXA = ["ADMIN", "ASESOR", "CONTA"];

export const nexaDashboardRouter = new Elysia()
  .use(authMiddleware)
  .onBeforeHandle(({ user, set }: any) => {
    if (!user || !ROLES_NEXA.includes(user.role)) {
      set.status = 403;
      return { success: false, message: "[ERROR] No autorizado (requiere ADMIN, ASESOR o CONTA)" };
    }
  })
  .get("/nexa/dashboard", async ({ query, set }) => {
    try {
      return await getNexaDashboard(parseNexaDashboardParams(query as Record<string, unknown>));
    } catch (error) {
      console.error("Error consultando el dashboard Nexa:", error);
      set.status = 500;
      return { message: "Error consultando el dashboard de Nexa" };
    }
  })
  .get(
    "/nexa/dashboard/:creditoId/pagos",
    async ({ params, set }) => {
      try {
        return await getNexaCreditPayments(params.creditoId);
      } catch (error) {
        console.error("Error consultando los pagos Nexa del crédito:", error);
        set.status = 500;
        return { message: "Error consultando los pagos del crédito" };
      }
    },
    { params: t.Object({ creditoId: t.Numeric({ minimum: 1 }) }) },
  );
