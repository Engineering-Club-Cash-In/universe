import { Elysia, t } from "elysia";
import {
  getNexaDashboard, parseNexaDashboardParams, getNexaCreditPayments, parseRangoFechas, contarPagosNexaCredito,
  parseAsesorFiltro, resolverAlcanceNexa,
} from "../controllers/nexaDashboard";
import { findSessionUser } from "../controllers/auth";
import { authMiddleware } from "./midleware";

// `authMiddleware` solo valida la firma del JWT. El dashboard expone tokens
// completos y pagos de todos los créditos: solo roles de operación.
const ROLES_NEXA = ["ADMIN", "ASESOR", "CONTA"];

// Alcance por asesor con la fila VIGENTE de platform_users (por el id del token), no con el
// claim asesor_id del token, que se congela al firmarse. Si la base falla, lanza (500): cerrado.
const alcanceDeSesion = async (user: { id?: unknown; role?: unknown } | undefined, asesorPedido: number | null) =>
  resolverAlcanceNexa(user?.role, await findSessionUser(user?.id), asesorPedido);

export const nexaDashboardRouter = new Elysia()
  .use(authMiddleware)
  .onBeforeHandle(({ user, set }: any) => {
    if (!user || !ROLES_NEXA.includes(user.role)) {
      set.status = 403;
      return { success: false, message: "[ERROR] No autorizado (requiere ADMIN, ASESOR o CONTA)" };
    }
  })
  .get("/nexa/dashboard", async ({ query, set, user }: any) => {
    try {
      // Un ASESOR ve solo lo suyo: su `?asesor=` se ignora.
      const alcance = await alcanceDeSesion(user, parseAsesorFiltro(query?.asesor));
      return await getNexaDashboard(alcance, parseNexaDashboardParams(query as Record<string, unknown>));
    } catch (error) {
      console.error("Error consultando el dashboard Nexa:", error);
      set.status = 500;
      return { message: "Error consultando el dashboard de Nexa" };
    }
  })
  .get(
    "/nexa/dashboard/:creditoId/pagos",
    async ({ params, query, set, user }: any) => {
      try {
        // El detalle no se acota por `?asesor=`: solo por el alcance propio de un ASESOR.
        const alcance = await alcanceDeSesion(user, null);
        const pagos = await getNexaCreditPayments(alcance, params.creditoId, parseRangoFechas(query as Record<string, unknown>));
        if (!pagos) {
          // Mismo 404 exista o no el crédito: no confirma créditos ajenos.
          set.status = 404;
          return { message: "Crédito no encontrado" };
        }
        return pagos;
      } catch (error) {
        console.error("Error consultando los pagos Nexa del crédito:", error);
        set.status = 500;
        return { message: "Error consultando los pagos del crédito" };
      }
    },
    { params: t.Object({ creditoId: t.Numeric({ minimum: 1, maximum: 2_147_483_647, multipleOf: 1 }) }) },
  )
  .get(
    "/nexa/credito/:creditoId/pagos-nexa",
    async ({ params, set }) => {
      try {
        return await contarPagosNexaCredito(params.creditoId);
      } catch (error) {
        console.error("Error contando los pagos Nexa del crédito:", error);
        set.status = 500;
        return { message: "Error consultando los pagos Nexa del crédito" };
      }
    },
    { params: t.Object({ creditoId: t.Numeric({ minimum: 1, maximum: 2_147_483_647, multipleOf: 1 }) }) },
  );
