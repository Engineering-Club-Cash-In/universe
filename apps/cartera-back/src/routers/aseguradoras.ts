import { Elysia, t } from "elysia";
import {
  listAseguradoras,
  resumenAseguradoras,
  resumenAseguradorasExcel,
  crearAseguradora,
  cambiarAseguradoraCredito,
} from "../controllers/aseguradoras";
import { authMiddleware } from "./midleware";

// Gate server-side: el módulo /seguros es ADMIN-only en el front (App.tsx),
// así que el resumen (expone montos por aseguradora) y las mutaciones deben
// exigir ADMIN aquí también; authMiddleware solo autentica. El catálogo
// (GET /aseguradoras) queda abierto porque lo usa el filtro de Créditos.
const requireAdmin = (user: { role?: string } | undefined, set: { status?: number }): boolean => {
  if (!user || user.role !== "ADMIN") {
    set.status = 403;
    return false;
  }
  return true;
};
const NO_AUTORIZADO = { message: "[ERROR] No autorizado (requiere ADMIN)" };

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
  })

  /**
   * GET /aseguradoras/resumen
   * Devuelve el resumen de aseguradoras con cantidad de créditos y monto de seguro.
   * Con ?excel=true devuelve un archivo .xlsx.
   * Response: { data: [{ id, nombre, cantidad_creditos, monto_seguro }] }
   */
  .get(
    "/aseguradoras/resumen",
    async ({ query, set, user }) => {
      if (!requireAdmin(user, set)) return NO_AUTORIZADO;
      try {
        if (query.excel === "true") {
          const buf = await resumenAseguradorasExcel();
          return new Response(new Uint8Array(buf), {
            headers: {
              "content-type":
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "content-disposition":
                'attachment; filename="resumen-aseguradoras.xlsx"',
            },
          });
        }
        const result = await resumenAseguradoras();
        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { message: "Error obteniendo resumen de aseguradoras", error: String(error) };
      }
    },
    {
      query: t.Object({
        excel: t.Optional(t.String()),
      }),
    }
  )

  /**
   * POST /aseguradoras
   * Crea o retorna una aseguradora existente (find-or-create, case-insensitive).
   * Body: { nombre: string }
   * Response: { id, nombre }
   */
  .post(
    "/aseguradoras",
    async ({ body, set, user }) => {
      if (!requireAdmin(user, set)) return NO_AUTORIZADO;
      try {
        const result = await crearAseguradora(body.nombre);
        if (!result.success) {
          set.status = result.status;
          return { message: result.error };
        }
        set.status = 200;
        return result.data;
      } catch (error) {
        set.status = 500;
        return { message: "Error creando aseguradora", error: String(error) };
      }
    },
    {
      body: t.Object({
        nombre: t.String(),
      }),
    }
  )

  /**
   * POST /creditos/cambiar-aseguradora
   * Asigna una aseguradora a un crédito.
   * Body: { credito_id: number, aseguradora_id: number }
   * Response: { success: true }
   */
  .post(
    "/creditos/cambiar-aseguradora",
    async ({ body, set, user }) => {
      if (!requireAdmin(user, set)) return NO_AUTORIZADO;
      try {
        const result = await cambiarAseguradoraCredito(
          body.credito_id,
          body.aseguradora_id
        );
        if (!result.success) {
          set.status = result.status;
          return { message: result.error };
        }
        set.status = 200;
        return { success: true };
      } catch (error) {
        set.status = 500;
        return { message: "Error cambiando aseguradora del crédito", error: String(error) };
      }
    },
    {
      body: t.Object({
        credito_id: t.Number(),
        aseguradora_id: t.Number(),
      }),
    }
  );
