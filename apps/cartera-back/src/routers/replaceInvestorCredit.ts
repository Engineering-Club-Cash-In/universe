import { Elysia, t } from "elysia";
import {
  manualReassignInvestor,
  returnPendingInvestorsToCube,
} from "../controllers/replaceInvestorCredit";
import { authMiddleware } from "./midleware";

export const replaceInvestorCreditRouter = new Elysia()
  .use(authMiddleware)
  .post(
    "/reemplazar-inversionista-credito",
    manualReassignInvestor,
    {
      body: t.Object({
        inversionista_id: t.Number({ minimum: 1 }),
        credito_espejo_removido_id: t.Number({ minimum: 1 }),
        tipo_operacion: t.Optional(
          t.Union([
            t.Literal("reinversion"),
            t.Literal("compra_cartera"),
          ]),
        ),
        porcentaje_cash_in: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
        porcentaje_inversion: t.Optional(
          t.Number({ minimum: 0, maximum: 100 }),
        ),
        reasignaciones: t.Array(
          t.Object({
            credito_destino_id: t.Number({ minimum: 1 }),
            monto: t.Number({ minimum: 0.01 }),
          }),
          { minItems: 1 },
        ),
      }),
      detail: {
        summary: "Reasignar inversionista manualmente entre créditos",
        description:
          "Saca al inversionista del crédito origen (devolviendo su monto a CUBE en padre y espejo), y lo asigna a los créditos destino especificados (restando de CUBE). Todo se recalcula en ambas tablas.",
        tags: ["Inversionistas", "Créditos", "Espejo"],
      },
    },
  )
  .post(
    "/reemplazar-inversionista-credito/devolver-pendientes-a-cube",
    returnPendingInvestorsToCube,
    {
      body: t.Object({
        creditos: t.Union([
          t.Number({ minimum: 1 }),
          t.Array(t.Number({ minimum: 1 }), { minItems: 1 }),
        ]),
        inversionista_id: t.Optional(t.Number({ minimum: 1 })),
      }),
      detail: {
        summary: "Devolver inversionistas pendientes a CUBE",
        description:
          "Recibe uno o varios credito_id y limpia los créditos sacando inversionistas con status distinto de 'completado' en el espejo, devolviendo su monto a CUBE. Si se envía inversionista_id, la limpieza se restringe a ese inversionista.",
        tags: ["Inversionistas", "Créditos", "Espejo"],
      },
    },
  );
