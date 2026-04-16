import { Elysia, t } from "elysia";
import { compraCarteraAceptada } from "../controllers/compraCarteraAceptada";

export const compraCarteraAceptadaRouter = new Elysia().post(
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
);
