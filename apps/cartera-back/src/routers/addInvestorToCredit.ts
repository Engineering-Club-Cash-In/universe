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
          // En sync con el enum del controller: excedente/variable se despliegan
          // como créditos nuevos con esa modalidad al reinvertir en combinada.
          t.Literal("reinversion_excedente"),
          t.Literal("reinversion_variable"),
        ]),
      ),
      fecha_inicio_participacion: t.Optional(t.String()),
      minimo: t.Optional(t.Number({ minimum: 1 })),
      // MODO MANUAL: arreglo de { credito_id, monto }. Si viene, se ignora el
      // buscador de candidatos y se opera SOLO sobre estos créditos. La suma
      // de los montos debe igualar monto_aportado.
      manual: t.Optional(
        t.Array(
          t.Object({
            credito_id: t.Number({ minimum: 1 }),
            monto: t.Number({ minimum: 0.01 }),
          }),
          { minItems: 1 },
        ),
      ),
    }),
    detail: {
      summary: "Agregar inversionista a créditos existentes",
      description:
        "Recibe un inversionista y monto, obtiene los créditos candidatos internamente, redistribuye restando a CUBE (ID 86), recalcula cuotas/intereses/IVA para todos los inversionistas, e inserta en ambas tablas (padre y espejo). MODO MANUAL: si se envía `manual` (arreglo de { credito_id, monto }), se ignora el buscador y se opera SOLO sobre esos créditos; la suma de los montos debe igualar monto_aportado.",
      tags: ["Inversionistas", "Créditos"],
    },
  },
);
