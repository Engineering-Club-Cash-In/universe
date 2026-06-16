import jwt from "jsonwebtoken";

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
