import rateLimit from "express-rate-limit";

// Rate limiter para endpoints de autenticación
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 intentos
  message: {
    success: false,
    error: {
      message:
        "Demasiados intentos de inicio de sesión, intenta de nuevo más tarde",
      code: "RATE_LIMIT_EXCEEDED",
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip successful requests
  skipSuccessfulRequests: false,
  // Skip failed requests
  skipFailedRequests: false,
});

// Rate limiter general para API
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests
  message: {
    success: false,
    error: {
      message: "Demasiadas solicitudes, intenta de nuevo más tarde",
      code: "RATE_LIMIT_EXCEEDED",
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter más estricto para registro
export const signUpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // 3 registros por hora por IP
  message: {
    success: false,
    error: {
      message:
        "Demasiados intentos de registro, intenta de nuevo en una hora",
      code: "SIGNUP_RATE_LIMIT_EXCEEDED",
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
