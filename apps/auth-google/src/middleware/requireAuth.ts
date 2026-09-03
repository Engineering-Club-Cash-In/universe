/**
 * Middleware de sesión de Better Auth.
 *
 * Deja en el contexto el usuario y la sesión ya validados, para que los
 * handlers trabajen siempre contra la identidad de la sesión y no contra un
 * identificador recibido en la petición.
 */

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { auth } from "../lib/auth";

export type AuthedVariables = {
  user: { id: string; email?: string; name?: string; role?: string };
  session: any;
};

export const requireAuth = async (
  c: Context<{ Variables: AuthedVariables }>,
  next: () => Promise<void>,
) => {
  let session: { user?: unknown; session?: unknown } | null = null;

  try {
    session = (await auth.api.getSession({
      headers: c.req.raw.headers,
    })) as { user?: unknown; session?: unknown } | null;
  } catch {
    throw new HTTPException(401, { message: "Token inválido o expirado" });
  }

  if (!session?.user) {
    throw new HTTPException(401, { message: "No autorizado. Inicia sesión." });
  }

  c.set("user", session.user as AuthedVariables["user"]);
  c.set("session", session.session);

  await next();
};
