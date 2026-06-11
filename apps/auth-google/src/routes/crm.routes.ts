/**
 * Rutas para operaciones del CRM (leads, documentos, contratos, créditos)
 * Todas estas rutas requieren autenticación de Better Auth
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { auth } from "../lib/auth";
import {
  // Profile / Lead
  getProfile,
  updateLead,
  getNumbersSifco,
  // Documents
  getPersonalDocuments,
  getContracts,
  // Credits
  getCredits,
  getCreditByNumeroSifco,
  type UpdateLeadPayload,
} from "../services/crm";

// Tipado para el contexto de Hono con variables de autenticación
type Variables = {
  user: any;
  session: any;
  token: string;
};

const crmRoutes = new Hono<{ Variables: Variables }>();

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================

const requireAuth = async (c: any, next: () => Promise<void>) => {
  try {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session || !session.user) {
      throw new HTTPException(401, { message: "No autorizado. Inicia sesión." });
    }

    c.set("user", session.user);
    c.set("session", session.session);
    // Guardar el token para reenviarlo al CRM
    c.set("token", session.session.token);

    await next();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(401, { message: "Token inválido o expirado" });
  }
};

// Aplicar middleware a todas las rutas
crmRoutes.use("*", requireAuth);

// ============================================
// RUTAS DE PERFIL / LEAD
// ============================================

/**
 * GET /api/crm/profile
 * Obtener perfil del lead
 */
crmRoutes.get("/profile", async (c) => {
  try {
    const email = c.req.query("email");
    const dpi = c.req.query("dpi");
    const token = c.get("token") as string;

    if (!email || !dpi) {
      throw new HTTPException(400, { message: "Los parámetros email y dpi son requeridos" });
    }

    const profile = await getProfile(email, dpi, token);

    return c.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener perfil",
    });
  }
});

/**
 * POST /api/crm/profile/update
 * Actualizar información del lead
 */
crmRoutes.post("/profile/update", async (c) => {
  try {
    const body = await c.req.json<UpdateLeadPayload>();
    const token = c.get("token") as string;

    if (!body.email) {
      throw new HTTPException(400, { message: "El campo email es requerido" });
    }

    const result = await updateLead(body, token);

    return c.json({
      success: true,
      message: "Información actualizada correctamente",
      data: result.data,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al actualizar información",
    });
  }
});

/**
 * GET /api/crm/sifco
 * Obtener números SIFCO del lead
 */
crmRoutes.get("/sifco", async (c) => {
  try {
    const email = c.req.query("email");
    const dpi = c.req.query("dpi");
    const token = c.get("token") as string;

    if (!email || !dpi) {
      throw new HTTPException(400, { message: "Los parámetros email y dpi son requeridos" });
    }

    const opportunities = await getNumbersSifco(email, dpi, token);

    return c.json({
      success: true,
      data: opportunities,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener números SIFCO",
    });
  }
});

// ============================================
// RUTAS DE DOCUMENTOS Y CONTRATOS
// ============================================

/**
 * GET /api/crm/documents
 * Obtener documentos del lead
 */
crmRoutes.get("/documents", async (c) => {
  try {
    const email = c.req.query("email");
    const dpi = c.req.query("dpi");
    const token = c.get("token") as string;

    if (!email || !dpi) {
      throw new HTTPException(400, { message: "Los parámetros email y dpi son requeridos" });
    }

    const documents = await getPersonalDocuments(email, dpi, token);

    return c.json({
      success: true,
      data: documents,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener documentos",
    });
  }
});

/**
 * GET /api/crm/contracts
 * Obtener contratos del lead
 */
crmRoutes.get("/contracts", async (c) => {
  try {
    const email = c.req.query("email");
    const dpi = c.req.query("dpi");
    const token = c.get("token") as string;

    if (!email || !dpi) {
      throw new HTTPException(400, { message: "Los parámetros email y dpi son requeridos" });
    }

    const contracts = await getContracts(email, dpi, token);

    return c.json({
      success: true,
      data: contracts,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener contratos",
    });
  }
});

// ============================================
// RUTAS DE CRÉDITOS
// ============================================

/**
 * GET /api/crm/credits
 * Obtener créditos por números SIFCO (array en query param separado por comas)
 */
crmRoutes.get("/credits", async (c) => {
  try {
    const numerosSifcoParam = c.req.query("numerosSifco");

    if (!numerosSifcoParam) {
      throw new HTTPException(400, { message: "El parámetro numerosSifco es requerido" });
    }

    const numerosSifco = numerosSifcoParam.split(",").map((n) => n.trim());
    const credits = await getCredits(numerosSifco);

    return c.json({
      success: true,
      data: credits,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener créditos",
    });
  }
});

/**
 * GET /api/crm/credit
 * Obtener un crédito específico por número SIFCO
 */
crmRoutes.get("/credit", async (c) => {
  try {
    const numeroSifco = c.req.query("numeroSifco");

    if (!numeroSifco) {
      throw new HTTPException(400, { message: "El parámetro numeroSifco es requerido" });
    }

    const credit = await getCreditByNumeroSifco(numeroSifco);

    if (!credit) {
      throw new HTTPException(404, { message: "Crédito no encontrado" });
    }

    return c.json({
      success: true,
      data: credit,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al obtener crédito",
    });
  }
});

export default crmRoutes;
