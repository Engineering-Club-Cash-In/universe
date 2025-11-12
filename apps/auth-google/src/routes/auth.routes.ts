import { Hono } from "hono";
import { auth } from "../lib/auth";

const authRoutes = new Hono();

// Proxy de todas las rutas de Better Auth
authRoutes.all("/*", async (c) => {
  try {
    console.log("🔵 Auth Route:", c.req.method, c.req.url);
    console.log("📨 Incoming cookies:", c.req.header("cookie"));

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

    // Procesar con Better Auth
    const authResponse = await auth.handler(authRequest);

    // Convertir Response de Better Auth a Response de Hono
    const responseBody = await authResponse.text();
    console.log("📦 Auth response body:", responseBody);
    console.log("📦 Auth response status:", authResponse.status);

    // Copiar headers incluyendo Set-Cookie
    const responseHeaders: Record<string, string> = {};
    authResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    console.log("🍪 Response cookies:", responseHeaders["set-cookie"]);
    console.log("📋 Content-Type:", responseHeaders["content-type"]);

    // Asegurar que el content-type sea application/json para respuestas JSON
    if (!responseHeaders["content-type"] && responseBody !== "") {
      responseHeaders["content-type"] = "application/json";
    }

    return c.text(responseBody, authResponse.status as any, responseHeaders);
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
