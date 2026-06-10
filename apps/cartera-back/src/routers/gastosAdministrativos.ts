import { Elysia, t } from "elysia";
import { authMiddleware } from "./midleware";
import {
  crearGastoAdministrativo,
  eliminarGastoAdministrativo,
  listarGastosAdministrativos,
} from "../controllers/gastosAdministrativos";

export const gastosAdministrativosRouter = new Elysia({
  prefix: "/api/gastos-administrativos",
})
  .use(authMiddleware)

  // POST - Crear un gasto administrativo (concepto + monto en una fecha).
  .post(
    "/",
    async ({ body, user, set }: any) => {
      try {
        const result = await crearGastoAdministrativo({
          fecha: body.fecha,
          concepto: body.concepto,
          monto: body.monto,
          created_by: user?.id ?? null,
        });
        set.status = 201;
        return result;
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Error creando gasto", error: String(error) };
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

  // GET - Listar gastos. ?fechaInicio=YYYY-MM-DD&fechaFin=YYYY-MM-DD (opcionales).
  .get("/", async ({ query, set }: any) => {
    try {
      return await listarGastosAdministrativos({
        fechaInicio: query.fechaInicio,
        fechaFin: query.fechaFin,
      });
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Error listando gastos", error: String(error) };
    }
  })

  // DELETE - Eliminar un gasto por id.
  .delete("/:id", async ({ params, set }: any) => {
    try {
      const result = await eliminarGastoAdministrativo(Number(params.id));
      if (!result.success) set.status = 404;
      return result;
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Error eliminando gasto", error: String(error) };
    }
  });
