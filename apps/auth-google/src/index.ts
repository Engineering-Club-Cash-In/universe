import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { testConnection } from "./db/connection";
import { asegurarColumnasRequeridas } from "./db/columnasRequeridas";
import authRoutes from "./routes/auth.routes";
import healthRoutes from "./routes/health.routes";
import passwordRoutes from "./routes/password.routes";
import profileRoutes from "./routes/profile.routes";
import carteraRoutes from "./routes/cartera.routes";
import crmRoutes from "./routes/crm.routes";
import unifiedRoutes from "./routes/unified.routes";
import internalRoutes from "./routes/internal.routes";
import { errorHandler, notFoundHandler } from "./middleware/error";
import {
  COOKIE_AUTHENTICATED_PREFIXES,
  requireTrustedOrigin,
} from "./middleware/requireTrustedOrigin";
import {
  apiLimiter,
  authLimiter,
  signUpLimiter,
} from "./middleware/rateLimiter";
import { resolveCorsOrigin } from "./lib/origins";
import { env } from "./config/env";

const app = new Hono();

// Middlewares
app.use("*", logger());
app.use(
  "*",
  cors({
    // `Access-Control-Allow-Origin` admite UN origen o `*`, nunca una lista:
    // hay que devolver el origen de esta petición, no la variable entera.
    // Devolver `null` hace que Hono omita la cabecera, que es el cierre
    // correcto. En desarrollo se permite cualquier origen (localhost, túneles).
    origin: (origin) =>
      resolveCorsOrigin({
        origin,
        trustedOrigins: env.TRUSTED_ORIGINS,
        allowAnyOrigin: env.NODE_ENV === "development",
      }),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization", "Cookie", "Set-Cookie"],
    exposeHeaders: ["Set-Cookie"],
  })
);

// Rate limiting
app.use("/api/*", apiLimiter);

// Anti-CSRF: la cookie de sesión es SameSite=None en producción, así que el
// navegador la adjunta también en peticiones nacidas en un sitio ajeno. Toda
// escritura que llegue con esa cookie debe traer un Origin de confianza.
// `/api/auth/*` no se lista: Better Auth ya valida el origen por su cuenta.
for (const ruta of COOKIE_AUTHENTICATED_PREFIXES) {
  app.use(ruta, requireTrustedOrigin);
}

// Routes
app.route("/health", healthRoutes);

// Apply specific rate limiters to auth routes
app.use("/api/auth/sign-in/*", authLimiter);
app.use("/api/auth/sign-up/*", signUpLimiter);
app.route("/api/auth", authRoutes);

// Profile routes
app.route("/api/profile", profileRoutes);

// Estado de un enlace de recuperación (sin sesión: quien lo abre no la tiene)
app.route("/api/password", passwordRoutes);

// Cartera routes (proxy a la API de cartera)
app.route("/api/cartera", carteraRoutes);

// CRM routes (proxy a la API del CRM)
app.route("/api/crm", crmRoutes);

// Unified routes (operaciones que involucran CRM + Cartera)
app.route("/api/unified", unifiedRoutes);

// Rutas internas servicio-a-servicio (cartera-back → auth-google).
// Montadas FUERA de /api/* a propósito: ahí se aplica apiLimiter (100 req /
// 15 min por IP y path) y cartera-back sale por una sola IP, así que un
// backfill o un import masivo se estrellarían contra su propio límite.
// La puerta es el secreto compartido del middleware, no el rate limit.
app.route("/internal", internalRoutes);

// 404 handler
app.notFound(notFoundHandler);

// Error handler
app.onError(errorHandler);

// El esquema se prepara UNA vez y ninguna petición se atiende antes.
//
// Bun levanta el servidor en cuanto termina de evaluar este módulo, así que
// dejar esto en un `.then()` suelto lo dejaba corriendo mientras Coolify ya
// daba la instancia por lista y le mandaba peticiones de sesión: justo las que
// necesitan la columna que este paso está creando. El handler espera esta
// promesa; después de la primera vez ya está resuelta y no cuesta nada.
const esquemaListo = asegurarColumnasRequeridas();

// Verificar conexión a la base de datos al iniciar
testConnection().then((connected) => {
  if (connected) {
    console.log(`
╔═══════════════════════════════════════════════╗
║   🚀 Auth Google Service Running              ║
║   📡 Port: ${env.PORT}                              ║
║   🌍 Environment: ${env.NODE_ENV}            ║
║   🔐 Better Auth: Enabled                     ║
║   🗄️  Database: Connected                      ║
║   🛡️  Rate Limiting: Enabled                   ║
║   💰 Cartera API: Enabled                     ║
║   📋 CRM API: Enabled                         ║
║   ⚡ Hono + Bun Server: Active                 ║
╚═══════════════════════════════════════════════╝
    `);
  } else {
    console.error("Failed to connect to database. Exiting...");
    process.exit(1);
  }
});

// Exportar app - Bun detecta esto y levanta el servidor automáticamente
export default {
  port: env.PORT,
  fetch: async (request: Request) => {
    await esquemaListo;
    return app.fetch(request);
  },
};
