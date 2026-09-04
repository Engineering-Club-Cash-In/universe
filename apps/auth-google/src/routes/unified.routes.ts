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
  claimDpi,
  releaseDpiClaim,
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
// RUTAS PÚBLICAS (sin auth)
// ============================================
//
// Ya no hay ninguna. `POST /register-external` se retiró: era una ruta sin
// sesión que llamaba al CRM con el secreto de servicio usando el correo y el
// DPI que mandara quien fuera. Como `createPortalRegisterLead` devuelve el lead
// COMPLETO cuando coincide el correo O el DPI, y esta ruta reenviaba esa
// respuesta tal cual, cualquiera en internet podía sacar la ficha de un lead
// con solo conocer uno de los dos datos —y, si ese lead tenía el correo vacío,
// provocar que el CRM le escribiera el suyo encima.
//
// No tenía ningún consumidor: el registro del portal pasa por
// `/register-external-auth`, que saca el correo de la sesión. El único
// llamador en el código era una rama de `CompleteProfileForm` (`onlyApi`) que
// nunca se activaba, retirada junto con la ruta.

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

    // El DPI se RESERVA —escribiéndolo— antes de cualquier efecto externo.
    //
    // El orden importa por dos motivos. Uno: la cuenta de Better Auth ya existe
    // cuando se llega aquí, y `applyRegistrationOutcome` (que es donde vivía la
    // única comprobación de DPI duplicado) corre DESPUÉS del alta en
    // CRM/cartera, así que un DPI ya tomado dejaba el correo ocupado por una
    // cuenta sin identidad y un registro externo ya creado. Dos: un `SELECT` de
    // comprobación no excluye nada — dos registros simultáneos con el mismo DPI
    // libre lo pasaban los dos y el perdedor reventaba al final contra la
    // restricción única con un 500 genérico. La exclusión la da el índice
    // único, y para eso hay que escribir.
    //
    // Esto no reabre el oráculo de DPIs que se eliminó: ocurre dentro de la
    // operación autenticada, contra el usuario de la sesión, y no como una ruta
    // que cualquiera pueda consultar.
    const claim = await claimDpi(user.id, dpi);

    // El correo sale SIEMPRE de la sesión: es la identidad de la cuenta sobre
    // la que se van a escribir rol y DPI, así que no puede venir del body.
    const payload: RegisterExternalUserPayload = {
      userType: body.userType,
      fullName: body.fullName || user.name || "",
      email: user.email || "",
      dpi,
      phone: body.phone,
    };

    try {
      // `usuarioPortalId` hace reintentable este flujo: el alta sella la fila
      // de cartera con la cuenta de la sesión, y si un intento anterior ya la
      // creó pero no llegó a escribir el DPI/rol del portal, el reintento
      // reconoce ESA fila por el sello —no por parecerse a lo que se pidió— y
      // termina la identidad en vez de quedarse en un 409 permanente. Solo
      // aquí: la ruta pública no manda id y por tanto no reconcilia nada.
      const result = await registerExternalUser(payload, {
        usuarioPortalId: user.id,
      });

      // El rol se escribe aquí, en el servidor, y solo después de que el
      // registro externo salió bien. El cliente ya no puede fijarlo.
      // `applyRegistrationOutcome` no asigna roles fuera de los de autoservicio
      // ni pisa un rol administrativo. El DPI ya quedó puesto por la reserva.
      const identity = await applyRegistrationOutcome(
        user.id,
        payload.userType,
        payload.dpi,
      );

      return c.json({ ...result, identity });
    } catch (error) {
      // El registro no llegó a completarse: se suelta la reserva para no dejar
      // el DPI bloqueado por un alta que nunca ocurrió. Solo se libera lo que
      // reservó ESTA petición; si la cuenta ya lo traía, se respeta.
      await releaseDpiClaim(user.id, claim);

      throw error;
    }
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

    // El DPI se valida y se normaliza ANTES de crear nada.
    //
    // Antes solo se le quitaban los espacios, así que una fila con el DPI vacío
    // o mal escrito creaba igual la cuenta como INVESTOR con ese valor
    // inservible. Y la corrección después no servía: el chequeo de correo de
    // abajo marcaba la fila "omitido" para siempre, así que el importador ya no
    // podía terminar a ese inversionista.
    //
    // `normalizeDpi` es el mismo criterio que usa el registro: acepta
    // separadores y devuelve los 13 dígitos. Sin él, la importación guardaba en
    // `users.dpi` una cadena distinta de la que usa el resto del sistema.
    const cleanDpi = normalizeDpi(dpi);

    if (!cleanDpi) {
      return {
        correo: email,
        nombre,
        dpi,
        status: "omitido" as const,
        motivo:
          "El DPI no tiene 13 dígitos; se omite para no crear una cuenta que la importación ya no podría corregir.",
      };
    }

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

    // Que el DPI esté libre se comprueba ANTES del alta.
    //
    // `users.dpi` es único y no viaja en el alta de Better Auth, así que el
    // orden anterior (crear y después escribir el DPI) reventaba el update
    // contra la restricción y dejaba una cuenta huérfana: CLIENT, sin DPI y
    // con una contraseña aleatoria que nadie conoce. Peor todavía, el chequeo
    // de correo de arriba marcaba todo reintento como "omitido", así que el
    // importador no podía terminar nunca a ese inversionista.
    const [dpiTomado] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.dpi, cleanDpi));

    if (dpiTomado) {
      return {
        correo: email,
        nombre,
        dpi: cleanDpi,
        status: "omitido" as const,
        motivo:
          "El DPI ya pertenece a otra cuenta; se omite para no crear una cuenta a medias.",
      };
    }

    // Credencial aleatoria que no se comunica a nadie: el titular la define
    // con el flujo de recuperación de contraseña.
    const password = randomBytes(32).toString("hex");

    const created = await auth.api.signUpEmail({
      body: { name: nombre, email, password },
    });

    // La comprobación de arriba cierra el caso secuencial, pero no la carrera:
    // dos filas del mismo lote con el mismo DPI la pasan las dos y una pierde
    // contra la restricción única. Si eso ocurre se deshace el alta, porque una
    // cuenta a medias bloquea el reintento para siempre. `accounts` y
    // `sessions` cuelgan de `users.id` con ON DELETE CASCADE, así que borrar la
    // fila del usuario limpia también lo que creó Better Auth.
    try {
      await db
        .update(users)
        .set({ role: "INVESTOR", dpi: cleanDpi })
        .where(eq(users.id, created.user.id));
    } catch (error) {
      try {
        await db.delete(users).where(eq(users.id, created.user.id));
      } catch (errorDeLimpieza) {
        console.error(
          `[ERROR] bulk-import-investors: no se pudo deshacer la cuenta ${email} tras fallar la escritura del DPI. Queda una cuenta incompleta que hay que borrar a mano.`,
          errorDeLimpieza,
        );

        throw new Error(
          `No se pudo asignar el DPI y la cuenta quedó creada e incompleta; hay que borrarla a mano: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      throw new Error(
        `No se pudo asignar el DPI; el alta se deshizo y la fila se puede reintentar: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

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
