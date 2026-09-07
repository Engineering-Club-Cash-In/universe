import { and, eq, like } from "drizzle-orm";
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
 * Borra TODOS los enlaces de recuperación pendientes de una persona.
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
): Promise<number> => {
  const borrados = await db
    .delete(verificationTokens)
    .where(
      and(
        like(verificationTokens.identifier, `${PREFIJO_RESET}%`),
        eq(verificationTokens.value, userId),
      ),
    )
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
 * Las dos cosas juntas, sin propagar fallos.
 *
 * Se reportan por separado en el log a propósito: que no se pueda limpiar la
 * marca solo repite una pantalla; que no se puedan invalidar los enlaces deja
 * abierta una forma de entrar a la cuenta, y eso hay que poder verlo.
 */
export const registrarPasswordPropia = async (
  userId: string,
  origen: "enlace" | "cambio_en_sesion",
): Promise<void> => {
  try {
    const invalidados = await invalidarEnlacesDeReset(userId);
    if (invalidados > 0) {
      console.log(
        `[password] ${origen}: se invalidaron ${invalidados} enlace(s) de recuperación pendientes.`,
      );
    }
  } catch (error) {
    console.error(
      `[password] ${origen}: NO se pudieron invalidar los enlaces de recuperación pendientes.`,
      error,
    );
  }

  try {
    await limpiarMarcaDePasswordProvisionada(userId);
  } catch (error) {
    console.error(
      `[password] ${origen}: no se pudo limpiar password_provisionada_at.`,
      error,
    );
  }
};
