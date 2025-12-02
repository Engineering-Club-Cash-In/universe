import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/connection";
import * as schema from "../db/schema";
import { env } from "../config/env";
import { sendPasswordResetEmail } from "../services/email.service";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      account: schema.accounts,
      session: schema.sessions,
      verification: schema.verificationTokens,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Cambiar a true si quieres verificación
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      // Log para debug - ver estructura de la URL
      console.log("🔗 Reset password URL from Better Auth:", url);
      
      // Better Auth envía la URL completa del backend, extraemos el token
      // La URL viene como: http://localhost:3000/api/auth/reset-password/TOKEN
      // O puede venir con query params
      let token: string | null = null;
      
      try {
        const urlObj = new URL(url);
        // Primero intentar obtener de query params
        token = urlObj.searchParams.get("token");
        
        // Si no hay token en query params, puede estar en el path
        if (!token) {
          const pathParts = urlObj.pathname.split("/");
          token = pathParts[pathParts.length - 1];
        }
      } catch {
        // Si la URL no es válida, usar directamente
        token = url;
      }
      
      console.log("🎫 Extracted token:", token);
      
      const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;
      console.log("📧 Final reset URL:", resetUrl);
      
      await sendPasswordResetEmail(user.email, resetUrl);
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "CLIENT",
        input: false, // No permitir que el usuario lo establezca directamente
      },
    },
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      enabled: true,
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 días
    updateAge: 60 * 60 * 24, // 1 día
    // Deshabilitar cookieCache temporalmente para debug
    // El problema es que cookieCache devuelve null cuando no puede validar
    cookieCache: {
      enabled: false,
    },
  },
  advanced: {
    cookiePrefix: "better-auth",
    crossSubDomainCookies: {
      enabled: false,
    },
    useSecureCookies: env.NODE_ENV === "production",
    cookies: {
      sameSite: env.NODE_ENV === "production" ? "strict" : "lax",
    },
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.CORS_ORIGIN, env.BETTER_AUTH_URL],
});

export type Auth = typeof auth;
