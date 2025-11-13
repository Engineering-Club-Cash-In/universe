// routes/cuentas.routes.ts
import { Elysia, t } from "elysia";
import { createCuentaEmpresa, deleteCuentaEmpresa, getCuentaById, getCuentasEmpresa, updateCuentaEmpresa } from "../controllers/accounts";
import { authMiddleware } from "./midleware";


export const cuentasRoutes = new Elysia({ prefix: "/api/cuentas" })
  // 🔒 Aplicar middleware de autenticación a todas las rutas
  .use(authMiddleware)

  // 📋 GET - Obtener todas las cuentas activas
  .get("/", async () => {
    try {
      const result = await getCuentasEmpresa();

      if (!result.success) {
        return {
          status: 500,
          body: result,
        };
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
  })

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
        const { nombreCuenta, banco, numeroCuenta, descripcion } = body;

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
  );