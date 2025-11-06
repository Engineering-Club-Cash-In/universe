import { Context, Next } from "hono";

interface RateLimitConfig {
  windowMs: number;
  max: number;
  message: string;
  code: string;
}

// Store para rate limiting (en memoria)
// En producción, usar Redis
const store = new Map<string, { count: number; resetTime: number }>();

function createRateLimiter(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const key = `${ip}:${c.req.path}`;
    const now = Date.now();

    let record = store.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 0,
        resetTime: now + config.windowMs,
      };
      store.set(key, record);
    }

    record.count++;

    if (record.count > config.max) {
      return c.json(
        {
          success: false,
          error: {
            message: config.message,
            code: config.code,
          },
        },
        429
      );
    }

    // Set rate limit headers
    c.header("X-RateLimit-Limit", config.max.toString());
    c.header("X-RateLimit-Remaining", Math.max(0, config.max - record.count).toString());
    c.header("X-RateLimit-Reset", new Date(record.resetTime).toISOString());

    await next();
  };
}

// Rate limiter para endpoints de autenticación
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5,
  message: "Demasiados intentos de inicio de sesión, intenta de nuevo más tarde",
  code: "RATE_LIMIT_EXCEEDED",
});

// Rate limiter general para API
export const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  message: "Demasiadas solicitudes, intenta de nuevo más tarde",
  code: "RATE_LIMIT_EXCEEDED",
});

// Rate limiter más estricto para registro
export const signUpLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3,
  message: "Demasiados intentos de registro, intenta de nuevo en una hora",
  code: "SIGNUP_RATE_LIMIT_EXCEEDED",
});

// Limpieza periódica del store
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (now > record.resetTime) {
      store.delete(key);
    }
  }
}, 60 * 1000); // Cada minuto

