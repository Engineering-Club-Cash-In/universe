import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto"; // ⚠️ ponelo en tu .env

export const authMiddleware = (app: any) =>
  app.onBeforeHandle(
    async (
      { request, set }: { request: Request; set: { status: number } },
      next: () => any
    ) => {
      try {
        const authHeader = request.headers.get("Authorization");

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          set.status = 401;
          return { success: false, error: "Token no proporcionado" };
        }

        // 🔑 Limpiamos el token por si trae espacios o saltos de línea
        const token = authHeader.replace("Bearer ", "").trim();

        // ✅ Verificar token
        const decoded = jwt.verify(token, JWT_SECRET);

        console.log("✅ Token decodificado:", decoded);

        // Guardamos info del usuario en la request
        (request as any).user = decoded;

        return   // continuar con la ruta
      } catch (err: any) {
        console.error(
          "❌ Error en jwt.verify:",
          err.name,
          "-",
          err.message
        );
        set.status = 401;
        return { success: false, error: err.message || "Token inválido o expirado" };
      }
    }
  );
