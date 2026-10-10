import jwt from "jsonwebtoken";
import { findSessionUser } from "../controllers/auth";

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

export const authMiddleware = (app: any) =>
  app.derive(async ({ request, set }: { request: any; set: any }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      set.status = 401;
      throw new Error("No has iniciado sesión. Vuelve a iniciar sesión.");
    }

    const token = authHeader.replace("Bearer ", "").trim();

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;

      console.log("✅ Token decodificado:", decoded);

      // 🔑 Retornar el usuario para que esté disponible en el contexto
      return { user: decoded };
    } catch (err: any) {
      // El detalle técnico queda solo en el log; al cliente siempre va un mensaje amigable
      console.error("❌ Error en jwt.verify:", err.name, "-", err.message);
      set.status = 401;
      throw new Error(
        err.name === "TokenExpiredError"
          ? "Tu sesión expiró. Vuelve a iniciar sesión."
          : "Tu sesión no es válida. Vuelve a iniciar sesión."
      );
    }
  });

export const NO_AUTORIZADO_ADMIN = {
  success: false as const,
  message: "[ERROR] No autorizado (requiere ADMIN)",
};
const SESION_NO_VALIDA = {
  success: false as const,
  message: "Tu sesión no es válida. Vuelve a iniciar sesión.",
};

/**
 * Gate de las rutas que administran usuarios (crear/editar, cambiar claves
 * ajenas, listar) y de los diagnósticos sensibles. Va DESPUÉS de
 * `authMiddleware`, que sólo valida la firma del JWT.
 *
 * 1. El rol del token debe ser ADMIN (403 si no) — sin tocar la base.
 * 2. Revalida contra platform_users: el ADMIN tiene que seguir existiendo,
 *    activo (401 si no: su sesión ya no vale) y con rol ADMIN (403 si se lo
 *    quitaron). Un token vivo de alguien desactivado no administra usuarios.
 *
 * Devuelve `null` si pasa, o el cuerpo de la respuesta de rechazo (con
 * `set.status` ya puesto) para hacer `return` directo desde el handler.
 */
export async function rechazoSiNoEsAdminActivo(
  user: any,
  set: any
): Promise<null | { success: false; message: string }> {
  if (!user || user.role !== "ADMIN") {
    set.status = 403;
    return NO_AUTORIZADO_ADMIN;
  }
  // Si la base falla, esto lanza y la ruta responde 500: falla CERRADO.
  const vigente = await findSessionUser(user.id);
  if (!vigente || !vigente.is_active) {
    set.status = 401;
    return SESION_NO_VALIDA;
  }
  if (vigente.role !== "ADMIN") {
    set.status = 403;
    return NO_AUTORIZADO_ADMIN;
  }
  return null;
}
