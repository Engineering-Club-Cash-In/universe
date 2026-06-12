import { AxiosError } from "axios";

/**
 * Traduce mensajes técnicos conocidos (jwt, validación de Elysia, etc.)
 * a texto entendible para el usuario final. Si el mensaje ya es legible
 * (el backend lo mandó en español), se devuelve tal cual.
 */
function traducirDetalleTecnico(detail: string): string {
  const d = detail.toLowerCase();
  if (d.includes("jwt expired")) {
    return "tu sesión expiró, vuelve a iniciar sesión";
  }
  if (
    d.includes("jwt") ||
    d.includes("invalid signature") ||
    d.includes("invalid token") ||
    d.includes("token no proporcionado") ||
    d.includes("token inválido")
  ) {
    return "tu sesión no es válida, vuelve a iniciar sesión";
  }
  if (detail.startsWith("Expected ")) {
    return `uno de los filtros o datos enviados no es válido (${detail})`;
  }
  return detail;
}

/**
 * Extrae el motivo real de un error de API para mostrarlo al usuario.
 * El backend devuelve el detalle en `error`, `message` o `mensaje`
 * según el endpoint, por lo que se revisan los tres campos.
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
    const detail =
      typeof data === "string"
        ? data
        : (data?.error ?? data?.message ?? data?.mensaje);
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
