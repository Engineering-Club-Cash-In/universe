/**
 * Rutas de perfil de la cuenta del portal.
 *
 * Todo el router exige sesión y la cuenta afectada sale SIEMPRE de esa sesión.
 * Aquí vivieron rutas `/:userId/...` que leían y escribían el perfil de
 * cualquiera con solo poner su id en la URL, y un `check-dpi/:dpi` público que
 * confirmaba si un DPI estaba registrado. Ninguna tenía consumidor (el portal
 * solo usa `/me/dpi`), así que se eliminaron en vez de protegerse: la
 * verificación de un DPI repetido la hace ya el propio registro, que responde
 * 409 al fijarlo sobre la cuenta.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireAuth, type AuthedVariables } from "../middleware/requireAuth";
import {
  DpiAlreadyTakenError,
  DpiFormatError,
  setUserDpi,
} from "../services/portalIdentity.service";

const profileRoutes = new Hono<{ Variables: AuthedVariables }>();

profileRoutes.use("*", requireAuth);

/**
 * POST /api/profile/me/dpi
 * Fija el DPI de la cuenta autenticada.
 *
 * El DPI dejó de aceptarse como campo de registro (`input: false`), así que
 * esta es la ruta por la que un usuario lo establece. La cuenta afectada sale
 * siempre de la sesión: el body solo trae el valor del DPI.
 */
profileRoutes.post("/me/dpi", async (c) => {
  const user = c.get("user");

  let body: { dpi?: unknown };
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Cuerpo de la petición inválido" });
  }

  if (typeof body.dpi !== "string") {
    throw new HTTPException(400, {
      message: "El campo dpi es requerido y debe ser un string",
    });
  }

  try {
    const dpi = await setUserDpi(user.id, body.dpi);

    return c.json({
      success: true,
      message: "DPI actualizado correctamente",
      data: { dpi },
    });
  } catch (error) {
    if (error instanceof DpiFormatError) {
      throw new HTTPException(400, { message: error.message });
    }

    if (error instanceof DpiAlreadyTakenError) {
      throw new HTTPException(409, { message: error.message });
    }

    throw new HTTPException(500, { message: "Error al actualizar el DPI" });
  }
});

export default profileRoutes;
