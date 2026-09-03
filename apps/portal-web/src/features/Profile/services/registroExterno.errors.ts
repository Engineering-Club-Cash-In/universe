/**
 * Errores del registro externo (`/api/unified/register-external-auth`).
 *
 * El servicio lanzaba un `Error` con solo el mensaje, así que quien lo recibía
 * no podía distinguir "ese DPI ya está en otra cuenta" —lo único que el titular
 * puede corregir— de una caída cualquiera. Aquí se conserva el status y el
 * código que devuelve auth-google para poder llevar el conflicto al campo del
 * formulario que lo provocó.
 */

export class RegistroExternoError extends Error {
  status: number | null;
  codigo: string | null;

  constructor(status: number | null, codigo: string | null, message: string) {
    super(message);
    this.name = "RegistroExternoError";
    this.status = status;
    this.codigo = codigo;
  }
}

const MENSAJE_GENERICO = "Error al registrar usuario externo";

/** Construye el error a partir de la excepción de axios. */
export const registroExternoErrorDesde = (error: unknown): RegistroExternoError => {
  const respuesta = (error as { response?: { status?: number; data?: unknown } })
    ?.response;

  const datos = (respuesta?.data ?? {}) as {
    message?: unknown;
    error?: unknown;
  };

  const mensaje =
    typeof datos.message === "string" && datos.message.trim()
      ? datos.message.trim()
      : MENSAJE_GENERICO;

  return new RegistroExternoError(
    typeof respuesta?.status === "number" ? respuesta.status : null,
    typeof datos.error === "string" ? datos.error : null,
    mensaje,
  );
};

export type ConflictoDeRegistro = {
  /** Campo del formulario al que pertenece el conflicto. */
  campo: "dpi";
  mensaje: string;
};

/**
 * Traduce el error a un conflicto que el formulario pueda mostrar sobre un
 * campo concreto. Devuelve `null` cuando no hay nada que el usuario pueda
 * corregir por su cuenta (un 500, la red caída, etc.).
 */
export const conflictoDeRegistro = (
  error: unknown,
): ConflictoDeRegistro | null => {
  if (!(error instanceof RegistroExternoError)) {
    return null;
  }

  if (error.codigo === "dpi_ya_registrado" || error.status === 409) {
    return {
      campo: "dpi",
      mensaje: error.message || "El DPI ya está registrado en otra cuenta",
    };
  }

  if (error.codigo === "dpi_invalido") {
    return { campo: "dpi", mensaje: error.message };
  }

  return null;
};
