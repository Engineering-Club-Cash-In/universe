import { betterAuth } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
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
  antesDeCambiarPassword,
  cuerpoForzadoDelCambio,
  despuesDeCambiarPassword,
} from "./hooksDePassword";
import { exigirPasswordPropia } from "./puertaDeBetterAuth";
import {
  credencialCoincide,
  exigirPasswordDistintaALaActual,
  type PruebaDeIdentidad,
} from "./passwordDistinta";
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
 * Largos de contraseña, en una sola constante.
 *
 * La usan Better Auth y el hook `before`, y tienen que ser LA MISMA: ese hook
 * borra los enlaces de recuperación antes de que Better Auth mire la contraseña
 * nueva, así que si los límites se separaran, una contraseña que uno acepta y
 * el otro rechaza le costaría a alguien todos sus enlaces sin cambiar nada.
 */
const LARGO_PASSWORD = { min: 8, max: 128 } as const;

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
    minPasswordLength: LARGO_PASSWORD.min,
    maxPasswordLength: LARGO_PASSWORD.max,
    resetPasswordTokenExpiresIn: VIGENCIA_ENLACE_RESET_SEGUNDOS,
    // Cambiar la contraseña cierra las sesiones abiertas. Quien la cambia
    // porque cree que alguien más la tenía, espera exactamente esto.
    revokeSessionsOnPasswordReset: true,
    /**
     * La cuenta deja de estar marcada como "todavía usa la contraseña que le
     * generamos". Los enlaces hermanos de ESTE camino ya se cerraron antes del
     * cambio, en el hook `before`, donde el token vigente ya había probado
     * identidad: hacerlo aquí dejaba una ventana que no se podía cerrar.
     */
    onPasswordReset: async ({ user }) => {
      // Segunda pasada de borrado, igual que el `after` del cambio en sesión.
      //
      // El `before` ya borró los hermanos, pero entre ese DELETE y el UPDATE de
      // la contraseña cabe un enlace nuevo: si alguien pide recuperación justo
      // ahí, ese token no estaba entre las filas borradas y sobrevive sus 24
      // horas para pisar la contraseña que se acaba de elegir. Corriendo acá,
      // ese enlace ya existe cuando se borra.
      //
      // El token que se canjeó lo borra Better Auth antes de llamar a este
      // hook, así que no hay ninguno que preservar.
      try {
        await exigirInvalidacionDeEnlaces(user.id);
      } catch (error) {
        // La contraseña YA cambió: tirar acá haría que la persona reintente con
        // una que ya no es la suya. Queda en el log.
        console.error(
          "[password] la contraseña se restableció pero quedaron enlaces sin invalidar.",
          error,
        );
      }

      await registrarPasswordPropia(user.id, "enlace");
    },
    sendResetPassword: async ({ user, url }) => {
      // NADA de esto se loguea. El token ES la credencial: quien lo tenga puede
      // cambiar la contraseña de esa cuenta sin saber la anterior, y con la
      // vigencia en 24 horas el que quedó escrito en el log de producción sirve
      // durante todo un día. Aquí había tres `console.log` —la URL de Better
      // Auth, el token suelto y la URL final— así que cualquiera con acceso a
      // los logs agregados podía entrar a cualquier cuenta del portal.
      //
      // Better Auth manda la URL de su propio endpoint
      // (`.../api/auth/reset-password/TOKEN`, a veces con el token en query), y
      // de ahí se extrae para armar la del portal.
      let token: string | null = null;

      try {
        const urlObj = new URL(url);
        token = urlObj.searchParams.get("token");

        if (!token) {
          const pathParts = urlObj.pathname.split("/");
          token = pathParts[pathParts.length - 1];
        }
      } catch {
        // Si la URL no es válida, usar directamente
        token = url;
      }

      const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;
      
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
     * Lo que tiene que ser cierto ANTES de que una contraseña cambie.
     *
     * El reparto entre este hook y el de abajo —y por qué no es el mismo para
     * el camino del enlace que para el de la sesión— vive en
     * `hooksDePassword.ts`, que es donde se puede probar. Acá solo se desenvuelve
     * el `ctx` de Better Auth y se le enchufan los efectos de verdad.
     */
    before: createAuthMiddleware(async (ctx) => {
      // PRIMERO la puerta, y sobre TODOS los endpoints de Better Auth.
      //
      // `requireAuth` cierra las superficies de datos, pero `/api/auth/*` no lo
      // lleva: ahí Better Auth atiende con sus propios endpoints autenticados, y
      // uno de ellos —`/link-social`— engancha una identidad de Google a la
      // cuenta. Esa es la que sobrevive al cambio de contraseña y a la
      // revocación de sesiones, así que quien tuviera la contraseña del correo
      // se quedaba dentro para siempre. El porqué de cada ruta permitida está
      // en `puertaDeBetterAuth.ts`.
      await exigirPasswordPropia(ctx.path, {
        cuentaDeLaSesion: async () => {
          const usuario = (await getSessionFromCtx(ctx))?.user;
          if (!usuario) return null;

          // Se copia SOLO la marca: es el único dato que decide esto, y pasar
          // el usuario entero ataría la puerta a la forma que Better Auth le dé
          // a su sesión en la versión que toque.
          return { passwordProvisionadaAt: usuario.passwordProvisionadaAt };
        },
      });

      await antesDeCambiarPassword(
        {
          path: ctx.path,
          nueva: ctx.body?.newPassword,
          actual: ctx.body?.currentPassword,
          token: ctx.body?.token ?? ctx.query?.token,
          limites: LARGO_PASSWORD,
        },
        {
          usuarioDeLaSesion: async () => {
            const sesion = await getSessionFromCtx(ctx);
            return sesion?.user?.id ?? null;
          },
          usuarioDelEnlaceVigente: async (token) => {
            const fila = await ctx.context.internalAdapter.findVerificationValue(
              `reset-password:${token}`,
            );
            return tokenDeResetVigente(fila) ? fila!.value : null;
          },
          exigirDistinta: (userId, nueva, prueba) =>
            exigirPasswordDistintaALaActual(ctx, userId, nueva, prueba),
          invalidarEnlaces: exigirInvalidacionDeEnlaces,
          credencialProbada: (userId, actual) =>
            credencialCoincide(ctx, userId, actual),
          invalidarTodosLosEnlaces: (userId) =>
            exigirInvalidacionDeEnlaces(userId),
        },
      );

      // Cerrar las otras sesiones deja de depender de que el cliente lo pida.
      // El porqué está en `cuerpoForzadoDelCambio`; en resumen: la marca de
      // primer ingreso se limpia porque el cambio salió bien, así que si la
      // revocación no ocurre, la sesión abierta con la contraseña que mandamos
      // por correo sobrevive Y además pasa las puertas.
      //
      // Devolver `{ context }` es la forma que tiene Better Auth de dejar que
      // un hook `before` modifique la petición: lo funde con el contexto real
      // (`to-auth-endpoints.mjs`) y el endpoint lee ya el cuerpo corregido.
      const forzado = cuerpoForzadoDelCambio(ctx.path);
      if (forzado) return { context: { body: forzado } };
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
      await despuesDeCambiarPassword(ctx.path, ctx.context.returned, {
        invalidarEnlaces: (userId) => exigirInvalidacionDeEnlaces(userId),
        registrarPasswordPropia: (userId) =>
          registrarPasswordPropia(userId, "cambio_en_sesion"),
      });
    }),
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // Better Auth compara por igualdad exacta (sin partir por comas), así que
  // recibe la lista ya interpretada y no la variable cruda.
  trustedOrigins: env.TRUSTED_ORIGINS,
});

export type Auth = typeof auth;
