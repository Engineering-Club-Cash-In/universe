/**
 * Rutas de perfil de la cuenta del portal.
 *
 * Todo el router exige sesión y la cuenta afectada sale SIEMPRE de esa sesión.
 * Aquí vivieron rutas `/:userId/...` que leían y escribían el perfil de
 * cualquiera con solo poner su id en la URL, y un `check-dpi/:dpi` público que
 * confirmaba si un DPI estaba registrado —un oráculo de DPIs abierto a
 * internet—. Las `/:userId/...` no tenían consumidor; `check-dpi` sí: lo
 * llamaba `features/Login/hook/useRegister.ts` para avisar del DPI repetido
 * antes de enviar el formulario. Aun así se eliminaron en vez de protegerse,
 * porque esa verificación ya la hace el propio registro: fijar el DPI sobre la
 * cuenta responde 409, y ese 409 es el que el formulario muestra ahora.
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
