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
  { patron: /jwt expired/i, traduccion: "Tu sesión expiró, vuelve a iniciar sesión" },
  {
    patron: /jwt|invalid signature|invalid token|token no proporcionado|token inválido/i,
    traduccion: "Tu sesión no es válida, vuelve a iniciar sesión",
  },
  {
    patron: /^Expected /,
    traduccion: (m) => `Uno de los filtros o datos enviados no es válido (${m.input})`,
  },
  { patron: /payment\s+(\d+)\s+not found/i, traduccion: (m) => `No se encontró el pago ${m[1]}` },
  { patron: /payment not found/i, traduccion: "No se encontró el pago" },
  { patron: /credit not found or not active/i, traduccion: "No se encontró el crédito o no está activo" },
  { patron: /credit not found/i, traduccion: "No se encontró el crédito" },
  { patron: /user not found/i, traduccion: "No se encontró el usuario" },
  {
    patron: /validation failed/i,
    traduccion: "Los datos enviados no son válidos, revisa los campos e intenta de nuevo",
  },
  {
    patron: /internal server error/i,
    traduccion: "Error interno del servidor, intenta de nuevo o contacta soporte",
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
 * manda en `error` un motivo de negocio legible, se prefiere `error`.
 * Los crudos técnicos (excepción inesperada, driver de DB, stack) se
 * detectan con DETALLE_TECNICO y NO se promueven: el usuario ve el
 * genérico y el crudo no se filtra a la UI.
 */
const MENSAJE_SIN_INFORMACION = /^internal server error$/i;

/**
 * Firmas de errores técnicos que nunca deben mostrarse al usuario.
 * Los throws de negocio del backend ("Payment not found", "No se encontró
 * el pago con id 123") no calzan con ninguna de estas.
 */
const DETALLE_TECNICO = [
  /^\s*\w*(Error|Exception)\s*:/, // "TypeError: ...", "PostgresError: ..."
  /\bat\s+\S+\s+\(.+\)/, // frame de stack trace
  /\b(ECONN\w+|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN)\b/,
  /\b(undefined|null|NaN)\b/i,
  /cannot read|is not a function|is not defined/i,
  /\b(query|relation|column|constraint|duplicate key|violates|syntax)\b/i,
  /fetch failed|socket|connection|timeout/i,
];

function esDetalleTecnicoCrudo(detail: string): boolean {
  return DETALLE_TECNICO.some((patron) => patron.test(detail));
}

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
      return `${fallback}: El servidor tardó demasiado en responder, intenta de nuevo`;
    }
    if (!error.response) {
      return `${fallback}: Sin conexión con el servidor`;
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
        data.error.trim() &&
        (buscarTraduccion(data.error.trim()) !== null ||
          !esDetalleTecnicoCrudo(data.error.trim()))
      ) {
        detail = data.error;
      }
    }
    if (typeof detail === "string" && detail.trim()) {
      return `${fallback}: ${traducirDetalleTecnico(detail.trim())}`;
    }
    if (status === 401 || status === 403) {
      return `${fallback}: Tu sesión no es válida, vuelve a iniciar sesión`;
    }
    if (status >= 500) {
      return `${fallback}: Error interno del servidor (HTTP ${status})`;
    }
    return `${fallback} (HTTP ${status})`;
  }
  if (error instanceof Error && error.message) {
    return `${fallback}: ${error.message}`;
  }
  return fallback;
}
