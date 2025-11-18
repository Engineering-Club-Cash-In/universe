import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

export const authMiddleware = (app: any) =>
  app.derive(async ({ request, set }: { request: any; set: any }) => {
    try {
      const authHeader = request.headers.get("Authorization");

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        set.status = 401;
        throw new Error("Token no proporcionado");
      }

      const token = authHeader.replace("Bearer ", "").trim();
      const decoded = jwt.verify(token, JWT_SECRET) as any;

      console.log("✅ Token decodificado:", decoded);

      // 🔑 Retornar el usuario para que esté disponible en el contexto
      return { user: decoded };
    } catch (err: any) {
      console.error("❌ Error en jwt.verify:", err.name, "-", err.message);
      set.status = 401;
      throw new Error(err.message || "Token inválido o expirado");
    }
  });