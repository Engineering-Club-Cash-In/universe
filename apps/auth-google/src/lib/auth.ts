import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/connection";
import * as schema from "../db/schema";
import { env } from "../config/env";
import { sendPasswordResetEmail } from "../services/email.service";
import {
  exigirInvalidacionDeEnlaces,
  registrarPasswordPropia,
} from "../services/password/passwordPropia";
import {
  RUTA_CAMBIO_DE_PASSWORD,
  usuarioQueCambioSuPassword,
} from "./cambioDePassword";
import { SESSION_COOKIE_PREFIX } from "./portalCookies";

/**
 * Cuánto vive un enlace de recuperación: 24 horas.
 *
 * Explícito y no el default de la librería (1 hora): la ventana en la que un
 * correo reenviado sigue sirviendo para entrar a una cuenta es una decisión, no
 * un detalle de implementación. Se eligieron 24 horas porque el enlace también
 * lo usa gente a la que le dimos de alta la cuenta y que abre el correo cuando
 * puede; una hora los dejaba afuera y los obligaba a pedir otro.
 *
 * Lo que hace que alargarlo no sea un problema es lo de abajo: cambiar la
 * contraseña invalida TODOS los enlaces pendientes, así que el enlace largo
 * solo vive mientras nadie lo haya usado.
 */
const VIGENCIA_ENLACE_RESET_SEGUNDOS = 60 * 60 * 24;

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
    resetPasswordTokenExpiresIn: VIGENCIA_ENLACE_RESET_SEGUNDOS,
    // Cambiar la contraseña cierra las sesiones abiertas. Quien la cambia
    // porque cree que alguien más la tenía, espera exactamente esto.
    revokeSessionsOnPasswordReset: true,
    /**
     * La cuenta deja de estar marcada como "todavía usa la contraseña que le
     * generamos". Los enlaces pendientes ya se cerraron ANTES del cambio, en el
     * hook `before`: hacerlo aquí dejaba una ventana que no se podía cerrar.
     */
    onPasswordReset: async ({ user }) => {
      await registrarPasswordPropia(user.id, "enlace");
    },
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
      // Viaja en la sesión para que el portal sepa, sin pedir nada más, que a
      // esta persona todavía hay que pedirle que elija su contraseña.
      // `input: false` como los otros dos: lo escribe el provisionamiento y lo
      // limpia el cambio de contraseña, nunca el cliente.
      passwordProvisionadaAt: {
        type: "date",
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
  hooks: {
    /**
     * Los enlaces de recuperación pendientes mueren ANTES de que la contraseña
     * cambie, no después.
     *
     * Better Auth borra el token que se USA, pero no los otros que esa persona
     * tenga vivos, y con 24 horas de vigencia esa es una ventana real: quien
     * tenga un correo viejo puede volver a cambiar la contraseña que se acaba
     * de elegir. Hacer la limpieza después dejaba el caso sin salida —si el
     * DELETE falla, la contraseña ya cambió y no hay vuelta atrás—, así que va
     * antes: si la base falla, esto tira, el cambio no llega a ocurrir y la
     * persona reintenta sobre un estado limpio.
     */
    before: createAuthMiddleware(async (ctx) => {
      try {
        if (ctx.path === "/reset-password") {
          const token = ctx.body?.token ?? ctx.query?.token;
          if (typeof token !== "string" || token === "") return;

          const fila = await ctx.context.internalAdapter.findVerificationValue(
            `reset-password:${token}`,
          );
          // Sin fila el token no sirve; que conteste Better Auth con su
          // INVALID_TOKEN de siempre en vez de inventar otro error aquí.
          if (!fila?.value) return;

          await exigirInvalidacionDeEnlaces(fila.value, token);
          return;
        }

        if (ctx.path === RUTA_CAMBIO_DE_PASSWORD) {
          const sesion = await getSessionFromCtx(ctx);
          // Sin sesión no hay a quién limpiarle nada: el endpoint responde 401.
          if (!sesion?.user?.id) return;

          await exigirInvalidacionDeEnlaces(sesion.user.id);
        }
      } catch (error) {
        console.error(
          "[password] no se pudieron invalidar los enlaces pendientes; se rechaza el cambio.",
          error,
        );

        throw new APIError("INTERNAL_SERVER_ERROR", {
          message:
            "No pudimos completar el cambio de contraseña. Intentá de nuevo en un momento.",
        });
      }
    }),
    /**
     * El equivalente de `onPasswordReset` para el otro camino.
     *
     * `/change-password` es el que usa la pantalla de primer ingreso, y Better
     * Auth no expone un hook propio para él. `hooks.after` corre para todos los
     * endpoints, así que la ruta y la forma de la respuesta se filtran en
     * `usuarioQueCambioSuPassword`, que es donde se puede probar.
     */
    after: createAuthMiddleware(async (ctx) => {
      const userId = usuarioQueCambioSuPassword(ctx.path, ctx.context.returned);
      if (!userId) return;

      await registrarPasswordPropia(userId, "cambio_en_sesion");
    }),
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // Better Auth compara por igualdad exacta (sin partir por comas), así que
  // recibe la lista ya interpretada y no la variable cruda.
  trustedOrigins: env.TRUSTED_ORIGINS,
});

export type Auth = typeof auth;
