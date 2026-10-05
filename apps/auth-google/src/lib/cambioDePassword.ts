/**
 * Quién acaba de cambiar su propia contraseña, leído de la respuesta de Better
 * Auth.
 *
 * Better Auth no expone un `onPasswordChange` (solo `onPasswordReset`, que es
 * del camino del enlace por correo). Lo único que queda para enterarse de un
 * cambio hecho desde adentro de la sesión es el hook `hooks.after`, que corre
 * para TODOS los endpoints y recibe en `ctx.context.returned` lo que devolvió
 * el que se ejecutó.
 *
 * Por eso esta decisión vive aparte y sin dependencias: es la que tiene que
 * distinguir "cambió la contraseña" de "intentó y falló" y de "esto fue otro
 * endpoint cualquiera". Equivocarse hacia el sí limpiaría la marca de primer
 * ingreso de alguien que sigue con la contraseña que le mandamos.
 */

/** La ruta de Better Auth que cambia la contraseña con la sesión abierta. */
export const RUTA_CAMBIO_DE_PASSWORD = "/change-password";

/**
 * Devuelve el id del usuario cuya contraseña se acaba de cambiar, o `null`.
 *
 * `/change-password` responde `{ token, user }` cuando el cambio se aplicó. Un
 * intento fallido (contraseña actual equivocada, contraseña nueva muy corta) no
 * llega acá como respuesta: llega como `APIError`, que no trae `user`. De ahí
 * que la comprobación sea por la FORMA de la respuesta y no por un código de
 * estado — la forma es lo que Better Auth garantiza.
 */
export function usuarioQueCambioSuPassword(
  path: string | undefined,
  devuelto: unknown,
): string | null {
  if (path !== RUTA_CAMBIO_DE_PASSWORD) return null;
  if (typeof devuelto !== "object" || devuelto === null) return null;

  const { user } = devuelto as { user?: unknown };
  if (typeof user !== "object" || user === null) return null;

  const { id } = user as { id?: unknown };
  return typeof id === "string" && id.trim() !== "" ? id : null;
}
