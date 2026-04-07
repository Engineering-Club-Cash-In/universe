import { Elysia, t } from "elysia";
import { replaceInvestorCredit } from "../controllers/replaceInvestorCredit";

export const replaceInvestorCreditRouter = new Elysia().post(
  "/reemplazar-inversionista-credito",
  replaceInvestorCredit,
  {
    body: t.Object({
      creditos: t.Union([
        t.Number({ minimum: 1 }),
        t.Array(t.Number({ minimum: 1 }), { minItems: 1 }),
      ]),
    }),
    detail: {
      summary: "Reemplazar inversionistas pendientes en créditos",
      description:
        "Recibe credito_id(s), busca los inversionistas con status pendiente en espejo, los reubica en créditos nuevos (via getCreditCandidates), y luego limpia los créditos viejos devolviendo el monto a CUBE.",
      tags: ["Inversionistas", "Créditos", "Espejo"],
    },
  },
);
