/**
 * Estado de un registro que quedó a medias.
 *
 * El registro del portal son dos pasos que no son atómicos: primero se crea la
 * cuenta de Better Auth (`signUp.email`) y después se registra en CRM/cartera
 * (`register-external-auth`), que es la única llamada que escribe el rol y el
 * DPI. Si la segunda falla por algo corregible —un DPI ya tomado— hay que
 * reintentar SOLO esa parte: repetir el alta choca con "el correo ya existe".
 *
 * Saber si el alta ya ocurrió no puede depender de la vida del componente. Un
 * `useRef` se pierde al recargar o al cerrar la pestaña, y el siguiente intento
 * repetía el alta y fallaba. La evidencia buena la tiene el servidor: tras
 * `signUp.email` la sesión queda abierta, y esa sesión sobrevive a la recarga.
 */

import { conflictoDeRegistro } from "../../Profile/services/registroExterno.errors";

const normalizarCorreo = (correo: string | null | undefined): string =>
  typeof correo === "string" ? correo.trim().toLowerCase() : "";

/**
 * Qué hacer con el alta de Better Auth en este envío del formulario.
 *
 * - `crear`: no hay cuenta todavía; se hace el `signUp.email`.
 * - `reintentar`: la cuenta ya existe con ESTE correo; se salta el alta y se
 *   repite solo el registro externo.
 * - `correo_cambiado`: la cuenta ya existe con OTRO correo. No se puede seguir
 *   por ninguno de los dos lados y hay que decirlo (ver
 *   `mensajeDeCorreoCambiado`).
 *
 * El tercer estado es el que faltaba. Antes esto era un booleano y el "ya está
 * creada" se daba por hecho sin mirar el correo, así que si el registro externo
 * fallaba y la persona corregía el correo en el paso 2, el reintento se saltaba
 * el alta y mandaba `register-external-auth` con la sesión del correo VIEJO. El
 * servidor ignora el correo del cuerpo a propósito (usa el de la sesión), de
 * modo que la cuenta, el lead de CRM y la fila de cartera quedaban con el
 * correo que la persona acababa de descartar, con su DPI real colgando y sin
 * ningún aviso en pantalla.
 *
 * Seguir de largo por el otro lado tampoco vale: caer al `signUp.email` con el
 * correo nuevo crea una SEGUNDA cuenta y deja huérfana la primera —la que lleva
 * la sesión abierta—. Eso es lo que pasaba cuando la persona recargaba en vez
 * de reintentar, y es el mismo estado con dos desenlaces opuestos. Aquí los dos
 * caminos terminan igual: detectar y negarse.
 *
 * El correo del alta se recuerda además de preguntarle a la sesión porque son
 * evidencias distintas: la sesión sobrevive a la recarga (es la única que cubre
 * ese caso) pero depende de una llamada que puede fallar; el correo del alta
 * solo vive mientras vive el formulario, pero no depende de la red.
 *
 * No se suman: la sesión MANDA y el ref solo es el respaldo para cuando no la
 * hay. Sumarlas con un OR —bastaba que CUALQUIERA casara— dejaba pasar el
 * envío cuando el ref decía una cuenta y la sesión otra, que es justo el estado
 * que dos pestañas de /register producen, y el registro externo se escribía
 * sobre la cuenta de la sesión con el DPI y el nombre del otro formulario.
 */
export type DecisionDeAlta = "crear" | "reintentar" | "correo_cambiado";

export const decidirAlta = (params: {
  /** Correo con el que este mismo formulario ya creó la cuenta, si lo hizo. */
  correoDelAlta: string | null | undefined;
  /** Correo de la sesión abierta, si la hay. */
  correoDeLaSesion: string | null | undefined;
  correoDelFormulario: string;
}): DecisionDeAlta => {
  const formulario = normalizarCorreo(params.correoDelFormulario);
  const sesion = normalizarCorreo(params.correoDeLaSesion);
  const alta = normalizarCorreo(params.correoDelAlta);

  // La sesión NO es una evidencia más que se suma a la del ref: es LA cuenta
  // contra la que va a correr `register-external-auth`, porque el servidor saca
  // de ahí la identidad y descarta el correo del cuerpo. El ref solo dice qué
  // creó ESTE formulario, y otra pestaña pudo haber cambiado la sesión debajo
  // (la cookie es del dominio), así que el ref nunca puede validar un envío que
  // se va a escribir sobre otra cuenta.
  if (sesion) {
    return sesion === formulario ? "reintentar" : "correo_cambiado";
  }

  // Sin sesión —o con un `getSession` que no contestó— manda el ref, que es su
  // único trabajo real: sobrevivir a un hipo de red sin que el reintento se lea
  // como una cuenta por crear (eso duplicaría la cuenta).
  if (alta) {
    return alta === formulario ? "reintentar" : "correo_cambiado";
  }

  return "crear";
};

/**
 * Aviso de que la cuenta abierta no es la del correo del formulario.
 *
 * Nombra el correo de la cuenta: es el único sitio donde la persona lo va a ver
 * escrito, y sin él tendría que adivinar contra qué cuenta está atrapada. La
 * salida no es reintentar —el formulario no puede cambiarle el correo a una
 * cuenta ya creada— sino cerrar sesión, así que se dice.
 *
 * El texto no le achaca a la persona haber cambiado el correo: puede no haber
 * tocado nada y ser la SESIÓN la que cambió debajo, desde otra pestaña. Se
 * describe el estado ("hay una cuenta abierta con X") y la salida, sin suponer
 * un dedazo que quizá no hubo.
 */
export const mensajeDeCorreoCambiado = (correoDeLaCuenta: string): string => {
  const correo = correoDeLaCuenta.trim();
  const cuenta = correo
    ? `Ya hay una cuenta abierta con ${correo}`
    : "Ya hay una cuenta abierta con el correo del intento anterior";

  return `${cuenta}, y este formulario solo puede terminar el registro de esa cuenta. Para registrarte con otro correo, tienes que cerrar sesión y empezar de nuevo.`;
};

const MENSAJE_GENERICO =
  "No pudimos crear tu cuenta. Intenta de nuevo.";

const MENSAJE_CORREO_OCUPADO =
  "Ya existe una cuenta con este correo. Inicia sesión para terminar tu registro.";

type ResultadoDeAlta = {
  error?: {
    status?: number | null;
    code?: string | null;
    message?: string | null;
  } | null;
} | null | undefined;

/**
 * Mensaje para un alta que no llegó a crear la cuenta.
 *
 * El correo ocupado se trata aparte porque es el desenlace normal de un
 * registro anterior a medias, y su salida no es reintentar aquí sino iniciar
 * sesión: el formulario de completar perfil termina la identidad. Antes este
 * caso devolvía sin mensaje y dejaba el formulario mudo.
 */
export const mensajeDeAltaFallida = (resultado: ResultadoDeAlta): string => {
  const error = resultado?.error;

  if (!error) {
    return MENSAJE_GENERICO;
  }

  const codigo = typeof error.code === "string" ? error.code.toUpperCase() : "";
  const mensaje = typeof error.message === "string" ? error.message.trim() : "";

  if (codigo.includes("ALREADY_EXIST") || /already exists/i.test(mensaje)) {
    return MENSAJE_CORREO_OCUPADO;
  }

  return mensaje || MENSAJE_GENERICO;
};

const MENSAJE_REGISTRO_GENERICO =
  "No pudimos completar tu registro. Intenta de nuevo.";

/**
 * Motivo que se le muestra a la persona cuando el registro externo
 * (`register-external-auth`) falla.
 *
 * Los dos caminos de registro —correo y Google— mueren en la MISMA llamada, la
 * única que escribe el rol y el DPI, así que tienen que decir lo mismo. Que
 * divergieran es el bug: el camino del correo ya llevaba el 409 de DPI al
 * campo, y el de Google lo dejaba en un `console.error` con la persona mirando
 * un formulario mudo. El camino del correo además marca el campo `dpi` (puede,
 * sigue en el formulario); el de Google ya navegó al perfil y solo puede
 * mostrar el texto, pero es el mismo texto.
 */
export const mensajeDeRegistroFallido = (error: unknown): string => {
  const conflicto = conflictoDeRegistro(error);

  if (conflicto) {
    return conflicto.mensaje;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return MENSAJE_REGISTRO_GENERICO;
};
