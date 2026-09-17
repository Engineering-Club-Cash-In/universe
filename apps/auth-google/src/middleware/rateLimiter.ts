import { Context, Next } from "hono";
import { env } from "../config/env";

interface RateLimitConfig {
  windowMs: number;
  max: number;
  message: string;
  code: string;
  /**
   * Solo cuentan las respuestas con error (>= 400), y una respuesta buena
   * borra lo acumulado.
   *
   * Es la diferencia entre "cuántas veces te podés equivocar" y "cuántas veces
   * podés entrar". Un límite que cuenta los logins exitosos deja afuera a quien
   * hace todo bien —y en una oficina detrás de una sola IP pública, el quinto
   * que entra en 15 minutos tumba a todos los demás.
   */
  soloFallos?: boolean;
}

// Store para rate limiting (en memoria)
// En producción, usar Redis
const store = new Map<string, { count: number; resetTime: number }>();

/**
 * La IP de quien realmente hizo la petición, no la del último proxy.
 *
 * `x-forwarded-for` es una LISTA ("cliente, proxy1, proxy2") y la arma cada
 * salto; usar la cabecera cruda como llave hace que dos peticiones del mismo
 * cliente por caminos distintos caigan en cubetas distintas, y que todas las de
 * un proxy que solo se anuncia a sí mismo caigan en la misma.
 *
 * Devuelve `null` cuando ninguna cabecera dice quién llamó. Ese caso NO se
 * limita a propósito: la llave compartida `"unknown"` no es un rate limit, es
 * un interruptor que apaga el login de todo el portal en cuanto el proxy deja
 * de mandar la cabecera. El control de acceso es la contraseña, no esto.
 */
function ipDelCliente(c: Context): string | null {
  const cloudflare = c.req.header("cf-connecting-ip")?.trim();
  if (cloudflare) return cloudflare;

  const reenviada = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (reenviada) return reenviada;

  const real = c.req.header("x-real-ip")?.trim();
  if (real) return real;

  return null;
}

function createRateLimiter(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    // En desarrollo, no aplicar rate limiting
    if (env.NODE_ENV === "development") {
      await next();
      return;
    }

    const ip = ipDelCliente(c);
    if (!ip) {
      await next();
      return;
    }

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

    if (record.count >= config.max) {
      const faltan = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
      return c.json(
        {
          success: false,
          error: {
            message: config.message,
            code: config.code,
          },
        },
        429,
        {
          "Retry-After": faltan.toString(),
          "X-RateLimit-Limit": config.max.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": new Date(record.resetTime).toISOString(),
        }
      );
    }

    // Las cabeceras van ANTES de `next()`: después, la respuesta de Better Auth
    // ya está armada (a veces con el cuerpo en streaming) y tocarla para un dato
    // informativo no vale el riesgo en el camino del login.
    c.header("X-RateLimit-Limit", config.max.toString());
    c.header(
      "X-RateLimit-Remaining",
      Math.max(0, config.max - record.count - 1).toString()
    );
    c.header("X-RateLimit-Reset", new Date(record.resetTime).toISOString());

    if (!config.soloFallos) {
      record.count++;
      await next();
      return;
    }

    await next();

    if (c.res.status >= 400) {
      record.count++;
    } else {
      // Entró bien: el historial de tropiezos deja de contar. Sin esto, cinco
      // intentos repartidos a lo largo del día terminan cerrándole la puerta a
      // alguien que nunca falló dos veces seguidas.
      store.delete(key);
    }
  };
}

// Rate limiter para endpoints de autenticación.
//
// Cuenta SOLO los intentos fallidos: el que escribe bien su contraseña nunca se
// topa con esto, aunque comparta la IP con toda la oficina.
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  message: "Demasiados intentos de inicio de sesión, intenta de nuevo más tarde",
  code: "RATE_LIMIT_EXCEEDED",
  soloFallos: true,
});

// Rate limiter general para API.
//
// La llave incluye el path, pero varias personas pueden compartir IP pública y
// el portal consulta `/api/auth/get-session` en cada carga y cada foco de
// pestaña: con 100 por ventana, una oficina se quedaba sin sesión a media
// mañana. El número sigue siendo un tope contra un bucle desbocado.
export const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 600,
  message: "Demasiadas solicitudes, intenta de nuevo más tarde",
  code: "RATE_LIMIT_EXCEEDED",
});

// Rate limiter más estricto para registro.
//
// Aquí sí cuentan los registros exitosos: crear cuentas en masa ES el abuso.
export const signUpLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
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
