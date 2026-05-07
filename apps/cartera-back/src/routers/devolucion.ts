import { Elysia, t } from "elysia";
import { authMiddleware } from "./midleware";
import {
  listPendingDevolucion,
  aceptarDevolucion,
  rechazarDevolucion,
  getHistorialDevolucion,
} from "../controllers/devolucion";

export const devolucionRouter = new Elysia({ prefix: "/api/devolucion-credito" })
  .use(authMiddleware)

  // Listar créditos pendientes de autorización
  .get(
    "/list-pending",
    listPendingDevolucion,
    {
      query: t.Object({
        page: t.Optional(t.String({ pattern: "^[0-9]+$" })),
        limit: t.Optional(t.String({ pattern: "^[0-9]+$" })),
        status: t.Optional(t.String()),
        search: t.Optional(t.String()),
      }),
    }
  )

  // Aceptar devolución
  .post("/:id/aceptar", aceptarDevolucion, {
    params: t.Object({
      id: t.String({ pattern: "^[0-9]+$" }),
    }),
  })

  // Rechazar devolución
  .post("/:id/rechazar", rechazarDevolucion, {
    params: t.Object({
      id: t.String({ pattern: "^[0-9]+$" }),
    }),
    body: t.Object({
      motivo: t.String({ minLength: 1 }),
    }),
  })

  // Obtener historial de devolución
  .get("/:id/historial", getHistorialDevolucion, {
    params: t.Object({
      id: t.String({ pattern: "^[0-9]+$" }),
    }),
  });
