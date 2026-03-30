import { Elysia } from "elysia";
import jwt from "jsonwebtoken";
import { db } from "../database";
import { audit_logs } from "../database/db";

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

// Métodos que queremos logear (ignoramos GET para no llenar la tabla)
const METHODS_TO_LOG = ["POST", "PUT", "PATCH", "DELETE"];

export const auditLogMiddleware = (app: Elysia) =>
  app.onAfterResponse(async ({ request, set }) => {
    try {
      const method = request.method.toUpperCase();

      // Solo logear mutaciones
      if (!METHODS_TO_LOG.includes(method)) return;

      // Extraer usuario del JWT (sin bloquear si no hay token)
      let userId: number | null = null;
      let userEmail: string | null = null;

      try {
        const authHeader = request.headers.get("Authorization");
        if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.replace("Bearer ", "").trim();
          const decoded = jwt.verify(token, JWT_SECRET) as any;
          userId = decoded.id ?? decoded.user_id ?? null;
          userEmail = decoded.email ?? decoded.correo ?? null;
        }
      } catch {
        // Token inválido, logeamos sin usuario
      }

      const url = new URL(request.url);
      const path = url.pathname;

      // Leer body si existe (clonamos el request para no consumirlo)
      let bodyStr: string | null = null;
      try {
        const cloned = request.clone();
        const text = await cloned.text();
        if (text) {
          // Truncar a 2000 chars para no llenar la DB
          bodyStr = text.length > 2000 ? text.substring(0, 2000) + "..." : text;
        }
      } catch {
        // No se pudo leer el body
      }

      // Insert async, no bloqueamos nada
      db.insert(audit_logs)
        .values({
          user_id: userId,
          user_email: userEmail,
          method,
          path,
          status_code: (set as any).status ?? 200,
          body: bodyStr,
        })
        .then(() => {})
        .catch((err) => {
          console.error("⚠️ Error guardando audit log:", err.message);
        });
    } catch {
      // Nunca romper la respuesta por un log
    }
  });
