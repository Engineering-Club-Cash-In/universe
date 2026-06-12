import { AxiosError } from "axios";

/**
 * Traducciones de mensajes técnicos o en inglés conocidos. Se recorre en
 * orden y gana la primera regla que matchea, así que las reglas específicas
 * van antes que las generales (p. ej. "credit not found or not active"
 * antes que "credit not found").
 */
const TRADUCCIONES: Array<{
  patron: RegExp;
  traduccion: string | ((match: RegExpExecArray) => string);
}> = [
  { patron: /jwt expired/i, traduccion: "tu sesión expiró, vuelve a iniciar sesión" },
  {
    patron: /jwt|invalid signature|invalid token|token no proporcionado|token inválido/i,
    traduccion: "tu sesión no es válida, vuelve a iniciar sesión",
  },
  {
    patron: /^Expected /,
    traduccion: (m) => `uno de los filtros o datos enviados no es válido (${m.input})`,
  },
  { patron: /payment\s+(\d+)\s+not found/i, traduccion: (m) => `no se encontró el pago ${m[1]}` },
  { patron: /payment not found/i, traduccion: "no se encontró el pago" },
  { patron: /credit not found or not active/i, traduccion: "no se encontró el crédito o no está activo" },
  { patron: /credit not found/i, traduccion: "no se encontró el crédito" },
  { patron: /user not found/i, traduccion: "no se encontró el usuario" },
  {
    patron: /validation failed/i,
    traduccion: "los datos enviados no son válidos, revisa los campos e intenta de nuevo",
  },
  {
    patron: /internal server error/i,
    traduccion: "error interno del servidor, intenta de nuevo o contacta soporte",
  },
];

function buscarTraduccion(detail: string): string | null {
  for (const { patron, traduccion } of TRADUCCIONES) {
    const match = patron.exec(detail);
    if (match) {
      return typeof traduccion === "function" ? traduccion(match) : traduccion;
    }
  }
  return null;
}

function traducirDetalleTecnico(detail: string): string {
  return buscarTraduccion(detail) ?? detail;
}

/**
 * `message` genérico que no aporta información: si el endpoint también
 * manda en `error` un motivo de negocio conocido (con traducción en
 * TRADUCCIONES), se prefiere `error`. Si `error` es un crudo no reconocido
 * (stack de driver, excepción inesperada), NO se promueve: el usuario ve
 * el genérico y el crudo no se filtra a la UI.
 */
const MENSAJE_SIN_INFORMACION = /^internal server error$/i;

/**
 * Extrae el motivo real de un error de API para mostrarlo al usuario.
 *
 * Prioridad de campos: `message` (texto curado de los endpoints) primero;
 * `error` cuando no hay `message` o cuando este es un genérico sin
 * información, porque hay endpoints donde los roles están invertidos
 * (`message: "Internal server error"` y el motivo real en `error`).
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    if (error.code === "ECONNABORTED") {
      return `${fallback}: el servidor tardó demasiado en responder, intenta de nuevo`;
    }
    if (!error.response) {
      return `${fallback}: sin conexión con el servidor`;
    }
    const { status, data } = error.response;
    let detail: unknown;
    if (typeof data === "string") {
      detail = data;
    } else {
      detail = data?.message ?? data?.error ?? data?.mensaje;
      if (
        typeof detail === "string" &&
        MENSAJE_SIN_INFORMACION.test(detail.trim()) &&
        typeof data?.error === "string" &&
        buscarTraduccion(data.error.trim()) !== null
      ) {
        detail = data.error;
      }
    }
    if (typeof detail === "string" && detail.trim()) {
      return `${fallback}: ${traducirDetalleTecnico(detail.trim())}`;
    }
    if (status === 401 || status === 403) {
      return `${fallback}: tu sesión no es válida, vuelve a iniciar sesión`;
    }
    if (status >= 500) {
      return `${fallback}: error interno del servidor (HTTP ${status})`;
    }
    return `${fallback} (HTTP ${status})`;
  }
  if (error instanceof Error && error.message) {
    return `${fallback}: ${error.message}`;
  }
  return fallback;
}
