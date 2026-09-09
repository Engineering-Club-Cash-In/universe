/**
 * Qué pasa cuando la persona dice "ya me avisaron, volvé a intentar".
 *
 * POR QUÉ HAY REINTENTO. El aviso de "quedó sin DPI" se levanta cuando el
 * registro topó con una ficha que abrió un asesor y solo él puede completar. Se
 * cerraba el formulario y ahí terminaba todo, con el argumento de que reenviar
 * era inútil por construcción. Lo era solo mientras la ficha siguiera sin DPI:
 * en cuanto el asesor la completa, la ÚNICA llamada capaz de copiar ese DPI a
 * la cuenta (`register-external-auth`) es justamente la que quedaba bloqueada.
 * Y no se destraba sola: actualizar el CRM no toca `auth-google.users.dpi`, así
 * que al recargar la sesión sigue sin DPI, el aviso se restaura de
 * `localStorage` y vuelve a bloquear. Para siempre.
 *
 * POR QUÉ NO SE PREGUNTA AL SERVIDOR SI YA ESTÁ LISTO. Porque no hay a quién
 * preguntarle: `avisoDpiPendiente.ts:11-20` explica que hoy nada distingue una
 * cuenta pendiente de una que nunca se registró, y averiguarlo pedía una
 * columna nueva o volver a consultar el CRM por correo —el oráculo de fichas
 * que este portal ya eliminó—. El reintento es esa consulta, hecha por el
 * camino que ya existe y con la persona apretando el botón: si la ficha sigue
 * sin DPI el servidor responde otra vez `identity.dpi: null`, el ámbar se
 * vuelve a pintar y no se perdió nada; si ya lo tiene, el DPI se escribe y
 * `recordarSiQuedoSinDpi` apaga el aviso solo.
 *
 * QUÉ SE REENVÍA. El DPI vive en el estado del formulario, y el aviso sobrevive
 * a la recarga: quien vuelve al día siguiente ve el ámbar con el campo vacío.
 * Reenviar eso choca contra la validación local y le pinta un error rojo por un
 * campo que ni siquiera está viendo, así que en ese caso se le vuelve a pedir
 * en vez de mandarlo.
 */
export type AccionDeReintento = "reenviar" | "pedir-dpi";

export const LARGO_DEL_DPI = 13;

/**
 * Única definición de "el DPI está completo": la usan el envío, el estilo del
 * botón y el reintento. Separadas, el botón dejaba mandar lo que el reintento
 * considera incompleto.
 */
export const dpiCompleto = (dpi: string | null | undefined): boolean =>
  typeof dpi === "string" && dpi.trim().length === LARGO_DEL_DPI;

export const accionDeReintento = (dpi: string): AccionDeReintento =>
  dpiCompleto(dpi) ? "reenviar" : "pedir-dpi";
