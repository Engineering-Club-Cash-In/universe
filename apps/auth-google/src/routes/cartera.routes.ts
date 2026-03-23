/**
 * Rutas para operaciones de Cartera (inversiones, inversionistas, etc.)
 * Todas estas rutas requieren autenticación de Better Auth
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { auth } from "../lib/auth";
import {
  // Investor
  createInvestor,
  getInvestorProfile,
  getBancos,
  // Investments
  getLiquidaciones,
  getInvestmentsStats,
  getAsesorById,
  type CreateInvestorPayload,
} from "../services/cartera";
import { getSignedUrlFromBucket } from "../lib/storage";

const carteraRoutes = new Hono();

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================

/**
 * Middleware para verificar sesión de Better Auth
 */
const requireAuth = async (c: any, next: () => Promise<void>) => {
  try {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session || !session.user) {
      throw new HTTPException(401, { message: "No autorizado. Inicia sesión." });
    }

    // Agregar usuario a context para uso posterior
    c.set("user", session.user);
    c.set("session", session.session);

    await next();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(401, { message: "Token inválido o expirado" });
  }
};

// Aplicar middleware a todas las rutas
carteraRoutes.use("*", requireAuth);

// ============================================
// RUTAS DE INVERSIONISTAS
// ============================================

/**
 * POST /api/cartera/investor
 * Crear o actualizar un inversionista
 */
carteraRoutes.post("/investor", async (c) => {
  try {
    const body = await c.req.json<CreateInvestorPayload>();

    const result = await createInvestor(body);

    return c.json({
      success: true,
      message: "Inversionista creado/actualizado correctamente",
      data: result,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al crear inversionista",
    });
  }
});

/**
 * GET /api/cartera/investor
 * Obtener perfil de inversionista por DPI
 */
carteraRoutes.get("/investor", async (c) => {
  try {
    const dpi = c.req.query("dpi");
    const email = c.req.query("email");

    if (!dpi && !email) {
      throw new HTTPException(400, { message: "Se requiere dpi o email" });
    }

    const profile = await getInvestorProfile(dpi || "", email || "");

    return c.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener perfil del inversionista",
    });
  }
});

/**
 * GET /api/cartera/bancos
 * Obtener catálogo de bancos
 */
carteraRoutes.get("/bancos", async (c) => {
  try {
    const bancos = await getBancos();

    return c.json({
      success: true,
      data: bancos,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener bancos",
    });
  }
});

// ============================================
// RUTAS DE INVERSIONES / LIQUIDACIONES
// ============================================

/**
 * GET /api/cartera/liquidaciones
 * Obtener liquidaciones del inversionista por DPI
 */
carteraRoutes.get("/liquidaciones", async (c) => {
  try {
    const dpi = c.req.query("dpi");
    const email = c.req.query("email");
    const page = parseInt(c.req.query("page") || "1", 10);
    const perPage = parseInt(c.req.query("perPage") || "10", 10);

    if (!dpi && !email) {
      throw new HTTPException(400, { message: "Se requiere dpi o email" });
    }

    const liquidaciones = await getLiquidaciones(dpi || "", email || "", page, perPage);

    return c.json({
      success: true,
      ...liquidaciones,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener liquidaciones",
    });
  }
});

/**
 * GET /api/cartera/investments/stats
 * Obtener estadísticas de inversiones
 */
carteraRoutes.get("/investments/stats", async (c) => {
  try {
    const dpi = c.req.query("dpi");
    const email = c.req.query("email");

    if (!dpi && !email) {
      throw new HTTPException(400, { message: "Se requiere dpi o email" });
    }

    const stats = await getInvestmentsStats(dpi || "", email || "");

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener estadísticas",
    });
  }
});

// ============================================
// RUTAS DE ASESORES
// ============================================

/**
 * GET /api/cartera/advisor
 * Obtener información del asesor por ID
 */
carteraRoutes.get("/advisor", async (c) => {
  try {
    const id = c.req.query("id");

    if (!id) {
      throw new HTTPException(400, { message: "El parámetro id es requerido" });
    }

    const asesorId = parseInt(id, 10);
    if (isNaN(asesorId)) {
      throw new HTTPException(400, { message: "El parámetro id debe ser un número" });
    }

    const asesor = await getAsesorById(asesorId);

    return c.json({
      success: true,
      data: asesor,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener asesor",
    });
  }
});

// ============================================
// REPORTE DE LIQUIDACIONES (R2)
// ============================================

/**
 * GET /api/cartera/liquidaciones/reporte?email=correo@ejemplo.com
 * Genera URL temporal del reporte xlsx almacenado en R2
 */
carteraRoutes.get("/liquidaciones/reporte", async (c) => {
  try {
    const email = c.req.query("email");
    if (!email) {
      throw new HTTPException(400, { message: "El parámetro 'email' es requerido" });
    }

    const bucket = process.env.R2_BUCKET_NAME || "reports";
    const key = `settlement-history/${email}.xlsx`;

    const result = await getSignedUrlFromBucket(key, bucket);

    if (!result) {
      return c.json(
        { success: false, error: "Reporte no encontrado para este correo" },
        404,
      );
    }

    return c.json({
      success: true,
      data: {
        reporte_url: result.url,
        fecha_generacion: result.lastModified?.toISOString() || new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    console.error("[ReporteLiquidaciones] Error:", error);
    throw new HTTPException(500, {
      message: "Error al obtener el reporte",
    });
  }
});

export default carteraRoutes;
