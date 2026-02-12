import { Elysia, t } from "elysia";
import { llenarTablaEspejo } from "../controllers/mirrorInvestor";

export const mirrorInvestorRouter = new Elysia()
  .post("/llenar-tabla-espejo", llenarTablaEspejo, {
    body: t.Object({
      inversionista: t.String({ minLength: 1 }),
      creditos: t.Array(
        t.Object({
          meses_en_credito: t.Optional(t.Number()),
          cliente: t.String({ minLength: 1 }),
          capital: t.Number(),
          inversor: t.Number(),
          interes_inversor: t.Number(),
          iva: t.Number(),
        }),
        { minItems: 1 }
      ),
    }),
    detail: {
      summary: "Llenar tabla espejo de inversionistas",
      description:
        "Busca inversionista por nombre y para cada crédito (buscado por nombre de cliente) inserta/actualiza en la tabla espejo. Todo en transacción.",
      tags: ["Inversionistas", "Espejo"],
    },
  });
