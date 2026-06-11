import { Elysia, t } from "elysia";
import { createAbonoCapital, updateAbonoCapital } from "../controllers/abonosCapital";
import { authMiddleware } from "./midleware";

export const abonosCapitalRouter = new Elysia({ prefix: "/api/abonos-capital" })
  .use(authMiddleware)

  .post(
    "/",
    async ({ body }) => {
      const result = await createAbonoCapital(body);
      if (!result.success) {
        return { status: 500, body: result };
      }
      return result;
    },
    {
      body: t.Object({
        credito_id: t.Number(),
        inversionista_id: t.Number(),
        monto: t.String(),
        tipo: t.Union([t.Literal("CANCELACION"), t.Literal("CAPITAL")]),
        liquidado: t.Optional(t.Boolean()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params: { id }, body }) => {
      const abonoId = parseInt(id);
      if (isNaN(abonoId)) {
        return {
          status: 400,
          body: { success: false, message: "ID de abono inválido" },
        };
      }

      const result = await updateAbonoCapital(abonoId, body);
      if (!result.success) {
        return { status: 404, body: result };
      }
      return result;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        monto: t.Optional(t.String()),
        tipo: t.Optional(t.Union([t.Literal("CANCELACION"), t.Literal("CAPITAL")])),
        liquidado: t.Optional(t.Boolean()),
      }),
    }
  );
