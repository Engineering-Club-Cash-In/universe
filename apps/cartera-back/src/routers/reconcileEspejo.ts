import { Elysia, t } from "elysia";
import { reconcileEspejo } from "../controllers/reconcileEspejo";

export const reconcileEspejoRouter = new Elysia()
  .post("/reconcile-espejo", reconcileEspejo, {
    body: t.Object({
      inversionista: t.String({ minLength: 1 }),
      creditos: t.Array(
        t.Object({
          cliente: t.String({ minLength: 1 }),
          cuota_mes: t.String({ minLength: 1 }), // "ene. 26", "dic. 25", etc.
          abono_capital: t.Optional(t.String()),
          abono_interes: t.Optional(t.String()),
          abono_iva_12: t.Optional(t.String()),
          porcentaje_participacion: t.Optional(t.String()),
          cuota: t.Optional(t.String()),
          liquidacion_id: t.Optional(t.Number()),
        }),
        { minItems: 1 }
      ),
    }),
    detail: {
      summary: "Reconciliar pagos espejo con cuotas reales",
      description:
        "Para cada credito del inversionista, busca el registro LIQUIDADO en la tabla espejo, encuentra la cuota del mes indicado, y actualiza el pago_id. Las cuotas posteriores quedan como NO_LIQUIDADO.",
      tags: ["Inversionistas", "Espejo", "Reconciliacion"],
    },
  });
