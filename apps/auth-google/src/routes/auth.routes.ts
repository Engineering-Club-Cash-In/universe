import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { auth } from "../lib/auth";

const router = Router();

// Proxy de todas las rutas de Better Auth
router.all("/*", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Convertir los headers de Express a objeto plano
    const headers: Record<string, string> = {};
    Object.entries(req.headers).forEach(([key, value]) => {
      if (value) {
        headers[key] = Array.isArray(value) ? value[0] : value;
      }
    });

    // Asegurar que content-type esté presente para POST/PUT/PATCH
    if (!headers['content-type'] && !["GET", "HEAD", "DELETE"].includes(req.method)) {
      headers['content-type'] = 'application/json';
    }

    // Construir la URL completa incluyendo query params
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;

    // Preparar el body según el método HTTP
    let body: string | undefined = undefined;
    if (!["GET", "HEAD"].includes(req.method)) {
      // Si hay body, convertirlo a JSON string si es objeto
      if (req.body && Object.keys(req.body).length > 0) {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      }
    }

    // Crear Request compatible con Better Auth usando fetch API global
    const authRequest = new globalThis.Request(fullUrl, {
      method: req.method,
      headers: headers,
      body: body,
    });

    // Procesar con Better Auth
    const authResponse = await auth.handler(authRequest);

    // Convertir Response de Better Auth a Response de Express
    res.status(authResponse.status);
    
    // Copiar headers
    authResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Enviar body
    const responseBody = await authResponse.text();
    res.send(responseBody);
  } catch (error) {
    next(error);
  }
});

export default router;
