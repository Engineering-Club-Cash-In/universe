import { APIError } from "better-auth/api";
import {
  RUTA_CAMBIO_DE_PASSWORD,
  usuarioQueCambioSuPassword,
} from "./cambioDePassword";
import type { PruebaDeIdentidad } from "./passwordDistinta";

/**
 * Qué se hace antes y qué se hace después de que una contraseña cambie.
 *
 * Vive aparte de `auth.ts` porque el reparto entre las dos fases ES la
 * decisión de seguridad, y ahí adentro no se puede probar: `auth.ts` construye
 * el Better Auth de verdad, con su base y su correo colgando.
 *
 * El reparto no es el mismo para los dos caminos, y la diferencia es de dónde
 * sale la prueba de identidad:
 *
 * - Camino del ENLACE. El token vigente ya probó quién es antes de tocar nada,
 *   así que el `before` puede trabajar. Y tiene que ser el `before`: si el
 *   DELETE de los enlaces hermanos falla, todavía se puede rechazar el cambio
 *   entero. Después ya no —la contraseña estaría cambiada y los enlaces viejos
 *   seguirían sirviendo sus 24 horas.
 *
 * - Camino de la SESIÓN. La cookie no prueba nada: quien manda
 *   `/change-password` es cualquiera que la tenga. Por eso el `before` borraba
 *   sin más y un intento fallido —un dedazo del dueño, o alguien con la sesión
 *   robada repitiéndolo— destruía enlaces de recuperación pendientes sin
 *   cambiar ninguna contraseña. La salida no era mudarlo al `after`: ahí el
 *   borrado ya no puede rechazar nada y un DELETE que falle deja 24 horas de
 *   enlaces vivos para pisar la contraseña recién elegida. La salida es
 *   PROBAR la credencial en el `before` —la misma verificación que Better Auth
 *   hará después— y borrar solo entonces.
 *
 * El `after` sigue borrando igual, y no es redundante: cubre la rendija entre
 * el DELETE y el cambio de contraseña, donde un enlace emitido en ese instante
 * no estaba entre las filas borradas. Ahí sí es best-effort, porque llegado ese
 * punto la contraseña ya cambió y tirar solo empeoraría las cosas.
 */

export const RUTA_RESET_DE_PASSWORD = "/reset-password";

/** Lo que el hook `before` necesita de la petición, ya desenvuelto del `ctx`. */
export interface PeticionDeCambio {
  path?: string;
  /** `newPassword`. Sin validar: de la forma del cuerpo se encarga Better Auth. */
  nueva: unknown;
  /** `currentPassword`. Solo existe en el camino de la sesión. */
  actual: unknown;
  /** El token del enlace. Solo existe en el camino del correo. */
  token: unknown;
}

export interface EfectosAntesDelCambio {
  /** El dueño de la sesión, o `null` si no hay: entonces contesta el 401. */
  usuarioDeLaSesion: () => Promise<string | null>;
  /** El dueño del enlace, solo si sigue VIGENTE. `null` si venció o no existe. */
  usuarioDelEnlaceVigente: (token: string) => Promise<string | null>;
  exigirDistinta: (
    userId: string,
    nueva: string,
    prueba: PruebaDeIdentidad,
  ) => Promise<void>;
  /**
   * Borra los enlaces hermanos, menos el que se está canjeando.
   *
   * El token es obligatorio y no opcional a propósito: este efecto ya solo lo
   * usa el camino del enlace. Pedirlo hace que llamarlo desde el camino de la
   * sesión —donde no hay ninguno— no compile.
   */
  invalidarEnlaces: (userId: string, tokenEnUso: string) => Promise<void>;
  /**
   * ¿La `currentPassword` que vino es de verdad la de esta cuenta?
   *
   * Es lo que le falta al camino de la sesión para poder trabajar en el
   * `before`. La cookie no prueba nada, pero esto sí, y es la MISMA
   * verificación que Better Auth hará unos milisegundos después.
   */
  credencialProbada: (userId: string, actual: unknown) => Promise<boolean>;
  /** Borra TODOS los enlaces pendientes. Solo el camino de la sesión. */
  invalidarTodosLosEnlaces: (userId: string) => Promise<void>;
}

export const antesDeCambiarPassword = async (
  peticion: PeticionDeCambio,
  efectos: EfectosAntesDelCambio,
): Promise<void> => {
  const esReset = peticion.path === RUTA_RESET_DE_PASSWORD;
  const esCambio = peticion.path === RUTA_CAMBIO_DE_PASSWORD;
  if (!esReset && !esCambio) return;

  // Que el cuerpo esté bien formado lo valida Better Auth; acá solo se sale sin
  // hacer nada para no adelantarse a su propio error.
  const nueva = peticion.nueva;
  if (typeof nueva !== "string" || nueva === "") return;

  try {
    if (esReset) {
      const token = peticion.token;
      if (typeof token !== "string" || token === "") return;

      // Vigente, no solo existente: Better Auth deja las filas vencidas ahí y
      // las rechaza comparando la fecha. Sin esto, mandar un enlace viejo
      // mataba el enlace NUEVO de esa persona y el viejo se rechazaba igual.
      const userId = await efectos.usuarioDelEnlaceVigente(token);
      if (!userId) return;

      await efectos.exigirDistinta(userId, nueva, { via: "enlace" });
      await efectos.invalidarEnlaces(userId, token);
      return;
    }

    const userId = await efectos.usuarioDeLaSesion();
    // Sin sesión no hay nada que hacer: el endpoint responde 401.
    if (!userId) return;

    // `exigirDistinta` tiene que ser previa porque su trabajo es RECHAZAR el
    // cambio, y para eso el cambio no puede haber ocurrido; se protege sola
    // verificando `currentPassword` antes de contestar.
    await efectos.exigirDistinta(userId, nueva, {
      via: "sesion",
      actual: peticion.actual,
    });

    // Y el borrado, solo DESPUÉS de probar la credencial.
    //
    // Es lo que faltaba para no tener que elegir entre dos fallos. Borrar sin
    // probar destruía enlaces pendientes en cada intento fallido —un dedazo del
    // dueño, o alguien con la sesión robada repitiéndolo—. Borrar en el `after`
    // lo arreglaba pero volvía la invalidación un "si se puede": con la
    // contraseña ya cambiada, un DELETE que falla deja vivos 24 horas de
    // enlaces que sirven para pisarla.
    //
    // Probando la credencial acá se sabe que Better Auth va a aceptar el
    // cambio, así que el borrado puede volver a ser previo y fallar cerrado: si
    // la base falla, esto tira y la contraseña no llega a cambiar.
    if (await efectos.credencialProbada(userId, peticion.actual)) {
      await efectos.invalidarTodosLosEnlaces(userId);
    }
  } catch (error) {
    // Un rechazo con causa —la contraseña repetida— viaja tal cual: es lo único
    // que la persona puede corregir sola.
    if (error instanceof APIError) throw error;

    console.error(
      "[password] no se pudo preparar el cambio de contraseña; se rechaza.",
      error,
    );

    throw new APIError("INTERNAL_SERVER_ERROR", {
      message:
        "No pudimos completar el cambio de contraseña. Intentá de nuevo en un momento.",
    });
  }
};

export interface EfectosDespuesDelCambio {
  invalidarEnlaces: (userId: string) => Promise<void>;
  registrarPasswordPropia: (userId: string) => Promise<void>;
}

/**
 * Las consecuencias de un `/change-password` que SÍ cambió la contraseña.
 *
 * `usuarioQueCambioSuPassword` es el filtro: devuelve un id solo cuando Better
 * Auth respondió con el cambio aplicado, así que un intento fallido no llega
 * acá y no borra nada de nadie.
 *
 * Y llegar después no es solo por eso. Un enlace emitido DESPUÉS del DELETE y
 * ANTES de que la contraseña quedara comprometida no estaba entre las filas
 * borradas y sobrevivía al cambio entero con sus 24 horas. Corriendo acá, ese
 * enlace ya existe cuando se borra.
 */
export const despuesDeCambiarPassword = async (
  path: string | undefined,
  devuelto: unknown,
  efectos: EfectosDespuesDelCambio,
): Promise<void> => {
  const userId = usuarioQueCambioSuPassword(path, devuelto);
  if (!userId) return;

  // Lo que se pierde al mudarlo acá: ya no se puede rechazar el cambio si el
  // DELETE falla, porque la contraseña ya cambió. Tirar convertiría un cambio
  // exitoso en un 500 y la persona reintentaría con una contraseña que ya no
  // es la suya. Queda en el log, y el enlace viejo muere igual en cuanto se
  // use o venza.
  try {
    await efectos.invalidarEnlaces(userId);
  } catch (error) {
    console.error(
      "[password] la contraseña cambió pero quedaron enlaces de recuperación sin invalidar.",
      error,
    );
  }

  await efectos.registrarPasswordPropia(userId);
};
