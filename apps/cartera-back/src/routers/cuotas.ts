// routes/cuotas.ts — COBROS-02 · Premora (CC2-11): cuotas próximas a vencer.
import { Elysia, t } from "elysia";
import { authMiddleware } from "./midleware";
import { getCuotasProximasVencer } from "../controllers/cuotasProximas";

export const cuotasRouter = new Elysia()
  .use(authMiddleware)

  // Cuotas pendientes de créditos AL DÍA que vencen en exactamente N días
  // (día GT). Consumido por el job de recordatorios premora del CRM.
  // Sin gate de rol (solo autenticación), igual que /getAllCredits: la cuenta
  // de servicio del CRM debe poder llamarlo sin importar su rol.
  .get(
    "/cuotas/proximas-vencer",
    async ({ query, set, user }: any) => {
      if (!user) {
        set.status = 401;
        return { success: false, message: "[ERROR] No autenticado" };
      }
      try {
        // dias: CSV de enteros 0-60 (default premora: 5,3,1,0). Tokens
        // inválidos → 400, no descartar en silencio (criterio de /buckets/*).
        const raw = String(query.dias ?? "5,3,1,0");
        const tokens = raw.split(",").map((s: string) => s.trim()).filter(Boolean);
        if (
          tokens.length === 0 ||
          tokens.some((s: string) => !/^\d{1,2}$/.test(s) || Number(s) > 60)
        ) {
          set.status = 400;
          return {
            success: false,
            message: "[ERROR] dias inválido (CSV de enteros 0-60, ej. 5,3,1,0)",
          };
        }
        // solo_al_dia: "true" (default, premora) | "false" (Agenda del día:
        // todo el funnel ACTIVO/MOROSO/INCOBRABLE, sin exigir cero vencidas).
        const rawSoloAlDia = String(query.solo_al_dia ?? "true");
        if (rawSoloAlDia !== "true" && rawSoloAlDia !== "false") {
          set.status = 400;
          return {
            success: false,
            message: "[ERROR] solo_al_dia inválido (true|false)",
          };
        }
        const dias = [...new Set(tokens.map(Number))];
        return await getCuotasProximasVencer(dias, {
          soloAlDia: rawSoloAlDia === "true",
        });
      } catch (err) {
        set.status = 500;
        return {
          success: false,
          message: "[ERROR] No se pudo obtener las cuotas próximas a vencer",
          error: String(err),
        };
      }
    },
    {
      query: t.Object({
        dias: t.Optional(t.String()),
        solo_al_dia: t.Optional(t.String()),
      }),
    },
  );
