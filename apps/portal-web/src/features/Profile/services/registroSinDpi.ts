/**
 * Registro que salió bien pero dejó la cuenta sin DPI.
 *
 * `register-external-auth` contesta 200 y aun así puede no haber escrito el
 * DPI. Pasa cuando el correo ya tiene una ficha que un asesor abrió sin DPI: el
 * CRM la reconoce y da el acceso, pero no le escribe el DPI del registro,
 * porque en esa ficha solo un humano puede ponerlo. El servidor respeta esa
 * decisión y tampoco lo escribe en Better Auth, a propósito —escribirlo quemaría
 * un DPI que nadie verificó en una columna ÚNICA—, así que la cuenta se queda
 * sin DPI con un 200 en la mano.
 *
 * El formulario de completar perfil trataba ese 200 como éxito: recargaba, y
 * como la puerta de `Profile.tsx` es `!user?.dpi`, volvía a salir el mismo
 * formulario. Reintentar no lo arregla nunca —el DPI de esa ficha no lo puede
 * poner la persona— pero nada se lo decía: un bucle infinito y mudo detrás de
 * una alerta roja que no se iba.
 */

export type IdentidadDelRegistro = {
  dpi?: string | null;
  role?: string | null;
};

type RespuestaConIdentidad = {
  identity?: IdentidadDelRegistro | null;
} | null | undefined;

/**
 * ¿El registro terminó sin dejar DPI en la cuenta?
 *
 * Se mira `identity.dpi` y NO la bandera `dpiRegistradoEnLead`, por dos razones:
 *
 * 1. Es el MISMO dato con el que `Profile.tsx` decide volver a mostrar este
 *    formulario. Atados al mismo valor, la decisión del formulario y la de la
 *    página no pueden discrepar.
 * 2. La bandera solo la emite el camino de CLIENT contra el CRM. El de INVESTOR
 *    y las altas nuevas no dicen nada, y un `dpiRegistradoEnLead !== true`
 *    mandaría a TODOS ellos a esta pantalla sin salida. Es la misma trampa que
 *    el servidor ya evita comparando con `=== false`.
 *
 * Además `identity.dpi` es el DPI VIGENTE, no solo el que escribió esta llamada:
 * si un intento anterior ya lo dejó puesto, aquí no hay nada pendiente.
 *
 * `identity` ausente significa servidor viejo (portal-web desplegado antes que
 * auth-google) y cae al comportamiento anterior: seguir de largo. Sin este
 * fallback, un desfase de despliegue dejaría a todo el mundo en "pendiente".
 */
export const registroQuedoSinDpi = (respuesta: RespuestaConIdentidad): boolean => {
  const identidad = respuesta?.identity;

  if (!identidad) {
    return false;
  }

  return !(typeof identidad.dpi === "string" && identidad.dpi.trim() !== "");
};

/**
 * Lo que ve la persona cuando su registro quedó a la espera de un humano.
 *
 * No es un error suyo y no hay nada que corregir en el formulario, así que el
 * texto no pide reintentar: dice que ya tiene acceso, por qué falta el dato,
 * que reintentar dará lo mismo, y por dónde salir. Sin jerga: aquí no aparecen
 * "CRM", "lead" ni nombres de campos.
 */
export const mensajeDeDpiPendiente = (correo: string): string => {
  const email = correo.trim();
  const referencia = email
    ? ` Menciona tu correo ${email} para que te ubiquemos rápido.`
    : "";

  return (
    "Ya tienes acceso a la plataforma. Lo que no pudimos guardar es tu número de " +
    "identificación, porque tu registro lo abrió antes uno de nuestros asesores y " +
    "solo él puede completarlo desde su sistema. No hace falta que lo vuelvas a " +
    "enviar: el resultado va a ser el mismo." +
    referencia +
    " Si ya te avisaron que quedó listo, recarga la página."
  );
};

/** Mensaje prellenado para el WhatsApp que el portal ya usa como canal. */
export const mensajeDeWhatsAppPorDpiPendiente = (correo: string): string => {
  const email = correo.trim();

  return email
    ? `Hola, me registré en el portal con el correo ${email} y me aparece que falta completar mi identificación.`
    : "Hola, me registré en el portal y me aparece que falta completar mi identificación.";
};
