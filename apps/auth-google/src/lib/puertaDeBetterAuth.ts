import { APIError } from "better-auth/api";
import { RUTA_CAMBIO_DE_PASSWORD } from "./cambioDePassword";
import { RUTA_RESET_DE_PASSWORD } from "./hooksDePassword";
import {
  sigueConLaPasswordQueLeDimos,
  type CuentaConMarcaDePassword,
} from "./passwordProvisionada";

/**
 * Qué puede hacer con Better Auth quien todavía usa la contraseña que le
 * mandamos por correo.
 *
 * POR QUÉ NO ALCANZABA CON `requireAuth`
 * --------------------------------------
 * Ese middleware cierra las tres superficies de datos —`/api/cartera/*`,
 * `/api/crm/*`, `/api/profile/*`— pero `/api/auth/*` no lo lleva: ahí
 * `auth.routes.ts` le pasa la petición entera a Better Auth, y Better Auth trae
 * sus propios endpoints autenticados. Entre ellos `/link-social`, que ENGANCHA
 * una identidad de Google a la cuenta.
 *
 * Y ese es el que convierte una contraseña filtrada en acceso permanente.
 * Quien tenga el correo que mandamos —reenviado, impreso, en una bandeja
 * compartida— entra, engancha su propio Google y se va. Cuando el dueño
 * legítimo elige por fin su contraseña, se le cierran las sesiones y se le
 * limpia la marca, pero la cuenta de Google enganchada SIGUE AHÍ: no la borra
 * el cambio de contraseña ni la revocación de sesiones. El otro vuelve a entrar
 * cuando quiera, y ya no hay contraseña que cambiar para echarlo.
 *
 * POR QUÉ LISTA DE PERMITIDAS Y NO DE PROHIBIDAS
 * ---------------------------------------------
 * Porque la lista de endpoints de Better Auth crece con cada versión suya, y
 * una prohibida que se quede corta no avisa: simplemente deja pasar el
 * siguiente `/link-social` que inventen. Lo que NO crece es lo que esta persona
 * necesita poder hacer mientras está en este estado, que son cinco cosas
 * contadas. Se nombran, y todo lo demás espera a que elija su contraseña.
 */

/**
 * Lo único que se puede hacer con la contraseña que le dimos: enterarse del
 * estado, salir de él, o irse.
 *
 * - `/get-session`: es lo que le dice al portal que tiene que pedirle la
 *   contraseña. Cerrarlo dejaría a la pantalla de primer ingreso sin saber que
 *   le toca aparecer.
 * - `/change-password`: LA salida. Es la que usa esa pantalla.
 * - `/request-password-reset` y `/reset-password`: la otra salida, para quien
 *   ya no tiene a mano la contraseña del correo.
 * - `/sign-out`: irse siempre se puede.
 * - `/sign-in/email`: volver a entrar con la contraseña del correo tiene que
 *   seguir funcionando aunque el navegador todavía lleve la cookie del intento
 *   anterior. Cerrarlo encerraría a la persona fuera de su propia cuenta con la
 *   única credencial que tiene.
 * - `/ok` y `/error`: utilidades de Better Auth, no tocan nada.
 */
const RUTAS_PERMITIDAS = new Set([
  "/get-session",
  RUTA_CAMBIO_DE_PASSWORD,
  RUTA_RESET_DE_PASSWORD,
  "/request-password-reset",
  "/sign-out",
  "/sign-in/email",
  "/ok",
  "/error",
]);

/**
 * El canje del enlace llega como `/reset-password/:token` —plantilla en el
 * `ctx.path` de Better Auth, token de verdad en la URL— así que se acepta por
 * prefijo. Es el mismo endpoint de la lista, con el token en la ruta.
 */
export const rutaLibreConPasswordProvisionada = (path: string): boolean =>
  RUTAS_PERMITIDAS.has(path) || path.startsWith(`${RUTA_RESET_DE_PASSWORD}/`);

export interface EfectosDeLaPuerta {
  /** La cuenta de la sesión, o `null` si la petición no trae ninguna. */
  cuentaDeLaSesion: () => Promise<CuentaConMarcaDePassword | null>;
}

export const MENSAJE_PASSWORD_PROVISIONADA =
  "Tenés que elegir tu propia contraseña antes de seguir usando el portal.";

/**
 * Corre en el hook `before` de Better Auth, o sea sobre TODOS sus endpoints.
 *
 * Sin sesión no pregunta nada y no cuesta nada: `getSessionFromCtx` sale sin
 * tocar la base cuando no hay cookie, y guarda lo que encuentre en el contexto
 * de la petición, así que el endpoint que venga después no repite la consulta.
 */
export const exigirPasswordPropia = async (
  path: string,
  efectos: EfectosDeLaPuerta,
): Promise<void> => {
  if (rutaLibreConPasswordProvisionada(path)) return;

  const cuenta = await efectos.cuentaDeLaSesion();
  if (!sigueConLaPasswordQueLeDimos(cuenta)) return;

  throw new APIError("FORBIDDEN", { message: MENSAJE_PASSWORD_PROVISIONADA });
};
