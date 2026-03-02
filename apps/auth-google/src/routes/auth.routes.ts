import { Hono } from "hono";
import { auth } from "../lib/auth";

const authRoutes = new Hono();

// Proxy de todas las rutas de Better Auth
authRoutes.all("/*", async (c) => {
  try {
    // Convertir los headers de Hono a objeto plano
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Asegurar que content-type esté presente para POST/PUT/PATCH
    if (
      !headers["content-type"] &&
      !["GET", "HEAD", "DELETE"].includes(c.req.method)
    ) {
      headers["content-type"] = "application/json";
    }

    // Construir la URL completa
    const url = new URL(c.req.url);

    // Preparar el body según el método HTTP
    let body: string | undefined = undefined;
    if (!["GET", "HEAD"].includes(c.req.method)) {
      const rawBody = await c.req.text();
      if (rawBody && rawBody.length > 0) {
        body = rawBody;
      }
    }

    // Crear Request compatible con Better Auth usando fetch API global
    const authRequest = new globalThis.Request(url.toString(), {
      method: c.req.method,
      headers: headers,
      body: body,
    });

    // Retornar la respuesta de Better Auth directamente para preservar
    // todos los Set-Cookie headers (session_token, dont_remember, etc.)
    // Reconstruir en Record<string,string> solo guarda el último Set-Cookie.
    return await auth.handler(authRequest);
  } catch (error) {
    console.error("Auth route error:", error);
    return c.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      },
      500
    );
  }
});

export default authRoutes;
