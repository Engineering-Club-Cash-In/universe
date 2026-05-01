import { Elysia, t } from "elysia";
import { addInvestorToCredit } from "../controllers/addInvestorToCredit";
import { authMiddleware } from "./midleware";

export const addInvestorToCreditRouter = new Elysia()
  .use(authMiddleware)
  .post(
  "/agregar-inversionista-credito",
  addInvestorToCredit,
  {
    body: t.Object({
      inversionista_id: t.Number({ minimum: 1 }),
      monto_aportado: t.Number({ minimum: 0.01 }),
      porcentaje_cash_in: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
      porcentaje_inversion: t.Optional(
        t.Number({ minimum: 0, maximum: 100 }),
      ),
      tipo_operacion: t.Union([
        t.Literal("reinversion"),
        t.Literal("compra_cartera"),
      ]),
      tipo_reinversion: t.Optional(
        t.Union([
          t.Literal("reinversion_capital"),
          t.Literal("reinversion_total"),
          t.Literal("sin_reinversion"),
        ]),
      ),
      fecha_inicio_participacion: t.Optional(t.String()),
    }),
    detail: {
      summary: "Agregar inversionista a créditos existentes",
      description:
        "Recibe un inversionista y monto, obtiene los créditos candidatos internamente, redistribuye restando a CUBE (ID 86), recalcula cuotas/intereses/IVA para todos los inversionistas, e inserta en ambas tablas (padre y espejo).",
      tags: ["Inversionistas", "Créditos"],
    },
  },
);
