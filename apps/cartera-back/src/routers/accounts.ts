// routes/cuentas.routes.ts
import { Elysia, t } from "elysia";
import {
  createCuentaEmpresa,
  crearMovimientoCuentaEmpresa,
  deleteCuentaEmpresa,
  getCuentaById,
  getCuentasEmpresa,
  getMovimientosByCuenta,
  updateCuentaEmpresa,
} from "../controllers/accounts";
import { authMiddleware } from "./midleware";


export const cuentasRoutes = new Elysia({ prefix: "/api/cuentas" })
  // 🔒 Aplicar middleware de autenticación a todas las rutas
  .use(authMiddleware)

  // 📋 GET - Obtener cuentas (con filtros opcionales por nombre y/o cuentaId)
  // Query: ?nombre=cube&cuentaId=9&soloActivas=true
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const cuentaIdNum = query.cuentaId ? parseInt(query.cuentaId) : undefined;
        if (query.cuentaId && isNaN(cuentaIdNum!)) {
          set.status = 400;
          return { success: false, message: "❌ cuentaId inválido" };
        }

        const result = await getCuentasEmpresa({
          nombreCuenta: query.nombre,
          cuentaId: cuentaIdNum,
          soloActivas: query.soloActivas === "true",
        });

        if (!result.success) {
          set.status = 500;
        }
        return result;
      } catch (error: any) {
        console.error("❌ Error en GET /cuentas:", error);
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
        nombre: t.Optional(t.String()),
        cuentaId: t.Optional(t.String()),
        soloActivas: t.Optional(t.String()),
      }),
    }
  )

  // 🔍 GET - Obtener cuenta por ID
  .get(
    "/:id",
    async ({ params: { id }, set }) => {
      try {
        const cuentaId = parseInt(id);

        if (isNaN(cuentaId)) {
          set.status = 400;
          return { success: false, message: "❌ ID de cuenta inválido" };
        }

        const result = await getCuentaById(cuentaId);
        if (!result.success) set.status = 404;
        return result;
      } catch (error: any) {
        console.error("❌ Error en GET /cuentas/:id:", error);
        set.status = 500;
        return {
          success: false,
          message: "❌ Error interno del servidor",
          error: error.message,
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
    async ({ body, set }) => {
      try {
        const { nombreCuenta, banco, numeroCuenta, descripcion, moneda } = body;

        if (!nombreCuenta || !banco || !numeroCuenta) {
          set.status = 400;
          return {
            success: false,
            message: "❌ Faltan campos obligatorios: nombreCuenta, banco, numeroCuenta",
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
          set.status = 500;
          return result;
        }

        set.status = 201;
        return result;
      } catch (error: any) {
        console.error("❌ Error en POST /cuentas:", error);
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
    async ({ params: { id }, body, set }) => {
      try {
        const cuentaId = parseInt(id);

        if (isNaN(cuentaId)) {
          set.status = 400;
          return { success: false, message: "❌ ID de cuenta inválido" };
        }

        const result = await updateCuentaEmpresa(cuentaId, body);
        if (!result.success) set.status = 404;
        return result;
      } catch (error: any) {
        console.error("❌ Error en PUT /cuentas/:id:", error);
        set.status = 500;
        return {
          success: false,
          message: "❌ Error interno del servidor",
          error: error.message,
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
    async ({ params: { id }, set }) => {
      try {
        const cuentaId = parseInt(id);

        if (isNaN(cuentaId)) {
          set.status = 400;
          return { success: false, message: "❌ ID de cuenta inválido" };
        }

        const result = await deleteCuentaEmpresa(cuentaId);
        if (!result.success) set.status = 404;
        return result;
      } catch (error: any) {
        console.error("❌ Error en DELETE /cuentas/:id:", error);
        set.status = 500;
        return {
          success: false,
          message: "❌ Error interno del servidor",
          error: error.message,
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // 📑 GET - Listar movimientos de una cuenta con filtros opcionales.
  // Query: ?tipo=ingreso&desde=2025-01-01&hasta=2025-12-31&orden=desc
  .get(
    "/:id/movimientos",
    async ({ params: { id }, query, set }) => {
      try {
        const cuentaId = parseInt(id);
        if (isNaN(cuentaId)) {
          set.status = 400;
          return { success: false, message: "❌ ID de cuenta inválido" };
        }

        const desde = query.desde ? new Date(query.desde) : undefined;
        const hasta = query.hasta ? new Date(query.hasta) : undefined;
        if ((query.desde && isNaN(desde!.getTime())) || (query.hasta && isNaN(hasta!.getTime()))) {
          set.status = 400;
          return { success: false, message: "❌ Fecha inválida (use ISO 8601)" };
        }

        const result = await getMovimientosByCuenta(cuentaId, {
          tipo: query.tipo as any,
          desde,
          hasta,
          orden: query.orden === "asc" ? "asc" : "desc",
        });

        if (!result.success) set.status = 500;
        return result;
      } catch (error: any) {
        console.error("❌ Error en GET /cuentas/:id/movimientos:", error);
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
      query: t.Object({
        tipo: t.Optional(
          t.Union([t.Literal("ingreso"), t.Literal("egreso")])
        ),
        desde: t.Optional(t.String()),
        hasta: t.Optional(t.String()),
        orden: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
      }),
    }
  )

  // 💸 POST - Registrar movimiento (ingreso/egreso) en una cuenta.
  // El trigger DB aplica el delta al saldo_actual y guarda saldo_post.
  .post(
    "/:id/movimientos",
    async ({ params: { id }, body, user, set }: any) => {
      try {
        const cuentaId = parseInt(id);
        if (isNaN(cuentaId)) {
          set.status = 400;
          return { success: false, message: "❌ ID de cuenta inválido" };
        }

        if (body.monto <= 0) {
          set.status = 400;
          return { success: false, message: "❌ El monto debe ser mayor a 0" };
        }

        const result = await crearMovimientoCuentaEmpresa({
          cuentaId,
          tipo: body.tipo,
          monto: String(body.monto),
          motivo: body.motivo,
          createdBy: user?.id,
        });

        if (!result.success) {
          set.status = 400;
          return result;
        }

        set.status = 201;
        return result;
      } catch (error: any) {
        console.error("❌ Error en POST /cuentas/:id/movimientos:", error);
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
        tipo: t.Union([t.Literal("ingreso"), t.Literal("egreso")]),
        monto: t.Number({ minimum: 0.01 }),
        motivo: t.Optional(t.String()),
      }),
    }
  );
