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
import { tokenDeResetVigente } from "./tokenDeReset";
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

/**
 * Se niega a poner como contraseña nueva la que ya está puesta.
 *
 * Better Auth no lo comprueba en ninguno de los dos caminos, y con la marca de
 * primer ingreso eso deja de ser un no-op inocente: `/change-password` con la
 * MISMA contraseña temporal en los dos campos respondía 200, y ese 200 limpiaba
 * la marca. La credencial que viajó por correo seguía siendo la buena y encima
 * ya no había candado. La comprobación del formulario no cuenta: se salta con
 * una petición directa.
 *
 * Se compara contra el hash guardado y no contra `currentPassword`, y eso cubre
 * los dos caminos con una sola regla: el del enlace ni siquiera manda la
 * contraseña actual.
 */
const exigirPasswordDistintaALaActual = async (
  ctx: {
    context: {
      internalAdapter: {
        findAccounts: (userId: string) => Promise<
          { providerId: string; password?: string | null }[]
        >;
      };
      password: {
        verify: (params: { hash: string; password: string }) => Promise<boolean>;
      };
    };
  },
  userId: string,
  nueva: string,
): Promise<void> => {
  const cuentas = await ctx.context.internalAdapter.findAccounts(userId);
  const credencial = cuentas.find(
    (cuenta) => cuenta.providerId === "credential" && cuenta.password,
  );

  // Sin cuenta de credenciales no hay contraseña que repetir: es alguien que
  // entra por Google y el reset se la va a crear.
  if (!credencial?.password) return;

  const esLaMisma = await ctx.context.password.verify({
    hash: credencial.password,
    password: nueva,
  });

  if (!esLaMisma) return;

  throw new APIError("BAD_REQUEST", {
    message:
      "La contraseña nueva tiene que ser distinta de la que estás usando.",
  });
};

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
     * Todo lo que tiene que ser cierto ANTES de que una contraseña cambie.
     *
     * Los dos caminos —el enlace del correo y el cambio con la sesión abierta—
     * pasan por aquí, y las dos comprobaciones van antes y no después por la
     * misma razón: después el cambio ya ocurrió y no hay vuelta atrás.
     *
     * 1. La contraseña nueva tiene que ser DISTINTA de la actual. Better Auth
     *    no lo comprueba, así que `/change-password` aceptaba la misma
     *    contraseña en los dos campos y respondía 200. Eso bastaba para que se
     *    limpiara la marca de primer ingreso sin que la credencial hubiera
     *    cambiado: quien tuviera la contraseña que mandamos por correo se
     *    quitaba el candado de encima y seguía usándola. La regla existía solo
     *    en el Yup del formulario, que es un `curl` de distancia.
     * 2. Los enlaces de recuperación pendientes mueren. Better Auth borra el
     *    token que se USA, pero no los otros que esa persona tenga vivos, y con
     *    24 horas de vigencia esa es una ventana real. Hacerlo después dejaba
     *    el caso sin salida: si el DELETE falla, la contraseña ya cambió.
     */
    before: createAuthMiddleware(async (ctx) => {
      const esReset = ctx.path === "/reset-password";
      const esCambio = ctx.path === RUTA_CAMBIO_DE_PASSWORD;
      if (!esReset && !esCambio) return;

      const nueva = ctx.body?.newPassword;
      // Que el cuerpo esté bien formado lo valida Better Auth; acá solo se sale
      // sin hacer nada para no adelantarse a su propio error.
      if (typeof nueva !== "string" || nueva === "") return;

      let userId: string | null = null;
      // El token que se está canjeando, para no borrarlo junto con los demás.
      let tokenEnUso: string | undefined;

      try {
        if (esReset) {
          const token = ctx.body?.token ?? ctx.query?.token;
          if (typeof token !== "string" || token === "") return;

          const fila = await ctx.context.internalAdapter.findVerificationValue(
            `reset-password:${token}`,
          );

          // Vigente, no solo existente: Better Auth deja las filas vencidas ahí
          // y las rechaza comparando la fecha. Sin este chequeo, mandar un
          // enlace viejo mataba el enlace NUEVO de esa persona y encima el
          // viejo se rechazaba igual, dejándola sin ninguno de los dos.
          if (!tokenDeResetVigente(fila)) return;

          userId = fila!.value;
          tokenEnUso = token;
        } else {
          const sesion = await getSessionFromCtx(ctx);
          // Sin sesión no hay a quién limpiarle nada: el endpoint responde 401.
          if (!sesion?.user?.id) return;

          userId = sesion.user.id;
        }

        await exigirPasswordDistintaALaActual(ctx, userId, nueva);
        await exigirInvalidacionDeEnlaces(userId, tokenEnUso);
      } catch (error) {
        // Un rechazo con causa —la contraseña repetida— viaja tal cual: es lo
        // único que la persona puede corregir sola.
        if (error instanceof APIError) throw error;

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
