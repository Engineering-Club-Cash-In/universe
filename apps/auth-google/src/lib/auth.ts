import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/connection";
import * as schema from "../db/schema";
import { env } from "../config/env";
import { sendPasswordResetEmail } from "../services/email.service";
import { SESSION_COOKIE_PREFIX } from "./portalCookies";

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
      
      // El portal permite registrarse como CLIENT o INVESTOR, así que el
      // correo adapta su saludo al rol de la cuenta.
      const role = (user as { role?: string }).role;
      const normalizedRole =
        role === "INVESTOR" || role === "CLIENT" ? role : undefined;

      await sendPasswordResetEmail(user.email, resetUrl, normalizedRole);
    },
  },
  user: {
    additionalFields: {
      // `input: false` en ambos: ni el rol ni el DPI se aceptan desde el
      // cliente. El rol define privilegios, así que solo lo escribe el
      // servidor tras validar el registro (ver POST /api/unified/
      // register-external-auth). El DPI se fija con POST /api/profile/me/dpi,
      // que lo aplica siempre sobre la cuenta de la sesión.
      role: {
        type: "string",
        required: false,
        defaultValue: "CLIENT",
        input: false,
      },
      dpi: {
        type: "string",
        required: false,
        input: false,
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
    // Compartido con la defensa anti-CSRF, que necesita reconocer la cookie
    // de sesión para saber cuándo exigir un Origin de confianza.
    cookiePrefix: SESSION_COOKIE_PREFIX,
    crossSubDomainCookies: {
      enabled: false,
    },
    useSecureCookies: env.NODE_ENV === "production",
    cookies: {
      sameSite: env.NODE_ENV === "production" ? "none" : "lax" as const,
    },
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.CORS_ORIGIN, env.BETTER_AUTH_URL],
});

export type Auth = typeof auth;
