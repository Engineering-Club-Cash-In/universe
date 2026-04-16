import { Elysia, t } from "elysia";
import { completeEspejo } from "../controllers/completeEspejo";

export const completeEspejoRouter = new Elysia().post(
  "/completar-espejo",
  completeEspejo,
  {
    body: t.Object({
      creditos: t.Union([
        t.Number({ minimum: 1 }),
        t.Array(t.Number({ minimum: 1 }), { minItems: 1 }),
      ]),
      inversionista_id: t.Optional(t.Number({ minimum: 1 })),
    }),
    detail: {
      summary: "Marcar créditos espejo como completado",
      description:
        "Recibe un credito_id o un arreglo de credito_ids y marca los registros en creditos_inversionistas_espejo como 'completado'. Opcionalmente filtra por inversionista_id.",
      tags: ["Inversionistas", "Espejo"],
    },
  },
);
