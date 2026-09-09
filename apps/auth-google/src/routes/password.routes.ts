/**
 * Lo que la pantalla de recuperación necesita saber ANTES de pedir una
 * contraseña nueva.
 *
 * Sin esto, un enlace muerto —usado, vencido, o invalidado porque la persona ya
 * cambió su contraseña con otro— se ve idéntico a uno bueno: el formulario
 * abre, se escribe la contraseña dos veces, se envía, y recién el error dice
 * que el enlace no servía. Con esto, la pantalla lo dice al abrirse y ofrece
 * pedir uno nuevo.
 *
 * Público a propósito: quien abre el enlace no tiene sesión, que es justo el
 * caso. No revela nada que `POST /api/auth/reset-password` no revele ya.
 */

import { Hono } from "hono";
import { enlaceDeResetSigueVivo } from "../services/password/passwordPropia";

const passwordRoutes = new Hono();

/**
 * GET /api/password/enlace?token=...
 * → { valido: boolean }
 */
passwordRoutes.get("/enlace", async (c) => {
  const token = c.req.query("token") ?? "";

  const valido = await enlaceDeResetSigueVivo(token);

  return c.json({ success: true, data: { valido } });
});

export default passwordRoutes;
