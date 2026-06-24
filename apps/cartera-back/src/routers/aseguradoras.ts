import { Elysia } from "elysia";
import { listAseguradoras } from "../controllers/aseguradoras";
import { authMiddleware } from "./midleware";

export const aseguradorasRouter = new Elysia()
  .use(authMiddleware)
  /**
   * GET /aseguradoras
   * Devuelve el catálogo completo de aseguradoras ordenado por nombre.
   * Response: { data: [{ id, nombre }] }
   */
  .get("/aseguradoras", async ({ set }) => {
    try {
      const result = await listAseguradoras();
      set.status = 200;
      return result;
    } catch (error) {
      set.status = 500;
      return { message: "Error obteniendo aseguradoras", error: String(error) };
    }
  });
