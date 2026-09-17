import { Context, Next } from "hono";

interface RateLimitConfig {
  namespace: string;
  windowMs: number;
  max: number;
  message: string;
  code: string;
  /**
   * Solo cuentan las respuestas con error (>= 400).
   *
   * Es la diferencia entre "cuántas veces te podés equivocar" y "cuántas veces
   * podés entrar". Un límite que cuenta los logins exitosos deja afuera a quien
   * hace todo bien.
   */
  soloFallos?: boolean;
}

// Store para rate limiting (en memoria)
// En producción, usar Redis
const store = new Map<string, { count: number; resetTime: number }>();

/**
 * La IP que Traefik entrega en `x-forwarded-for`.
 *
 * El origen del servicio es Traefik directo, no Cloudflare. Traefik sobrescribe
 * `x-forwarded-for`; aceptar antes `cf-connecting-ip` o `x-real-ip` dejaría que
 * el cliente eligiera su propia cubeta con una cabecera arbitraria.
 *
 * Devuelve `null` cuando ninguna cabecera dice quién llamó. Ese caso NO se
 * limita a propósito: la llave compartida `"unknown"` no es un rate limit, es
 * un interruptor que apaga el login de todo el portal en cuanto el proxy deja
 * de mandar la cabecera. El control de acceso es la contraseña, no esto.
 */
function ipDelCliente(c: Context): string | null {
  const reenviada = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (reenviada) return reenviada;

  return null;
}

export function createRateLimiter(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    // En desarrollo, no aplicar rate limiting
    if ((process.env.NODE_ENV ?? "development") === "development") {
      await next();
      return;
    }

    const ip = ipDelCliente(c);
    if (!ip) {
      await next();
      return;
    }

    const key = `${config.namespace}:${ip}`;
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

    // Reserva antes de ejecutar el handler para que solicitudes concurrentes no
    // crucen juntas el límite. Los éxitos liberan su reserva; los fallos la dejan.
    record.count++;
    await next();
    if (c.res.status < 400) record.count--;
  };
}

// Rate limiter para endpoints de autenticación.
//
// Cuenta SOLO los intentos fallidos por IP y ruta. Los éxitos no consumen ni
// borran intentos, así que otra cuenta no puede reiniciar la ventana.
export const authLimiter = createRateLimiter({
  namespace: "auth",
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  message: "Demasiados intentos de inicio de sesión, intenta de nuevo más tarde",
  code: "RATE_LIMIT_EXCEEDED",
  soloFallos: true,
});

// Rate limiter general para API.
//
// Varias personas pueden compartir IP pública y el portal consulta sesión con
// frecuencia. El número sigue siendo un tope contra un bucle desbocado.
export const apiLimiter = createRateLimiter({
  namespace: "api",
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 600,
  message: "Demasiadas solicitudes, intenta de nuevo más tarde",
  code: "RATE_LIMIT_EXCEEDED",
});

// Rate limiter más estricto para registro.
//
// Aquí sí cuentan los registros exitosos: crear cuentas en masa ES el abuso.
export const signUpLimiter = createRateLimiter({
  namespace: "sign-up",
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
