import { Elysia } from "elysia";
import jwt from "jsonwebtoken";
import { db } from "../database";
import { audit_logs } from "../database/db";

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

const METHODS_TO_LOG = ["POST", "PUT", "PATCH", "DELETE"];
const MAX_BODY_CHARS = 4000;
const MAX_RESPONSE_CHARS = 4000;

// Claves cuyo valor no queremos guardar en texto plano
const SENSITIVE_KEYS = new Set([
  "password",
  "pass",
  "contrasena",
  "contraseña",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
]);

const sanitize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "***" : sanitize(v);
    }
    return out;
  }
  return value;
};

const toBodyString = (body: unknown, query: unknown, params: unknown): string | null => {
  const hasBody = body !== undefined && body !== null && !(typeof body === "object" && Object.keys(body as object).length === 0);
  const hasQuery = query && typeof query === "object" && Object.keys(query as object).length > 0;
  const hasParams = params && typeof params === "object" && Object.keys(params as object).length > 0;

  if (!hasBody && !hasQuery && !hasParams) return null;

  const payload: Record<string, unknown> = {};
  if (hasBody) payload.body = sanitize(body);
  if (hasQuery) payload.query = sanitize(query);
  if (hasParams) payload.params = sanitize(params);

  try {
    const str = JSON.stringify(payload);
    return str.length > MAX_BODY_CHARS ? str.substring(0, MAX_BODY_CHARS) + "...[truncated]" : str;
  } catch {
    return "[unserializable]";
  }
};

const toResponseString = (response: unknown): string | null => {
  if (response === undefined || response === null) return null;

  let str: string;
  if (typeof response === "string") {
    str = response;
  } else if (response instanceof Response) {
    // Stream ya consumido; no podemos leerlo aquí
    return null;
  } else {
    try {
      str = JSON.stringify(sanitize(response));
    } catch {
      return "[unserializable]";
    }
  }

  return str.length > MAX_RESPONSE_CHARS
    ? str.substring(0, MAX_RESPONSE_CHARS) + "...[truncated]"
    : str;
};

export const auditLogMiddleware = (app: Elysia) =>
  app.onAfterResponse(async (ctx) => {
    try {
      const { request, set, body, query, params, response } = ctx as any;
      const method = request.method.toUpperCase();

      if (!METHODS_TO_LOG.includes(method)) return;

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

      const bodyStr = toBodyString(body, query, params);
      const responseStr = toResponseString(response);

      db.insert(audit_logs)
        .values({
          user_id: userId,
          user_email: userEmail,
          method,
          path,
          status_code: (set as any).status ?? 200,
          body: bodyStr,
          response: responseStr,
        })
        .then(() => {})
        .catch((err) => {
          console.error("⚠️ Error guardando audit log:", err.message);
        });
    } catch {
      // Nunca romper la respuesta por un log
    }
  });
