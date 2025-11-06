import dotenv from "dotenv";

dotenv.config();

export interface EnvConfig {
  DATABASE_URL: string;
  PORT: number;
  NODE_ENV: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  CORS_ORIGIN: string;
}

function validateEnv(): EnvConfig {
  const requiredVars = [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
  ];

  const missing = requiredVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    throw new Error(
      `❌ Missing required environment variables: ${missing.join(", ")}\n` +
        `Please check your .env file and ensure all required variables are set.`
    );
  }

  // Validaciones adicionales
  const port = parseInt(process.env.PORT || "3000", 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`❌ Invalid PORT value: ${process.env.PORT}`);
  }

  // Validar URL de base de datos
  const dbUrl = process.env.DATABASE_URL!;
  if (!dbUrl.startsWith("postgresql://")) {
    throw new Error(
      `❌ Invalid DATABASE_URL: must start with 'postgresql://'`
    );
  }

  return {
    DATABASE_URL: dbUrl,
    PORT: port,
    NODE_ENV: process.env.NODE_ENV || "development",
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL:
      process.env.BETTER_AUTH_URL || "http://localhost:3000",
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
    CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",
  };
}

// Validar y exportar configuración
export const env = validateEnv();

// Log de configuración (sin secretos)
console.log("✅ Environment variables validated successfully");
console.log(`📋 Configuration:`);
console.log(`   - NODE_ENV: ${env.NODE_ENV}`);
console.log(`   - PORT: ${env.PORT}`);
console.log(`   - BETTER_AUTH_URL: ${env.BETTER_AUTH_URL}`);
console.log(`   - CORS_ORIGIN: ${env.CORS_ORIGIN}`);
console.log(
  `   - DATABASE_URL: ${env.DATABASE_URL.substring(0, 20)}...`
);
