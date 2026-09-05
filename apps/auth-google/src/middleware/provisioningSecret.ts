import type { Context, Next } from "hono";
import { env } from "../config/env";
import {
  PROVISIONING_SECRET_HEADER,
  verificarSecretoProvisionamiento,
} from "../lib/provisioningSecret";

/**
 * Middleware de la puerta interna. La comparación vive en `lib/` para poder
 * probarla sin arrastrar la validación de entorno del servicio.
 */
export const provisioningSecretGuard = async (c: Context, next: Next) => {
  const resultado = verificarSecretoProvisionamiento(
    c.req.header(PROVISIONING_SECRET_HEADER),
    env.PORTAL_PROVISIONING_SECRET,
  );

  if (resultado === "no_configurado") {
    console.error(
      "[provisioning] PORTAL_PROVISIONING_SECRET no está configurado: el endpoint queda cerrado.",
    );
    return c.json(
      {
        error: "provisioning_no_configurado",
        message:
          "El servicio no tiene PORTAL_PROVISIONING_SECRET: no puede provisionar cuentas.",
      },
      503,
    );
  }

  if (resultado === "invalido") {
    return c.json({ error: "unauthorized" }, 401);
  }

  await next();
};
