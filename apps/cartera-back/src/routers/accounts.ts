// routes/cuentas.routes.ts
import { Elysia, t } from "elysia";
import { createCuentaEmpresa, crearMovimientoCuentaEmpresa, deleteCuentaEmpresa, getCuentaById, getCuentasEmpresa, updateCuentaEmpresa } from "../controllers/accounts";
import { authMiddleware } from "./midleware";


export const cuentasRoutes = new Elysia({ prefix: "/api/cuentas" })
  // 🔒 Aplicar middleware de autenticación a todas las rutas
  .use(authMiddleware)

  // 📋 GET - Obtener cuentas (con filtros opcionales por nombre y/o cuentaId)
  // Query: ?nombre=cube&cuentaId=9&soloActivas=true
  .get(
    "/",
    async ({ query }) => {
      try {
        const cuentaIdNum = query.cuentaId ? parseInt(query.cuentaId) : undefined;
        if (query.cuentaId && isNaN(cuentaIdNum!)) {
          return {
            status: 400,
            body: { success: false, message: "❌ cuentaId inválido" },
          };
        }

        const result = await getCuentasEmpresa({
          nombreCuenta: query.nombre,
          cuentaId: cuentaIdNum,
          soloActivas: query.soloActivas === "true",
        });

        if (!result.success) {
          return { status: 500, body: result };
        }

        return result;
      } catch (error: any) {
        console.error("❌ Error en GET /cuentas:", error);
        return {
          status: 500,
          body: {
            success: false,
            message: "❌ Error interno del servidor",
            error: error.message,
          },
        };
      }
    },
    {
      query: t.Object({
        nombre: t.Optional(t.String()),
        cuentaId: t.Optional(t.String()),
        soloActivas: t.Optional(t.String()),
      }),
    }
  )

  // 🔍 GET - Obtener cuenta por ID
  .get(
    "/:id",
    async ({ params: { id } }) => {
      try {
        const cuentaId = parseInt(id);

        if (isNaN(cuentaId)) {
          return {
            status: 400,
            body: {
              success: false,
              message: "❌ ID de cuenta inválido",
            },
          };
        }

        const result = await getCuentaById(cuentaId);

        if (!result.success) {
          return {
            status: 404,
            body: result,
          };
        }

        return result;
      } catch (error: any) {
        console.error("❌ Error en GET /cuentas/:id:", error);
        return {
          status: 500,
          body: {
            success: false,
            message: "❌ Error interno del servidor",
            error: error.message,
          },
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // ➕ POST - Crear nueva cuenta
  .post(
    "/",
    async ({ body }) => {
      try {
        const { nombreCuenta, banco, numeroCuenta, descripcion, moneda } = body;

        // Validaciones
        if (!nombreCuenta || !banco || !numeroCuenta) {
          return {
            status: 400,
            body: {
              success: false,
              message: "❌ Faltan campos obligatorios: nombreCuenta, banco, numeroCuenta",
            },
          };
        }

        const result = await createCuentaEmpresa({
          nombreCuenta,
          banco,
          numeroCuenta,
          descripcion,
          moneda,
        });

        if (!result.success) {
          return {
            status: 500,
            body: result,
          };
        }

        return {
          status: 201,
          body: result,
        };
      } catch (error: any) {
        console.error("❌ Error en POST /cuentas:", error);
        return {
          status: 500,
          body: {
            success: false,
            message: "❌ Error interno del servidor",
            error: error.message,
          },
        };
      }
    },
    {
      body: t.Object({
        nombreCuenta: t.String(),
        banco: t.String(),
        numeroCuenta: t.String(),
        descripcion: t.Optional(t.String()),
        moneda: t.Optional(
          t.Union([t.Literal("quetzales"), t.Literal("dolares")])
        ),
      }),
    }
  )

  // ✏️ PUT - Actualizar cuenta
  .put(
    "/:id",
    async ({ params: { id }, body }) => {
      try {
        const cuentaId = parseInt(id);

        if (isNaN(cuentaId)) {
          return {
            status: 400,
            body: {
              success: false,
              message: "❌ ID de cuenta inválido",
            },
          };
        }

        const result = await updateCuentaEmpresa(cuentaId, body);

        if (!result.success) {
          return {
            status: 404,
            body: result,
          };
        }

        return result;
      } catch (error: any) {
        console.error("❌ Error en PUT /cuentas/:id:", error);
        return {
          status: 500,
          body: {
            success: false,
            message: "❌ Error interno del servidor",
            error: error.message,
          },
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        nombreCuenta: t.Optional(t.String()),
        banco: t.Optional(t.String()),
        numeroCuenta: t.Optional(t.String()),
        descripcion: t.Optional(t.String()),
        activo: t.Optional(t.Boolean()),
        moneda: t.Optional(
          t.Union([t.Literal("quetzales"), t.Literal("dolares")])
        ),
      }),
    }
  )

  // 🗑️ DELETE - Desactivar cuenta (soft delete)
  .delete(
    "/:id",
    async ({ params: { id } }) => {
      try {
        const cuentaId = parseInt(id);

        if (isNaN(cuentaId)) {
          return {
            status: 400,
            body: {
              success: false,
              message: "❌ ID de cuenta inválido",
            },
          };
        }

        const result = await deleteCuentaEmpresa(cuentaId);

        if (!result.success) {
          return {
            status: 404,
            body: result,
          };
        }

        return result;
      } catch (error: any) {
        console.error("❌ Error en DELETE /cuentas/:id:", error);
        return {
          status: 500,
          body: {
            success: false,
            message: "❌ Error interno del servidor",
            error: error.message,
          },
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // 💸 POST - Registrar movimiento (ingreso/egreso) en una cuenta.
  // El trigger DB aplica el delta al saldo_actual y guarda saldo_post.
  .post(
    "/:id/movimientos",
    async ({ params: { id }, body, user }: any) => {
      try {
        const cuentaId = parseInt(id);
        if (isNaN(cuentaId)) {
          return {
            status: 400,
            body: { success: false, message: "❌ ID de cuenta inválido" },
          };
        }

        if (body.monto <= 0) {
          return {
            status: 400,
            body: { success: false, message: "❌ El monto debe ser mayor a 0" },
          };
        }

        const result = await crearMovimientoCuentaEmpresa({
          cuentaId,
          tipo: body.tipo,
          monto: String(body.monto),
          motivo: body.motivo,
          createdBy: user?.id,
        });

        if (!result.success) {
          return { status: 400, body: result };
        }

        return { status: 201, body: result };
      } catch (error: any) {
        console.error("❌ Error en POST /cuentas/:id/movimientos:", error);
        return {
          status: 500,
          body: {
            success: false,
            message: "❌ Error interno del servidor",
            error: error.message,
          },
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        tipo: t.Union([t.Literal("ingreso"), t.Literal("egreso")]),
        monto: t.Number({ minimum: 0.01 }),
        motivo: t.Optional(t.String()),
      }),
    }
  );