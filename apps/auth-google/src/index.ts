import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { testConnection } from "./db/connection";
import authRoutes from "./routes/auth.routes";
import healthRoutes from "./routes/health.routes";
import { errorHandler, notFoundHandler } from "./middleware/error";
import {
  apiLimiter,
  authLimiter,
  signUpLimiter,
} from "./middleware/rateLimiter";
import { env } from "./config/env";

const app = new Hono();

// Middlewares
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      // Permitir localhost en desarrollo
      if (env.NODE_ENV === "development") {
        return origin || "*";
      }
      return env.CORS_ORIGIN;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization", "Cookie", "Set-Cookie"],
    exposeHeaders: ["Set-Cookie"],
  })
);

// Rate limiting
app.use("/api/*", apiLimiter);

// Routes
app.route("/health", healthRoutes);

// Apply specific rate limiters to auth routes
app.use("/api/auth/sign-in/*", authLimiter);
app.use("/api/auth/sign-up/*", signUpLimiter);
app.route("/api/auth", authRoutes);

// 404 handler
app.notFound(notFoundHandler);

// Error handler
app.onError(errorHandler);

// Iniciar servidor
const startServer = async () => {
  try {
    // Verificar conexión a la base de datos
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.error("Failed to connect to database. Exiting...");
      process.exit(1);
    }

    // Iniciar servidor con Hono + Node.js adapter
    serve(
      {
        fetch: app.fetch,
        port: env.PORT,
      },
      (info) => {
        console.log(`
╔═══════════════════════════════════════════════╗
║   🚀 Auth Google Service Running              ║
║   📡 Port: ${info.port}                              ║
║   🌍 Environment: ${env.NODE_ENV}            ║
║   🔐 Better Auth: Enabled                     ║
║   🗄️  Database: Connected                      ║
║   🛡️  Rate Limiting: Enabled                   ║
║   ⚡ Hono Framework: Active                    ║
╚═══════════════════════════════════════════════╝
      `);
      }
    );
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

export default app;
