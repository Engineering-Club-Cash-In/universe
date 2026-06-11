/**
 * Rutas unificadas para operaciones que involucran múltiples sistemas
 * (CRM + Cartera)
 */

import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { auth } from "../lib/auth";
import { db } from "../db/connection";
import { users, accounts } from "../db/schema";
import {
  registerExternalUser,
  type RegisterExternalUserPayload,
} from "../services/unified";

// Tipo para el contexto con variables personalizadas
type Variables = {
  user: { name?: string; email?: string };
  session: any;
};

const unifiedRoutes = new Hono<{ Variables: Variables }>();

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN (opcional para algunas rutas)
// ============================================

const requireAuth = async (c: Context<{ Variables: Variables }>, next: () => Promise<void>) => {
  try {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session || !session.user) {
      throw new HTTPException(401, { message: "No autorizado. Inicia sesión." });
    }

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

// ============================================
// RUTAS PÚBLICAS (sin auth - para registro)
// ============================================

/**
 * POST /api/unified/register-external
 * Registro unificado de usuario externo
 * Decide automáticamente si crear en CRM (cliente) o Cartera (inversionista)
 * 
 * Esta ruta NO requiere autenticación porque se llama durante el registro
 */
unifiedRoutes.post("/register-external", async (c) => {
  try {
    const body = await c.req.json<RegisterExternalUserPayload>();

    // Validaciones
    if (!body.userType || !["CLIENT", "INVESTOR"].includes(body.userType)) {
      throw new HTTPException(400, {
        message: "El campo userType es requerido y debe ser 'CLIENT' o 'INVESTOR'",
      });
    }

    if (!body.fullName) {
      throw new HTTPException(400, { message: "El campo fullName es requerido" });
    }

    if (!body.email) {
      throw new HTTPException(400, { message: "El campo email es requerido" });
    }

    if (!body.dpi) {
      throw new HTTPException(400, { message: "El campo dpi es requerido" });
    }

    // Validar formato DPI (13 dígitos)
    if (!/^\d{13}$/.test(body.dpi)) {
      throw new HTTPException(400, {
        message: "El DPI debe tener exactamente 13 dígitos",
      });
    }

    const result = await registerExternalUser(body);

    return c.json(result);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    
    // Si el error viene de los servicios externos, devolver 500
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al registrar usuario externo",
    });
  }
});

// ============================================
// RUTAS PROTEGIDAS (con auth)
// ============================================

/**
 * POST /api/unified/register-external-auth
 * Versión autenticada del registro externo
 * Útil cuando un usuario ya logueado quiere completar su registro en CRM/Cartera
 */
unifiedRoutes.post("/register-external-auth", requireAuth, async (c) => {
  try {
    const body = await c.req.json<RegisterExternalUserPayload>();
    const user = c.get("user") as { name?: string; email?: string } | undefined;

    // Usar datos del usuario autenticado si no se proporcionan
    const payload: RegisterExternalUserPayload = {
      userType: body.userType,
      fullName: body.fullName || user?.name || "",
      email: body.email || user?.email || "",
      dpi: body.dpi,
      phone: body.phone,
    };

    // Validaciones
    if (!payload.userType || !["CLIENT", "INVESTOR"].includes(payload.userType)) {
      throw new HTTPException(400, {
        message: "El campo userType es requerido y debe ser 'CLIENT' o 'INVESTOR'",
      });
    }

    if (!payload.dpi) {
      throw new HTTPException(400, { message: "El campo dpi es requerido" });
    }

    if (!/^\d{13}$/.test(payload.dpi)) {
      throw new HTTPException(400, {
        message: "El DPI debe tener exactamente 13 dígitos",
      });
    }

    const result = await registerExternalUser(payload);

    return c.json(result);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al registrar usuario externo",
    });
  }
});

// ============================================
// BULK IMPORT (público)
// ============================================

unifiedRoutes.post("/bulk-import-investors", async (c) => {
  type InvestorRow = { nombre: string; dpi: string; correo: string };

  const body = await c.req.json<InvestorRow[]>();

  if (!Array.isArray(body) || body.length === 0) {
    throw new HTTPException(400, { message: "Se requiere un arreglo de usuarios" });
  }

  const processRow = async ({ nombre, dpi, correo }: InvestorRow) => {
    if (!correo?.trim()) {
      throw new Error("Sin correo, omitido");
    }

    const email = correo.trim().toLowerCase();
    const cleanDpi = dpi?.replaceAll(" ", "") ?? dpi;
    const password = randomBytes(8).toString("hex");

    try {
      const created = await auth.api.signUpEmail({
        body: { name: nombre, email, password },
      });

      await db
        .update(users)
        .set({ role: "INVESTOR", dpi: cleanDpi })
        .where(eq(users.id, created.user.id));

      return { correo: email, nombre, dpi: cleanDpi, password, status: "creado" };
    } catch (signUpError) {
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, email));

      if (!existing) throw signUpError;

      const ctx = await auth.$context;
      const hashedPassword = await ctx.password.hash(password);

      await Promise.all([
        db
          .update(users)
          .set({ role: "INVESTOR", dpi: cleanDpi })
          .where(eq(users.id, existing.id)),
        db
          .update(accounts)
          .set({ password: hashedPassword })
          .where(and(eq(accounts.userId, existing.id), eq(accounts.providerId, "credential"))),
      ]);

      return { correo: email, nombre, dpi: cleanDpi, password, status: "actualizado" };
    }
  };

  // Procesar en lotes de 5 para no saturar el pool de conexiones
  const BATCH_SIZE = 5;
  const allSettled: PromiseSettledResult<Awaited<ReturnType<typeof processRow>>>[] = [];

  for (let i = 0; i < body.length; i += BATCH_SIZE) {
    const batch = body.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map(processRow));
    allSettled.push(...batchResults);
  }

  const results = allSettled;

  const success: object[] = [];
  const errors: object[] = [];

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      success.push(result.value);
    } else {
      const { correo, nombre, dpi } = body[i];
      const err = result.reason;
      errors.push({
        correo: correo?.trim() ?? null,
        nombre,
        dpi,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return c.json({
    total: body.length,
    exitosos: success.length,
    fallidos: errors.length,
    success,
    errors,
  });
});

export default unifiedRoutes;
