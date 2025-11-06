import express from "express";
import cors from "cors";
import { testConnection } from "./db/connection";
import authRoutes from "./routes/auth.routes";
import healthRoutes from "./routes/health.routes";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { apiLimiter, authLimiter, signUpLimiter } from "./middleware/rateLimiter";
import { env } from "./config/env";

const app = express();
const PORT = env.PORT;

// Middlewares
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
    exposedHeaders: ["Set-Cookie"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use("/api", apiLimiter);

// Logger middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use("/health", healthRoutes);

// Apply specific rate limiters to auth routes
app.use("/api/auth/sign-in", authLimiter);
app.use("/api/auth/sign-up", signUpLimiter);
app.use("/api/auth", authRoutes);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// Iniciar servidor
const startServer = async () => {
  try {
    // Verificar conexión a la base de datos
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.error("Failed to connect to database. Exiting...");
      process.exit(1);
    }

    // Iniciar servidor
    app.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════╗
║   🚀 Auth Google Service Running              ║
║   📡 Port: ${PORT}                              ║
║   🌍 Environment: ${env.NODE_ENV}            ║
║   🔐 Better Auth: Enabled                     ║
║   🗄️  Database: Connected                      ║
║   🛡️  Rate Limiting: Enabled                   ║
╚═══════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

export default app;
