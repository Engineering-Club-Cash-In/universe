import dotenv from "dotenv";

import { parseOriginList } from "../lib/origins";

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
  // Frontend URL for password reset
  FRONTEND_URL: string;
  // Orígenes de navegador en los que confía el servicio, ya canonizados y sin
  // repetir. Es la ÚNICA lista: la consumen el CORS global, los
  // `trustedOrigins` de Better Auth y la defensa anti-CSRF. `CORS_ORIGIN`
  // admite varios dominios separados por comas para desplegar el portal en más
  // de uno; las otras dos variables aportan su propio origen.
  TRUSTED_ORIGINS: string[];
  // Cartera API Config
  CARTERA_API_URL: string;
  CARTERA_USER: string;
  CARTERA_PASSWORD: string;
  // CRM API Config
  CRM_API_URL: string;
  // Secreto compartido con el CRM para los endpoints /api/portal/*.
  // Debe tener el MISMO valor que BETTER_SECRET_PORTAL_WEB en el CRM.
  CRM_PORTAL_SECRET: string;
  // Secreto compartido para endpoints internos servicio-a-servicio.
  // Opcional al arrancar (no queremos tumbar el login si falta), pero los
  // endpoints que lo exigen rechazan cuando viene vacío.
  INTERNAL_API_SECRET: string;
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
  const port = parseInt(process.env.PORT || "9500", 10);
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

  // Orígenes de confianza: se interpretan UNA vez aquí para que las tres capas
  // que los usan no puedan divergir. Un valor sin esquema (`portal.cci.com`)
  // tumba el arranque a propósito: el fallo silencioso equivalente era un CORS
  // roto en el navegador, sin un solo log del lado servidor que lo explicara.
  const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";
  const frontendUrl =
    process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "http://localhost:5173";
  const betterAuthUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

  const trustedOrigins: string[] = [];
  const origenesInvalidos: string[] = [];

  for (const [nombre, valor] of [
    ["CORS_ORIGIN", corsOrigin],
    ["FRONTEND_URL", frontendUrl],
    ["BETTER_AUTH_URL", betterAuthUrl],
  ] as const) {
    const { origenes, invalidos } = parseOriginList(valor);

    for (const invalido of invalidos) {
      origenesInvalidos.push(`${nombre}="${invalido}"`);
    }

    for (const origen of origenes) {
      if (!trustedOrigins.includes(origen)) {
        trustedOrigins.push(origen);
      }
    }
  }

  if (origenesInvalidos.length > 0) {
    throw new Error(
      `❌ Origen inválido en ${origenesInvalidos.join(", ")}: se espera ` +
        `esquema://host[:puerto] (varios se separan con comas).`
    );
  }

  return {
    DATABASE_URL: dbUrl,
    PORT: port,
    NODE_ENV: process.env.NODE_ENV || "development",
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: betterAuthUrl,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
    CORS_ORIGIN: corsOrigin,
    // Frontend
    FRONTEND_URL: frontendUrl,
    TRUSTED_ORIGINS: trustedOrigins,
    // Cartera API
    CARTERA_API_URL: process.env.CARTERA_API_URL || "http://localhost:5000",
    CARTERA_USER: process.env.CARTERA_USER || "",
    CARTERA_PASSWORD: process.env.CARTERA_PASSWORD || "",
    // CRM API
    CRM_API_URL: process.env.CRM_API_URL || "http://localhost:4000",
    // Sin default: si no viene, el CRM rechaza las llamadas al portal.
    CRM_PORTAL_SECRET: process.env.CRM_PORTAL_SECRET || "",
    // Sin default: si no viene, los endpoints internos rechazan todo.
    INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET || "",
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
console.log(`   - TRUSTED_ORIGINS: ${env.TRUSTED_ORIGINS.join(", ")}`);
console.log(
  `   - DATABASE_URL: ${env.DATABASE_URL.substring(0, 20)}...`
);

// Aviso temprano para operaciones: sin este secreto los endpoints internos
// quedan cerrados (fail closed) y el import masivo responde 401.
if (!env.INTERNAL_API_SECRET) {
  console.warn(
    "⚠️  INTERNAL_API_SECRET no está configurado: los endpoints internos rechazarán todas las peticiones."
  );
}

// Sin este secreto el CRM responde 401 a /api/portal/*, y el portal se queda
// sin perfil, documentos, contratos ni registro de leads.
if (!env.CRM_PORTAL_SECRET) {
  console.warn(
    "⚠️  CRM_PORTAL_SECRET no está configurado: el CRM rechazará las llamadas del portal."
  );
}
