// routes/cuentasExtraInversionista.routes.ts
import { Elysia, t } from "elysia";
import {
  createCuentaExtra,
  deleteCuentaExtra,
  getCuentaExtraById,
  getCuentasExtraByInversionista,
  listCuentasExtra,
  updateCuentaExtra,
} from "../controllers/cuentasExtraInversionista";
import { authMiddleware } from "./midleware";

const tipoCuentaSchema = t.Union([
  t.Literal("AHORRO"),
  t.Literal("AHORRO Q"),
  t.Literal("AHORROS"),
  t.Literal("AHORRO $"),
  t.Literal("MONETARIA"),
  t.Literal("MONETARIA Q"),
  t.Literal("MONETARIA $"),
  t.Literal("Capital"),
]);

const monedaSchema = t.Union([t.Literal("quetzales"), t.Literal("dolares")]);

export const cuentasExtraInversionistaRouter = new Elysia({
  prefix: "/api/cuentas-extra-inversionista",
})
  .use(authMiddleware)

  // 📋 GET - Listar todas las cuentas extra con filtros opcionales.
  // Query: ?inversionistaId=12&bancoId=3&tipoCuenta=MONETARIA&moneda=quetzales&numeroCuenta=1234&motivoCuenta=pagos
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const inversionistaId = query.inversionistaId
          ? parseInt(query.inversionistaId)
          : undefined;
        const bancoId = query.bancoId ? parseInt(query.bancoId) : undefined;

        if (query.inversionistaId && isNaN(inversionistaId!)) {
          set.status = 400;
          return { success: false, message: "❌ inversionistaId inválido" };
        }
        if (query.bancoId && isNaN(bancoId!)) {
          set.status = 400;
          return { success: false, message: "❌ bancoId inválido" };
        }

        const result = await listCuentasExtra({
          inversionistaId,
          bancoId,
          tipoCuenta: query.tipoCuenta as any,
          moneda: query.moneda as any,
          numeroCuenta: query.numeroCuenta,
          motivoCuenta: query.motivoCuenta,
        });

        if (!result.success) set.status = 500;
        return result;
      } catch (error: any) {
        console.error("❌ Error en GET /cuentas-extra-inversionista:", error);
        set.status = 500;
        return {
          success: false,
          message: "❌ Error interno del servidor",
          error: error.message,
        };
      }
    },
    {
      query: t.Object({
        inversionistaId: t.Optional(t.String()),
        bancoId: t.Optional(t.String()),
        tipoCuenta: t.Optional(tipoCuentaSchema),
        moneda: t.Optional(monedaSchema),
        numeroCuenta: t.Optional(t.String()),
        motivoCuenta: t.Optional(t.String()),
      }),
    }
  )

  // 👤 GET - Cuentas extra por inversionista
  .get(
    "/inversionista/:inversionistaId",
    async ({ params: { inversionistaId }, set }) => {
      try {
        const id = parseInt(inversionistaId);
        if (isNaN(id)) {
          set.status = 400;
          return { success: false, message: "❌ inversionistaId inválido" };
        }

        const result = await getCuentasExtraByInversionista(id);
        if (!result.success) set.status = 500;
        return result;
      } catch (error: any) {
        console.error(
          "❌ Error en GET /cuentas-extra-inversionista/inversionista/:inversionistaId:",
          error
        );
        set.status = 500;
        return {
          success: false,
          message: "❌ Error interno del servidor",
          error: error.message,
        };
      }
    },
    {
      params: t.Object({ inversionistaId: t.String() }),
    }
  )

  // 🔍 GET - Cuenta extra por ID
  .get(
    "/:id",
    async ({ params: { id }, set }) => {
      try {
        const cuentaExtraId = parseInt(id);
        if (isNaN(cuentaExtraId)) {
          set.status = 400;
          return { success: false, message: "❌ ID inválido" };
        }

        const result = await getCuentaExtraById(cuentaExtraId);
        if (!result.success) set.status = 404;
        return result;
      } catch (error: any) {
        console.error("❌ Error en GET /cuentas-extra-inversionista/:id:", error);
        set.status = 500;
        return {
          success: false,
          message: "❌ Error interno del servidor",
          error: error.message,
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
    }
  )

  // ➕ POST - Crear cuenta extra
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const result = await createCuentaExtra({
          inversionistaId: body.inversionistaId,
          bancoId: body.bancoId,
          tipoCuenta: body.tipoCuenta,
          numeroCuenta: body.numeroCuenta,
          motivoCuenta: body.motivoCuenta,
          moneda: body.moneda,
        });

        if (!result.success) {
          set.status = 400;
          return result;
        }

        set.status = 201;
        return result;
      } catch (error: any) {
        console.error("❌ Error en POST /cuentas-extra-inversionista:", error);
        set.status = 500;
        return {
          success: false,
          message: "❌ Error interno del servidor",
          error: error.message,
        };
      }
    },
    {
      body: t.Object({
        inversionistaId: t.Number(),
        bancoId: t.Number(),
        tipoCuenta: tipoCuentaSchema,
        numeroCuenta: t.String({ minLength: 1, maxLength: 100 }),
        motivoCuenta: t.String({ minLength: 1, maxLength: 255 }),
        moneda: t.Optional(monedaSchema),
      }),
    }
  )

  // ✏️ PUT - Actualizar cuenta extra
  .put(
    "/:id",
    async ({ params: { id }, body, set }) => {
      try {
        const cuentaExtraId = parseInt(id);
        if (isNaN(cuentaExtraId)) {
          set.status = 400;
          return { success: false, message: "❌ ID inválido" };
        }

        const result = await updateCuentaExtra(cuentaExtraId, body);
        if (!result.success) set.status = 404;
        return result;
      } catch (error: any) {
        console.error("❌ Error en PUT /cuentas-extra-inversionista/:id:", error);
        set.status = 500;
        return {
          success: false,
          message: "❌ Error interno del servidor",
          error: error.message,
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        bancoId: t.Optional(t.Number()),
        tipoCuenta: t.Optional(tipoCuentaSchema),
        numeroCuenta: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        motivoCuenta: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
        moneda: t.Optional(monedaSchema),
      }),
    }
  )

  // 🗑️ DELETE - Eliminar cuenta extra
  .delete(
    "/:id",
    async ({ params: { id }, set }) => {
      try {
        const cuentaExtraId = parseInt(id);
        if (isNaN(cuentaExtraId)) {
          set.status = 400;
          return { success: false, message: "❌ ID inválido" };
        }

        const result = await deleteCuentaExtra(cuentaExtraId);
        if (!result.success) set.status = 404;
        return result;
      } catch (error: any) {
        console.error("❌ Error en DELETE /cuentas-extra-inversionista/:id:", error);
        set.status = 500;
        return {
          success: false,
          message: "❌ Error interno del servidor",
          error: error.message,
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
    }
  );
