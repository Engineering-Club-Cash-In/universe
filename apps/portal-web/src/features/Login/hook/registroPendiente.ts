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

const normalizarCorreo = (correo: string | null | undefined): string =>
  typeof correo === "string" ? correo.trim().toLowerCase() : "";

/**
 * ¿La cuenta de Better Auth de este correo ya existe por un intento anterior?
 *
 * El correo de la sesión tiene que ser EL MISMO del formulario. Con una sesión
 * de otra cuenta, saltarse el alta ataría el registro a esa cuenta ajena: el
 * rol y el DPI que se piden aquí acabarían escritos sobre ella.
 */
export const altaYaHecha = (params: {
  /** El alta ya se hizo en esta misma vida del formulario. */
  creadaEnEsteCiclo: boolean;
  /** Correo de la sesión abierta, si la hay. */
  correoDeLaSesion: string | null | undefined;
  correoDelFormulario: string;
}): boolean => {
  if (params.creadaEnEsteCiclo) {
    return true;
  }

  const sesion = normalizarCorreo(params.correoDeLaSesion);

  return sesion !== "" && sesion === normalizarCorreo(params.correoDelFormulario);
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
