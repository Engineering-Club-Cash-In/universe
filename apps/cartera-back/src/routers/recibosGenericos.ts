import { Elysia, t } from "elysia";
import {
  createReciboGenerico,
  getRecibosGenericos,
  getReciboGenericoById,
  updateReciboGenerico,
  deleteReciboGenerico,
  generateReciboGenericoPDF,
} from "../controllers/recibosGenericos";
import { authMiddleware } from "./midleware";

export const recibosGenericosRouter = new Elysia({
  prefix: "/recibos-genericos",
})
  .use(authMiddleware)

  // CREATE
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const recibo = await createReciboGenerico(body);
        set.status = 201;
        return recibo;
      } catch (err: any) {
        set.status = 500;
        return { message: err.message };
      }
    },
    {
      body: t.Object({
        nombre: t.String(),
        observaciones: t.Optional(t.String()),
        montos: t.Array(
          t.Object({
            concepto: t.String(),
            monto: t.String(),
          })
        ),
      }),
    }
  )

  // GET ALL (filtro por fecha)
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const recibos = await getRecibosGenericos({
          fecha_desde: query.fecha_desde,
          fecha_hasta: query.fecha_hasta,
        });
        return recibos;
      } catch (err: any) {
        set.status = 500;
        return { message: err.message };
      }
    },
    {
      query: t.Object({
        fecha_desde: t.Optional(t.String()),
        fecha_hasta: t.Optional(t.String()),
      }),
    }
  )

  // GET BY ID
  .get(
    "/:id",
    async ({ params: { id }, set }) => {
      try {
        const recibo = await getReciboGenericoById(parseInt(id));
        if (!recibo) {
          set.status = 404;
          return { message: "Recibo no encontrado" };
        }
        return recibo;
      } catch (err: any) {
        set.status = 500;
        return { message: err.message };
      }
    }
  )

  // UPDATE
  .put(
    "/:id",
    async ({ params: { id }, body, set }) => {
      try {
        const recibo = await updateReciboGenerico(parseInt(id), body);
        if (!recibo) {
          set.status = 404;
          return { message: "Recibo no encontrado" };
        }
        return recibo;
      } catch (err: any) {
        set.status = 500;
        return { message: err.message };
      }
    },
    {
      body: t.Object({
        nombre: t.Optional(t.String()),
        observaciones: t.Optional(t.String()),
        montos: t.Optional(
          t.Array(
            t.Object({
              concepto: t.String(),
              monto: t.String(),
            })
          )
        ),
      }),
    }
  )

  // DELETE
  .delete(
    "/:id",
    async ({ params: { id }, set }) => {
      try {
        const deleted = await deleteReciboGenerico(parseInt(id));
        if (!deleted) {
          set.status = 404;
          return { message: "Recibo no encontrado" };
        }
        return { message: "Recibo eliminado", recibo: deleted };
      } catch (err: any) {
        set.status = 500;
        return { message: err.message };
      }
    }
  )

  // GENERAR PDF
  .get(
    "/:id/pdf",
    async ({ params: { id }, set }) => {
      try {
        const result = await generateReciboGenericoPDF(parseInt(id));
        return result;
      } catch (err: any) {
        set.status = err.message?.includes("No se encontró") ? 404 : 500;
        return { message: err.message };
      }
    }
  );
