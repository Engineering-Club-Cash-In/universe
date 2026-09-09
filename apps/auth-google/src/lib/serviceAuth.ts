/**
 * Autenticación servicio-a-servicio por secreto compartido.
 *
 * Se usa en endpoints operativos/internos que no pertenecen a un usuario final
 * y por lo tanto no pueden validarse con una sesión de Better Auth.
 *
 * El contrato es el mismo que ya usa el resto del monorepo para llamadas entre
 * servicios: `Authorization: Bearer <secreto>`.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

/**
 * Compara el secreto recibido contra el configurado en tiempo constante.
 *
 * Ambos valores se reducen a un digest SHA-256 antes de compararlos: así el
 * buffer que entra a `timingSafeEqual` siempre mide lo mismo (32 bytes), de
 * modo que secretos de distinta longitud se comparan igual que los de la misma
 * y la función nunca lanza por diferencia de tamaño.
 *
 * Devuelve `false` si el secreto esperado no está configurado (fail closed):
 * un entorno sin la variable definida no habilita el paso, lo cierra.
 */
export function secretsMatch(
  provided: string | undefined | null,
  expected: string | undefined | null,
): boolean {
  const providedValue = provided?.trim() ?? "";
  const expectedValue = expected?.trim() ?? "";

  if (providedValue.length === 0 || expectedValue.length === 0) {
    return false;
  }

  const providedDigest = createHash("sha256").update(providedValue, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expectedValue, "utf8").digest();

  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Devuelve el token de un header `Authorization: Bearer <token>`,
 * o `null` si el header falta, usa otro esquema o viene vacío.
 */
export function extractBearerToken(
  authorizationHeader: string | undefined | null,
): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, ...rest] = authorizationHeader.trim().split(/\s+/);

  if (!scheme || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  const token = rest.join(" ").trim();

  return token.length > 0 ? token : null;
}

/**
 * Middleware de Hono que exige el secreto compartido del servicio.
 *
 * `getExpectedSecret` se resuelve por petición para que el middleware pueda
 * montarse antes de que el proceso termine de cargar su configuración.
 *
 * Responde 401 tanto si el secreto no coincide como si el servicio no lo tiene
 * configurado; la distinción se deja en el log del servidor para no revelar al
 * cliente el estado de configuración del entorno.
 */
export const requireServiceSecret = (
  getExpectedSecret: () => string | undefined,
  routeLabel: string,
) => {
  return async (c: Context, next: () => Promise<void>) => {
    const expected = getExpectedSecret();

    if (!expected?.trim()) {
      console.error(
        `[ERROR] ${routeLabel}: INTERNAL_API_SECRET no está configurado; se rechaza la petición.`,
      );
      return c.json(
        { success: false, error: "No autorizado" },
        401,
      );
    }

    const provided = extractBearerToken(c.req.header("Authorization"));

    if (!secretsMatch(provided, expected)) {
      console.warn(`[WARN] ${routeLabel}: secreto de servicio inválido.`);
      return c.json(
        { success: false, error: "No autorizado" },
        401,
      );
    }

    await next();
  };
};
