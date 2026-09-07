import { and, eq, like, ne } from "drizzle-orm";
import { db } from "../../db/connection";
import { users, verificationTokens } from "../../db/schema";

/**
 * Lo que pasa cuando alguien deja de usar una contraseña que no eligió.
 *
 * Se llama desde los DOS caminos que ponen una contraseña nueva —el enlace del
 * correo (`onPasswordReset`) y el cambio con la sesión abierta
 * (`/change-password`)— porque las dos consecuencias son las mismas y tienen
 * que ser las mismas: los enlaces que quedaron dando vueltas dejan de servir, y
 * la cuenta deja de estar marcada como "todavía tiene la contraseña que le
 * dimos".
 *
 * Nada de esto puede tirar: cuando corre, la contraseña YA se cambió. Un throw
 * acá convertiría un cambio exitoso en un 500 y la persona reintentaría con una
 * contraseña que ya no es la suya.
 */

/**
 * Better Auth guarda cada enlace de recuperación como una fila de
 * `verification_tokens` con `identifier = "reset-password:<token>"` y
 * `value = <id del usuario>` (ver `api/routes/password.mjs`).
 */
const PREFIJO_RESET = "reset-password:";

/**
 * ¿Este enlace de recuperación todavía sirve?
 *
 * Existe para que la pantalla de recuperación pueda decirlo AL ABRIRSE en vez
 * de dejar que la persona escriba una contraseña nueva, la confirme, le dé a
 * enviar y recién ahí enterarse de que el enlace ya no vale.
 *
 * No dice de quién es el enlace ni si el correo existe: responde sobre un token
 * que quien pregunta ya tiene en la mano, y eso es exactamente lo que el propio
 * `POST /reset-password` de Better Auth ya contesta con `INVALID_TOKEN`. La
 * puerta contra el barrido es el rate limit de `/api/*`.
 */
export const enlaceDeResetSigueVivo = async (
  token: string,
): Promise<boolean> => {
  if (token.trim() === "") return false;

  const filas = await db
    .select({ expiresAt: verificationTokens.expiresAt })
    .from(verificationTokens)
    .where(eq(verificationTokens.identifier, `${PREFIJO_RESET}${token}`))
    .limit(1);

  const fila = filas[0];
  // Mismo criterio que Better Auth: la fila existe Y no venció. Una fila
  // vencida que el barrido todavía no borró es un enlace muerto.
  return !!fila && fila.expiresAt > new Date();
};

/**
 * Borra los enlaces de recuperación pendientes de una persona, menos uno.
 *
 * Este es el bug que se está arreglando. Better Auth sí borra el token que se
 * usó, pero cada solicitud crea una fila distinta y nadie toca las demás: quien
 * pidió el enlace tres veces y cambió su contraseña con el tercero, deja los
 * otros dos vivos hasta que expiren, y cualquiera que los tenga —el correo
 * reenviado, la bandeja compartida, el historial del navegador— puede volver a
 * cambiarle la contraseña.
 *
 * Devuelve cuántos se invalidaron, para poder verlo en el log sin exponer los
 * tokens.
 */
export const invalidarEnlacesDeReset = async (
  userId: string,
  tokenQueSeEstaUsando?: string,
): Promise<number> => {
  const condiciones = [
    like(verificationTokens.identifier, `${PREFIJO_RESET}%`),
    eq(verificationTokens.value, userId),
  ];

  // El enlace que se está canjeando NO se toca: Better Auth todavía no lo ha
  // leído cuando esto corre, y borrarlo convertiría el canje legítimo en un
  // INVALID_TOKEN. Lo borra él mismo al terminar.
  if (tokenQueSeEstaUsando) {
    condiciones.push(
      ne(
        verificationTokens.identifier,
        `${PREFIJO_RESET}${tokenQueSeEstaUsando}`,
      ),
    );
  }

  const borrados = await db
    .delete(verificationTokens)
    .where(and(...condiciones))
    .returning({ id: verificationTokens.id });

  return borrados.length;
};

/**
 * Quita la marca de "la contraseña sigue siendo la que le generamos".
 *
 * Con la marca en NULL, el portal deja de mandarla a la pantalla de primer
 * ingreso. No se toca nada más de la cuenta.
 */
export const limpiarMarcaDePasswordProvisionada = async (
  userId: string,
): Promise<void> => {
  await db
    .update(users)
    .set({ passwordProvisionadaAt: null })
    .where(eq(users.id, userId));
};

/**
 * Invalida los enlaces pendientes ANTES de que la contraseña cambie.
 *
 * El orden es el arreglo. Hacerlo después dejaba una ventana imposible de
 * cerrar: si el DELETE fallaba, la contraseña ya estaba cambiada y no había
 * forma de deshacerlo, así que los enlaces viejos seguían sirviendo —hasta 24
 * horas— y cualquiera que tuviera uno podía volver a cambiarla. Un log no
 * arregla eso.
 *
 * Haciéndolo antes, un fallo de base tira y el cambio de contraseña no llega a
 * ocurrir: la persona reintenta y no queda ningún estado a medias. Es la única
 * forma de que "cambiaste la contraseña" implique SIEMPRE "los enlaces viejos
 * murieron", sin depender de reintentos ni de una transacción que no podemos
 * abrir alrededor de Better Auth.
 */
export const exigirInvalidacionDeEnlaces = async (
  userId: string,
  tokenQueSeEstaUsando?: string,
): Promise<void> => {
  const invalidados = await invalidarEnlacesDeReset(userId, tokenQueSeEstaUsando);

  if (invalidados > 0) {
    console.log(
      `[password] se invalidaron ${invalidados} enlace(s) de recuperación pendientes.`,
    );
  }
};

/**
 * Quita la marca de primer ingreso, sin propagar fallos.
 *
 * Esto SÍ puede ser best-effort, y la diferencia con lo de arriba es lo que
 * cuesta equivocarse: que la marca no se limpie hace que el portal vuelva a
 * pedir la pantalla de primer ingreso una vez más. No deja ninguna puerta
 * abierta. Y cuando corre, la contraseña ya cambió: tirar acá convertiría un
 * cambio exitoso en un 500 y la persona reintentaría con una contraseña que ya
 * no es la suya.
 */
export const registrarPasswordPropia = async (
  userId: string,
  origen: "enlace" | "cambio_en_sesion",
): Promise<void> => {
  try {
    await limpiarMarcaDePasswordProvisionada(userId);
  } catch (error) {
    console.error(
      `[password] ${origen}: no se pudo limpiar password_provisionada_at.`,
      error,
    );
  }
};
