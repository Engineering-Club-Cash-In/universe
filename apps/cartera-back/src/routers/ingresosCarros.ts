import { Elysia, t } from "elysia";
import { authMiddleware } from "./midleware";
import {
  crearIngresoCarro,
  eliminarIngresoCarro,
  listarIngresosCarros,
} from "../controllers/ingresosCarros";

export const ingresosCarrosRouter = new Elysia({
  prefix: "/api/ingresos-carros",
})
  .use(authMiddleware)

  // POST - Crear un ingreso por carro (concepto + monto en una fecha).
  .post(
    "/",
    async ({ body, user, set }: any) => {
      try {
        const result = await crearIngresoCarro({
          fecha: body.fecha,
          concepto: body.concepto,
          monto: body.monto,
          created_by: user?.id ?? null,
        });
        set.status = 201;
        return result;
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Error creando ingreso", error: String(error) };
      }
    },
    {
      body: t.Object({
        fecha: t.String(), // "YYYY-MM-DD"
        concepto: t.String(),
        monto: t.Union([t.Number(), t.String()]),
      }),
    }
  )

  // GET - Listar. ?fechaInicio=YYYY-MM-DD&fechaFin=YYYY-MM-DD (opcionales).
  .get("/", async ({ query, set }: any) => {
    try {
      return await listarIngresosCarros({
        fechaInicio: query.fechaInicio,
        fechaFin: query.fechaFin,
      });
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Error listando ingresos", error: String(error) };
    }
  })

  // DELETE - Eliminar por id.
  .delete("/:id", async ({ params, set }: any) => {
    try {
      const result = await eliminarIngresoCarro(Number(params.id));
      if (!result.success) set.status = 404;
      return result;
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Error eliminando ingreso", error: String(error) };
    }
  });
