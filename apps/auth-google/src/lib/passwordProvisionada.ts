/**
 * ¿Esta cuenta sigue usando la contraseña que le generamos nosotros?
 *
 * `passwordProvisionadaAt` la pone el alta que CREA la cuenta y la limpia el
 * cambio de contraseña. Mientras tenga fecha, la credencial con la que se entró
 * viajó por correo y puede estar reenviada, impresa o en una bandeja
 * compartida, así que el portal no la deja seguir.
 *
 * `null` NO significa "ya la cambió": significa "no sabemos que la suya sea
 * nuestra". Por eso las cuentas anteriores a la columna quedan en `null` y a
 * ninguna se le pide nada — es el comportamiento que se quiere.
 *
 * Vive aparte porque decide un 403 sobre TODA la superficie autenticada
 * (`/api/cartera/*`, `/api/crm/*`, `/api/profile/*`) y equivocarse hacia el sí
 * deja a alguien sin poder usar el portal. Es el espejo de
 * `debeElegirPassword` en portal-web: los dos tienen que decir lo mismo.
 */

export interface CuentaConMarcaDePassword {
  passwordProvisionadaAt?: string | Date | null;
}

export const sigueConLaPasswordQueLeDimos = (
  cuenta: CuentaConMarcaDePassword | null | undefined,
): boolean => {
  if (!cuenta) return false;

  const marca = cuenta.passwordProvisionadaAt;
  if (marca == null) return false;

  // Se aceptan `Date` y cadena ISO —el objeto de sesión llega de las dos formas
  // según pase o no por la red— y NADA más: un `true`, un `0` o una cadena
  // vacía no son una marca y no pueden encerrar a nadie fuera del portal.
  if (marca instanceof Date) return !Number.isNaN(marca.getTime());
  if (typeof marca !== "string") return false;

  return marca.trim() !== "" && !Number.isNaN(Date.parse(marca));
};
