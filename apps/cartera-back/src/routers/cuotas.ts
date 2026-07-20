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
        // buckets: CSV 0-5 opcional — filtra por bucket MOTOR (sin historial
        // solo cuenta como B0 si el crédito está al día en tiempo real). Lo
        // usa el job premora cuando PREMORA_BUCKETS incluye más que B0.
        let buckets: number[] | undefined;
        if (query.buckets != null && String(query.buckets).trim() !== "") {
          const bTokens = String(query.buckets)
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean);
          if (
            bTokens.length === 0 ||
            bTokens.some((s: string) => !/^[0-5]$/.test(s))
          ) {
            set.status = 400;
            return {
              success: false,
              message: "[ERROR] buckets inválido (CSV de enteros 0-5)",
            };
          }
          buckets = [...new Set(bTokens.map(Number))];
        }
        // asesor_id: opcional, entero positivo — filtra por asesor DUEÑO del
        // crédito (Agenda del día por asesor). Se baja al SQL para paginar bien.
        let asesorId: number | undefined;
        if (query.asesor_id != null && String(query.asesor_id).trim() !== "") {
          const s = String(query.asesor_id).trim();
          if (!/^\d{1,9}$/.test(s) || Number(s) < 1) {
            set.status = 400;
            return {
              success: false,
              message: "[ERROR] asesor_id inválido (entero positivo)",
            };
          }
          asesorId = Number(s);
        }
        // page / per_page: paginación OPCIONAL (Agenda del día). per_page se topa
        // a 200 para no permitir pedir toda la cartera de un jalón. Sin ellos →
        // sin paginación (el job de recordatorios necesita todas las cuotas).
        let perPage: number | undefined;
        if (query.per_page != null && String(query.per_page).trim() !== "") {
          const s = String(query.per_page).trim();
          if (!/^\d{1,3}$/.test(s) || Number(s) < 1 || Number(s) > 200) {
            set.status = 400;
            return {
              success: false,
              message: "[ERROR] per_page inválido (entero 1-200)",
            };
          }
          perPage = Number(s);
        }
        let page: number | undefined;
        if (query.page != null && String(query.page).trim() !== "") {
          const s = String(query.page).trim();
          if (!/^\d{1,6}$/.test(s) || Number(s) < 1) {
            set.status = 400;
            return {
              success: false,
              message: "[ERROR] page inválido (entero positivo)",
            };
          }
          page = Number(s);
        }
        const dias = [...new Set(tokens.map(Number))];
        return await getCuotasProximasVencer(dias, {
          soloAlDia: rawSoloAlDia === "true",
          buckets,
          asesorId,
          page,
          perPage,
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
        buckets: t.Optional(t.String()),
        asesor_id: t.Optional(t.String()),
        page: t.Optional(t.String()),
        per_page: t.Optional(t.String()),
      }),
    },
  );
