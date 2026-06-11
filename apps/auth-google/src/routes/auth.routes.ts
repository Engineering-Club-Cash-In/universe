import { Hono } from "hono";
import { auth } from "../lib/auth";

const authRoutes = new Hono();

// Proxy de todas las rutas de Better Auth
authRoutes.all("/*", async (c) => {
  try {
    const authResponse = await auth.handler(c.req.raw);

    // auth.handler devuelve una Response con headers INMUTABLES.
    // Si la retornamos directo, el middleware CORS de Hono no puede agregar
    // Access-Control-Allow-Origin y el browser bloquea la respuesta.
    //
    // Solución: crear una nueva Response con headers MUTABLES usando
    // new Headers() + .append() para preservar múltiples Set-Cookie.
    const newHeaders = new Headers();
    authResponse.headers.forEach((value, key) => {
      newHeaders.append(key, value);
    });

    return new Response(authResponse.body, {
      status: authResponse.status,
      headers: newHeaders,
    });
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
