import { Elysia, t } from "elysia";
import { notifyPayInvestors } from "../services/crm.service";
import { authMiddleware } from "./midleware";

export const notificationsRouter = new Elysia({ prefix: "/notifications" })
  .use(authMiddleware)
  .post(
    "/pay-investors",
    async ({ body, set }) => {
      const result = await notifyPayInvestors({
        titulo: body.titulo,
        descripcion: body.descripcion,
      });

      if (!result.success) {
        set.status = 502;
      }

      return result;
    },
    {
      body: t.Object({
        titulo: t.String({ minLength: 1 }),
        descripcion: t.Optional(t.String()),
      }),
      detail: {
        summary: "Notificar pago de inversionistas al CRM",
        description:
          "Envía una notificación al CRM indicando que los pagos de inversionistas están cargados y contabilidad puede subir boletas.",
        tags: ["Notifications"],
      },
    },
  );
