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
import { sigueConLaPasswordQueLeDimos } from "../lib/passwordProvisionada";

export type AuthedVariables = {
  // `role`, `dpi` y `passwordProvisionadaAt` son los `additionalFields` de
  // Better Auth (ver lib/auth.ts). Los tres con `input: false`: los escribe el
  // servidor, no el cliente.
  user: {
    id: string;
    email?: string;
    name?: string;
    role?: string;
    dpi?: string | null;
    passwordProvisionadaAt?: string | Date | null;
  };
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

  const user = session.user as AuthedVariables["user"];

  // La pantalla de primer ingreso del portal es una cortesía, no una puerta:
  // vive en el cliente y se salta con un `curl`. Quien entre con la contraseña
  // que le mandamos por correo no puede seguir usándola contra los datos
  // —cartera, CRM, perfil— solo por no pasar por esa pantalla.
  //
  // Cerrar aquí alcanza para las tres superficies: `/api/cartera/*`,
  // `/api/crm/*` y `/api/profile/*` usan este mismo middleware. Lo que hace
  // falta para SALIR de este estado no pasa por aquí: cambiar la contraseña
  // (`/api/auth/change-password`), pedir un enlace, y cerrar sesión viven bajo
  // `/api/auth/*`, que es de Better Auth y no lleva este middleware.
  if (sigueConLaPasswordQueLeDimos(user)) {
    throw new HTTPException(403, {
      message:
        "Tenés que elegir tu propia contraseña antes de seguir usando el portal.",
    });
  }

  c.set("user", user);
  c.set("session", session.session);

  await next();
};
