import { Hono } from "hono";
import { ProfileService } from "../services/profile.service";
import { HTTPException } from "hono/http-exception";

const profileRoutes = new Hono();

/**
 * GET /api/profile/:userId
 * Obtiene el perfil de un usuario
 */
profileRoutes.get("/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    if (!userId) {
      throw new HTTPException(400, { message: "userId es requerido" });
    }

    const profile = await ProfileService.getProfile(userId);

    if (!profile) {
      throw new HTTPException(404, { message: "Perfil no encontrado" });
    }

    return c.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    console.error("Error obteniendo perfil:", error);
    throw new HTTPException(500, {
      message: "Error al obtener el perfil",
    });
  }
});

/**
 * POST /api/profile/:userId/dpi
 * Actualiza el DPI del usuario
 */
profileRoutes.post("/:userId/dpi", async (c) => {
  try {
    const userId = c.req.param("userId");
    const body = await c.req.json();

    if (!userId) {
      throw new HTTPException(400, { message: "userId es requerido" });
    }

    if (!body.dpi || typeof body.dpi !== "string") {
      throw new HTTPException(400, {
        message: "El campo dpi es requerido y debe ser un string",
      });
    }

    // Validar formato DPI (13 dígitos)
    if (!/^\d{13}$/.test(body.dpi)) {
      throw new HTTPException(400, {
        message: "El DPI debe tener exactamente 13 dígitos",
      });
    }

    const profile = await ProfileService.updateDpi(userId, body.dpi);

    return c.json({
      success: true,
      message: "DPI actualizado correctamente",
      data: profile,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    console.error("Error actualizando DPI:", error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al actualizar el DPI",
    });
  }
});

/**
 * POST /api/profile/:userId/phone
 * Actualiza el teléfono del usuario
 */
profileRoutes.post("/:userId/phone", async (c) => {
  try {
    const userId = c.req.param("userId");
    const body = await c.req.json();

    if (!userId) {
      throw new HTTPException(400, { message: "userId es requerido" });
    }

    if (!body.phone || typeof body.phone !== "string") {
      throw new HTTPException(400, {
        message: "El campo phone es requerido y debe ser un string",
      });
    }

    // Validar formato teléfono (8 dígitos para Guatemala)
    if (!/^\d{8}$/.test(body.phone)) {
      throw new HTTPException(400, {
        message: "El teléfono debe tener exactamente 8 dígitos",
      });
    }

    const profile = await ProfileService.updatePhone(userId, body.phone);

    return c.json({
      success: true,
      message: "Teléfono actualizado correctamente",
      data: profile,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    console.error("Error actualizando teléfono:", error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al actualizar el teléfono",
    });
  }
});

/**
 * POST /api/profile/:userId/address
 * Actualiza la dirección del usuario
 */
profileRoutes.post("/:userId/address", async (c) => {
  try {
    const userId = c.req.param("userId");
    const body = await c.req.json();

    if (!userId) {
      throw new HTTPException(400, { message: "userId es requerido" });
    }

    if (!body.address || typeof body.address !== "string") {
      throw new HTTPException(400, {
        message: "El campo address es requerido y debe ser un string",
      });
    }

    // Validar longitud mínima
    if (body.address.length < 10) {
      throw new HTTPException(400, {
        message: "La dirección debe tener al menos 10 caracteres",
      });
    }

    const profile = await ProfileService.updateAddress(userId, body.address);

    return c.json({
      success: true,
      message: "Dirección actualizada correctamente",
      data: profile,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    console.error("Error actualizando dirección:", error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : "Error al actualizar la dirección",
    });
  }
});

export default profileRoutes;
