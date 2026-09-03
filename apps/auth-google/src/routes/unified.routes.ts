/**
 * Rutas unificadas para operaciones que involucran múltiples sistemas
 * (CRM + Cartera)
 */

import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { auth } from "../lib/auth";
import { requireServiceSecret } from "../lib/serviceAuth";
import { isPortalUserType, normalizeDpi } from "../lib/portalIdentity";
import {
  applyRegistrationOutcome,
  assertDpiAvailable,
  DpiAlreadyTakenError,
  DpiFormatError,
} from "../services/portalIdentity.service";
import { env } from "../config/env";
import { db } from "../db/connection";
import { users } from "../db/schema";
import {
  registerExternalUser,
  type RegisterExternalUserPayload,
} from "../services/unified";

// Tipo para el contexto con variables personalizadas
type Variables = {
  user: { id: string; name?: string; email?: string; role?: string };
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
    const user = c.get("user");

    // Validaciones. `isPortalUserType` acota a los roles de autoservicio: un
    // "ADMIN" en el body no pasa de aquí.
    if (!isPortalUserType(body.userType)) {
      throw new HTTPException(400, {
        message: "El campo userType es requerido y debe ser 'CLIENT' o 'INVESTOR'",
      });
    }

    if (!body.dpi) {
      throw new HTTPException(400, { message: "El campo dpi es requerido" });
    }

    // El DPI se normaliza ANTES de armar el payload y viaja normalizado a
    // todas partes. `normalizeDpi` acepta separadores ("1234-56789-0123"), así
    // que reenviar el valor crudo dejaba los dos sistemas con identificadores
    // distintos: cartera hace `parseInt` sobre esta cadena y habría registrado
    // el DPI 1234 mientras Better Auth guarda los 13 dígitos completos.
    const dpi = normalizeDpi(body.dpi);

    if (!dpi) {
      throw new HTTPException(400, {
        message: "El DPI debe tener exactamente 13 dígitos",
      });
    }

    // El DPI se reserva ANTES de cualquier efecto externo.
    //
    // El orden importa: la cuenta de Better Auth ya existe cuando se llega
    // aquí, y `applyRegistrationOutcome` (que es donde vivía la única
    // comprobación de DPI duplicado) corre DESPUÉS del alta en CRM/cartera. Con
    // ese orden, un DPI ya tomado dejaba el correo ocupado por una cuenta sin
    // identidad y, encima, un registro externo ya creado.
    //
    // Esto no reabre el oráculo de DPIs que se eliminó: la comprobación vive
    // dentro de la operación autenticada, contra el usuario de la sesión, y no
    // como una ruta que cualquiera pueda consultar.
    await assertDpiAvailable(user.id, dpi);

    // El correo sale SIEMPRE de la sesión: es la identidad de la cuenta sobre
    // la que se van a escribir rol y DPI, así que no puede venir del body.
    const payload: RegisterExternalUserPayload = {
      userType: body.userType,
      fullName: body.fullName || user.name || "",
      email: user.email || "",
      dpi,
      phone: body.phone,
    };

    const result = await registerExternalUser(payload);

    // El rol y el DPI se escriben aquí, en el servidor, y solo después de que
    // el registro externo salió bien. El cliente ya no puede fijarlos.
    // `applyRegistrationOutcome` no asigna roles fuera de los de autoservicio
    // ni pisa un rol administrativo.
    const identity = await applyRegistrationOutcome(
      user.id,
      payload.userType,
      payload.dpi,
    );

    return c.json({ ...result, identity });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    // El conflicto de DPI se contesta con un código que el formulario pueda
    // distinguir de un fallo cualquiera: es lo único que el titular puede
    // corregir por su cuenta.
    if (error instanceof DpiAlreadyTakenError) {
      return c.json({ message: error.message, error: "dpi_ya_registrado" }, 409);
    }

    if (error instanceof DpiFormatError) {
      return c.json({ message: error.message, error: "dpi_invalido" }, 400);
    }

    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al registrar usuario externo",
    });
  }
});

// ============================================
// BULK IMPORT (interno: requiere secreto de servicio)
// ============================================

/**
 * POST /api/unified/bulk-import-investors
 *
 * Alta masiva de inversionistas. No pertenece a ningún usuario final, así que
 * se protege con el secreto compartido de servicio en vez de una sesión.
 *
 * Reglas:
 * - Solo crea cuentas nuevas. Un correo que ya existe se omite, nunca se toca:
 *   reescribir la credencial de una cuenta existente sería un reseteo, no una
 *   importación, y esta ruta no es el lugar para hacerlo.
 * - La contraseña generada no se devuelve. La cuenta nace con una credencial
 *   aleatoria que nadie conoce y el titular la establece por "olvidé mi
 *   contraseña".
 */
unifiedRoutes.post(
  "/bulk-import-investors",
  requireServiceSecret(() => env.INTERNAL_API_SECRET, "POST /api/unified/bulk-import-investors"),
  async (c) => {
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

    // Una cuenta que ya existe se deja intacta y se reporta como omitida.
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));

    if (existing) {
      return {
        correo: email,
        nombre,
        dpi: cleanDpi,
        status: "omitido" as const,
        motivo: "La cuenta ya existe; no se modifica desde la importación.",
      };
    }

    // Credencial aleatoria que no se comunica a nadie: el titular la define
    // con el flujo de recuperación de contraseña.
    const password = randomBytes(32).toString("hex");

    const created = await auth.api.signUpEmail({
      body: { name: nombre, email, password },
    });

    await db
      .update(users)
      .set({ role: "INVESTOR", dpi: cleanDpi })
      .where(eq(users.id, created.user.id));

    return { correo: email, nombre, dpi: cleanDpi, status: "creado" as const };
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
  const omitidos: object[] = [];
  const errors: object[] = [];

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      if (result.value.status === "omitido") {
        omitidos.push(result.value);
      } else {
        success.push(result.value);
      }
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
    omitidos: omitidos.length,
    fallidos: errors.length,
    success,
    omitidosDetalle: omitidos,
    errors,
  });
});

export default unifiedRoutes;
