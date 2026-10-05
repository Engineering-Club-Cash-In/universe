/**
 * ¿A esta persona todavía hay que pedirle que elija su contraseña?
 *
 * La sesión trae `passwordProvisionadaAt`: la fecha en que le generamos una
 * contraseña que ella no eligió y se la mandamos por correo. Mientras tenga
 * fecha, la contraseña con la que entró sigue siendo la nuestra —viajó por
 * correo, pudo quedar reenviada, impresa o en una bandeja compartida— y el
 * portal la manda a elegir la suya antes de mostrarle nada.
 *
 * En NULL no se le pide nada, y eso cubre a TODAS las cuentas que existían
 * antes de esta columna: a quien ya entraba con su propia contraseña no se le
 * cambia la vida.
 *
 * Vive aparte de `auth.ts` porque es la única regla del asunto y se puede
 * probar sin router ni sesión.
 */

/** La forma mínima del usuario de sesión que esta decisión necesita. */
export interface UsuarioConMarcaDePassword {
  passwordProvisionadaAt?: string | Date | null;
}

export function debeElegirPassword(
  usuario: UsuarioConMarcaDePassword | null | undefined,
): boolean {
  if (!usuario) return false;

  const marca = usuario.passwordProvisionadaAt;
  if (marca == null) return false;

  // Better Auth serializa el campo `date` como ISO en el JSON de la sesión,
  // pero el mismo objeto llega como `Date` cuando lo devuelve el SDK sin pasar
  // por la red. Se aceptan los dos, y nada más: un `true`, un `0` o una cadena
  // vacía no son una marca y no pueden encerrar a nadie en la pantalla.
  if (marca instanceof Date) return !Number.isNaN(marca.getTime());
  if (typeof marca !== "string") return false;

  return marca.trim() !== "" && !Number.isNaN(Date.parse(marca));
}
