import { Elysia, t } from "elysia";
import { compraCarteraAceptada, extenderCompraCartera } from "../controllers/compraCarteraAceptada";
import { authMiddleware } from "./midleware";

export const compraCarteraAceptadaRouter = new Elysia()
  .use(authMiddleware)
  .post(
  "/compra-cartera-aceptada",
  compraCarteraAceptada,
  {
    body: t.Object({
      creditos: t.Array(t.Number({ minimum: 1 }), { minItems: 1 }),
      notas_adicionales: t.Optional(t.String()),
    }),
    detail: {
      summary: "Notificar aceptación de compra de cartera",
      description:
        "Envía una notificación por correo indicando que la compra de cartera de los créditos proporcionados ha sido aceptada.",
      tags: ["Inversionistas", "Compra Cartera"],
    },
  },
  )
  .post(
  "/compra-cartera-extender",
  extenderCompraCartera,
  {
    body: t.Object({
      creditos: t.Array(t.Number({ minimum: 1 }), { minItems: 1 }),
      inversionista_id: t.Number({ minimum: 1 }),
    }),
    detail: {
      summary: "Extender compra de cartera 24 horas",
      description:
        "Extiende una sola vez por compra la vigencia de una compra de cartera aceptada y pendiente de revisión.",
      tags: ["Inversionistas", "Compra Cartera"],
    },
  },
);
