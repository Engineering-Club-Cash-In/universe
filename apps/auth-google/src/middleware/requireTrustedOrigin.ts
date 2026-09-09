/**
 * Defensa anti-CSRF para las rutas que se autentican con la cookie de sesión.
 *
 * En producción la cookie de sesión es `SameSite=None` (ver `lib/auth.ts`:
 * el portal y este servicio viven en dominios distintos), así que el navegador
 * la adjunta también en peticiones que nacen en un sitio ajeno. El CORS global
 * no cierra ese hueco: solo impide LEER la respuesta, no impide que la
 * mutación ocurra. Y basta con un POST "simple" —`text/plain`, o directamente
 * sin `Content-Type`— para que no haya preflight: el cuerpo sigue siendo JSON
 * válido y `c.req.json()` lo parsea igual.
 *
 * La regla es: si la petición trae la cookie de sesión y muta estado, su
 * `Origin` tiene que estar en la lista de confianza. Los navegadores mandan
 * `Origin` en TODA petición que no sea GET/HEAD, así que exigirlo no rompe al
 * cliente legítimo; que falte es señal de que quien llama no es el portal.
 *
 * EXCEPCIÓN: con `NODE_ENV=development` se acepta cualquier origen
 * (`allowAnyOrigin`), replicando la política laxa del CORS local para no
 * obligar a declarar cada puerto de Vite ni cada túnel. En desarrollo, por
 * tanto, esta defensa NO está activa; la protección real es la de producción,
 * donde el flag nunca se enciende.
 */

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { env } from "../config/env";
import { hasSessionCookie } from "../lib/portalCookies";

/** Métodos que por definición no mutan estado. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Rutas montadas en `index.ts` que se autorizan con la cookie de sesión.
 *
 * `/api/auth/*` queda fuera a propósito: Better Auth ya valida el origen
 * contra sus `trustedOrigins` en sus propios handlers.
 */
export const COOKIE_AUTHENTICATED_PREFIXES = [
  "/api/profile/*",
  "/api/cartera/*",
  "/api/crm/*",
  "/api/unified/*",
] as const;

/**
 * Reduce un origen a su forma canónica (`esquema://host[:puerto]`) para poder
 * compararlo. Devuelve `null` para lo que no sea un origen real: ausente,
 * vacío o el literal `"null"` que mandan los iframes en sandbox y los
 * documentos `data:`.
 */
export function normalizeOrigin(
  origin: string | null | undefined,
): string | null {
  if (typeof origin !== "string") {
    return null;
  }

  const trimmed = origin.trim();

  if (!trimmed || trimmed === "null") {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

/**
 * Orígenes de confianza declarados por entorno. `CORS_ORIGIN` admite una lista
 * separada por comas para desplegar el portal en varios dominios.
 */
export function resolveTrustedOrigins(): string[] {
  const candidatos = [env.CORS_ORIGIN, env.FRONTEND_URL, env.BETTER_AUTH_URL]
    .flatMap((valor) => (valor ? valor.split(",") : []))
    .map((valor) => normalizeOrigin(valor))
    .filter((valor): valor is string => valor !== null);

  return [...new Set(candidatos)];
}

export type OriginDecision = "allow" | "deny";

/**
 * Decide si una petición puede mutar estado. Se separa del middleware para
 * poder ejercitar la regla sin levantar servidor ni entorno.
 */
export function evaluateOriginPolicy(params: {
  method: string;
  origin: string | null | undefined;
  cookieHeader: string | null | undefined;
  trustedOrigins: readonly string[];
  /** Solo en desarrollo, replicando la política laxa del CORS local. */
  allowAnyOrigin?: boolean;
}): OriginDecision {
  const { method, origin, cookieHeader, trustedOrigins, allowAnyOrigin } =
    params;

  if (SAFE_METHODS.has(method.toUpperCase())) {
    return "allow";
  }

  // Sin cookie no hay credencial ambiental que un tercero pueda aprovechar:
  // aquí caen las llamadas servicio-a-servicio, que se autorizan con cabecera.
  if (!hasSessionCookie(cookieHeader)) {
    return "allow";
  }

  if (allowAnyOrigin) {
    return "allow";
  }

  const solicitado = normalizeOrigin(origin);

  // Fail closed: un navegador SIEMPRE manda Origin en un POST.
  if (!solicitado) {
    return "deny";
  }

  return trustedOrigins.includes(solicitado) ? "allow" : "deny";
}

/**
 * Middleware Hono que aplica la política anterior.
 */
export const requireTrustedOrigin = async (
  c: Context,
  next: () => Promise<void>,
) => {
  const decision = evaluateOriginPolicy({
    method: c.req.method,
    origin: c.req.header("origin"),
    cookieHeader: c.req.header("cookie"),
    trustedOrigins: resolveTrustedOrigins(),
    allowAnyOrigin: env.NODE_ENV === "development",
  });

  if (decision === "deny") {
    throw new HTTPException(403, {
      message: "Origen no permitido para esta operación",
    });
  }

  await next();
};
