import { Elysia, t } from "elysia";
import { llenarTablaEspejo } from "../controllers/mirrorInvestor";

export const mirrorInvestorRouter = new Elysia()
  .post("/llenar-tabla-espejo", llenarTablaEspejo, {
    body: t.Object({
      credito_id: t.Number(),
      inversionista_id: t.Number(),
      monto: t.Number(),
      porcentaje_inversion: t.Number(),
      porcentaje_cash_in: t.Number(),
      iva_inversionista: t.Number(),
    }),
    detail: {
      summary: "Llenar tabla espejo de inversionistas",
      description:
        "Recibe datos del inversionista con montos nuevos, calcula campos derivados y los inserta/actualiza en la tabla espejo (creditos_inversionistas_espejo).",
      tags: ["Inversionistas", "Espejo"],
    },
  });
