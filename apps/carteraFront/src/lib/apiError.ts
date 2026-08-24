import { AxiosError } from "axios";
import { formatFieldErrors } from "./formErrors";

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
  // Mensajes por defecto de zod que el backend reenvía crudos.
  { patron: /^Required$/i, traduccion: "Este campo es obligatorio" },
  { patron: /^Expected .*received (?:undefined|null)$/i, traduccion: "Este campo es obligatorio" },
  { patron: /^Expected (?:number|integer)\b/i, traduccion: "Debe ser un número válido" },
  { patron: /^Expected (?:array|object)\b/i, traduccion: "El formato enviado no es válido" },
  { patron: /^Expected /i, traduccion: "El valor de este campo no es válido" },
  { patron: /^Invalid input$/i, traduccion: "El valor de este campo no es válido" },
  { patron: /^Invalid enum value/i, traduccion: "Debe seleccionar una opción válida" },
  { patron: /^Invalid email/i, traduccion: "Correo electrónico inválido" },
  { patron: /^Invalid url/i, traduccion: "URL inválida" },
  { patron: /^Invalid (?:uuid|cuid|nanoid|ulid)/i, traduccion: "Identificador inválido" },
  { patron: /^Invalid (?:date|datetime)/i, traduccion: "Fecha inválida" },
  // Catch-all de invalid_string: el resto son formatos (regex, ip, startsWith...).
  { patron: /^Invalid\b/i, traduccion: "El formato de este campo no es válido" },
  // too_small / too_big de zod en todas sus formas. Las variantes "or equal to"
  // van primero: si no, el patrón exclusivo captura "or" como si fuera el límite.
  { patron: /^Number must be greater than or equal to (\S+)/i, traduccion: (m) => `Debe ser mayor o igual a ${m[1]}` },
  { patron: /^Number must be less than or equal to (\S+)/i, traduccion: (m) => `No puede ser mayor a ${m[1]}` },
  { patron: /^Number must be exactly(?: equal to)? (\S+)/i, traduccion: (m) => `Debe ser exactamente ${m[1]}` },
  { patron: /^Number must be greater than (\S+)/i, traduccion: (m) => `Debe ser mayor a ${m[1]}` },
  { patron: /^Number must be less than (\S+)/i, traduccion: (m) => `Debe ser menor a ${m[1]}` },
  { patron: /^Number must be finite/i, traduccion: "Debe ser un número válido" },
  { patron: /^Number must be a multiple of (\S+)/i, traduccion: (m) => `Debe ser múltiplo de ${m[1]}` },
  { patron: /^String must contain at least 1 character/i, traduccion: "Este campo es obligatorio" },
  { patron: /^String must contain (?:at least|over) (\d+) character/i, traduccion: (m) => `Debe tener al menos ${m[1]} caracteres` },
  { patron: /^String must contain (?:at most|under) (\d+) character/i, traduccion: (m) => `Máximo ${m[1]} caracteres` },
  { patron: /^String must contain exactly (\d+) character/i, traduccion: (m) => `Debe tener exactamente ${m[1]} caracteres` },
  { patron: /^Array must contain (?:at least|more than) (\d+) element/i, traduccion: (m) => `Debe tener al menos ${m[1]} elemento(s)` },
  { patron: /^Array must contain (?:at most|less than) (\d+) element/i, traduccion: (m) => `Máximo ${m[1]} elemento(s)` },
  { patron: /^Array must contain exactly (\d+) element/i, traduccion: (m) => `Debe tener exactamente ${m[1]} elemento(s)` },
  { patron: /^Date must be/i, traduccion: "La fecha está fuera del rango permitido" },
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
  { patron: /^unknown error$/i, traduccion: "Ocurrió un error inesperado, contacta soporte" },
  { patron: /failed to sync credit payments/i, traduccion: "No se pudieron sincronizar los pagos del crédito" },
  { patron: /investor not found/i, traduccion: "No se encontró el inversionista" },
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

const MENSAJES_POR_CODIGO: Record<string, string> = {
  CREDIT_PENDING_CANCELLATION:
    "No se puede registrar el pago porque el crédito está pendiente de cancelación.",
  CREDIT_PENDING_RETURN_AUTHORIZATION:
    "Hay créditos pendientes de autorización para devolución a CUBE.",
};

export type BatchFailedCredit = {
  creditoId: number;
  numeroCreditoSifco: string;
  mensaje: string;
};

export function getBatchFailedCredits(error: unknown): BatchFailedCredit[] {
  if (!(error instanceof AxiosError)) return [];

  const data = error.response?.data as {
    fallidos?: unknown;
  } | undefined;

  if (!Array.isArray(data?.fallidos)) return [];

  return data.fallidos.filter((fallido): fallido is BatchFailedCredit => {
    if (!fallido || typeof fallido !== "object") return false;
    const row = fallido as Partial<BatchFailedCredit>;
    return typeof row.creditoId === "number"
      && typeof row.numeroCreditoSifco === "string"
      && typeof row.mensaje === "string"
      && row.mensaje.trim().length > 0;
  });
}

export type LiquidationFailureReason = {
  inversionista_id?: number;
  razon: string;
  code?: string;
  creditos_bloqueados?: Array<{ numero_credito_sifco?: string }>;
};

/**
 * `razon` de liquidateByInvestorId puede cargar `error.message` crudo de una
 * excepción (Postgres, driver, etc.) cuando el fallo no es una regla de
 * negocio conocida. Mismo criterio que extraerDetalle: nunca se muestra un
 * crudo técnico al usuario.
 */
export function formatearRazonLiquidacion(razon: string): string {
  const trimmed = razon.trim();
  if (!trimmed || esDetalleTecnicoCrudo(trimmed)) {
    return "Error interno al procesar este crédito, contacta soporte";
  }
  return traducirDetalleTecnico(trimmed);
}

export function getLiquidationFailureReasons(error: unknown): LiquidationFailureReason[] {
  if (!(error instanceof AxiosError)) return [];

  const data = error.response?.data as { errores?: unknown } | undefined;
  if (!Array.isArray(data?.errores)) return [];

  const vistos = new Set<string>();
  const razones: LiquidationFailureReason[] = [];
  for (const item of data.errores) {
    if (!item || typeof item !== "object") continue;
    const razon = (item as { razon?: unknown }).razon;
    if (typeof razon !== "string" || !razon.trim()) continue;
    const formateada = formatearRazonLiquidacion(razon);
    if (vistos.has(formateada)) continue;
    vistos.add(formateada);
    razones.push({ ...(item as LiquidationFailureReason), razon: formateada });
  }
  return razones;
}

export function getPendingReturnWarningMessage(error: unknown): string | null {
  if (!(error instanceof AxiosError)) return null;

  const data = error.response?.data as {
    code?: unknown;
    creditos_bloqueados?: Array<{ numero_credito_sifco?: unknown }>;
    errores?: Array<{ code?: unknown; razon?: unknown }>;
  } | undefined;

  if (data?.code !== "CREDIT_PENDING_RETURN_AUTHORIZATION") return null;

  const sifcos = (data.creditos_bloqueados ?? [])
    .map((credit) => credit.numero_credito_sifco)
    .filter((sifco): sifco is string => typeof sifco === "string" && sifco.length > 0);

  const otrasInconsistencias = [...new Set(
    (data.errores ?? [])
      .filter((item) => item?.code !== "CREDIT_PENDING_RETURN_AUTHORIZATION")
      .map((item) => item?.razon)
      .filter((razon): razon is string => typeof razon === "string" && razon.trim().length > 0)
      .map((razon) => razon.trim())
      .filter((razon) => !esDetalleTecnicoCrudo(razon)),
  )];

  const base = MENSAJES_POR_CODIGO.CREDIT_PENDING_RETURN_AUTHORIZATION;
  const warning = sifcos.length > 0 ? `${base} Créditos: ${sifcos.join(", ")}.` : base;
  return otrasInconsistencias.length > 0
    ? `${warning} Otras inconsistencias: ${otrasInconsistencias.join("; ")}.`
    : warning;
}

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

export function esDetalleTecnicoCrudo(detail: string): boolean {
  return DETALLE_TECNICO.some((patron) => patron.test(detail));
}

/**
 * El backend manda el detalle por campo de zod en dos formas distintas:
 *  - `errors`: `flatten().fieldErrors` -> { campo: ["mensaje", ...] }
 *  - `issues`: `flatten()` completo -> { formErrors: [], fieldErrors: {...} }
 * Ambas llegan con los mensajes por defecto de zod en inglés, así que cada uno
 * pasa por TRADUCCIONES antes de mostrarse.
 */
function extraerErroresPorCampo(data: unknown): string | undefined {
  const cuerpo = (data ?? {}) as { errors?: unknown; issues?: unknown };

  const candidatos = [
    cuerpo.errors,
    (cuerpo.issues as { fieldErrors?: unknown } | undefined)?.fieldErrors,
    cuerpo.issues,
  ];

  for (const candidato of candidatos) {
    if (!candidato || typeof candidato !== "object" || Array.isArray(candidato)) continue;
    // `issues` crudo con la forma { formErrors, fieldErrors } ya se cubrió arriba.
    if ("fieldErrors" in candidato || "formErrors" in candidato) continue;

    const traducidos: Record<string, string[]> = {};
    for (const [campo, valor] of Object.entries(candidato as Record<string, unknown>)) {
      const mensajes = (Array.isArray(valor) ? valor : [valor])
        .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
        .map((m) => traducirDetalleTecnico(m.trim()))
        .filter((m) => !esDetalleTecnicoCrudo(m));

      if (mensajes.length > 0) traducidos[campo] = mensajes;
    }

    const texto = formatFieldErrors(traducidos, "");
    if (texto) return texto;
  }

  return undefined;
}

/**
 * Decide qué texto del cuerpo del error se muestra al usuario, según la
 * convención del backend de cartera:
 *  - `message` / `mensaje`: texto curado (normalmente español), salvo cuando
 *    es el genérico "Internal server error".
 *  - `error`: por convención carga `error.message` crudo de la excepción
 *    (`return { error: error.message }` en los catch), aunque algunos
 *    endpoints meten ahí el motivo de negocio. Por eso `error` solo se
 *    muestra si es traducible (negocio conocido) o no parece un crudo técnico
 *    (stack, driver de DB, etc.). Esta regla aplica venga de donde venga el
 *    `error`, no solo cuando los roles están invertidos.
 */
function extraerDetalle(data: unknown): string | undefined {
  const cuerpo = (data ?? {}) as {
    code?: unknown;
    message?: unknown;
    error?: unknown;
    mensaje?: unknown;
  };
  const code = typeof cuerpo.code === "string" ? cuerpo.code : "";
  const message = typeof cuerpo.message === "string" ? cuerpo.message.trim() : "";
  const mensaje = typeof cuerpo.mensaje === "string" ? cuerpo.mensaje.trim() : "";
  const errorRaw = typeof cuerpo.error === "string" ? cuerpo.error.trim() : "";

  const errorUtilizable =
    !!errorRaw && (buscarTraduccion(errorRaw) !== null || !esDetalleTecnicoCrudo(errorRaw));

  if (MENSAJES_POR_CODIGO[code]) {
    return MENSAJES_POR_CODIGO[code];
  }

  // El detalle por campo es más útil que cualquier `message` genérico.
  const porCampo = extraerErroresPorCampo(data);
  if (porCampo) {
    return porCampo;
  }

  // `message` curado tiene prioridad, salvo que sea el genérico sin información.
  if (message && !MENSAJE_SIN_INFORMACION.test(message)) {
    return message;
  }
  // `error` solo si pasa el filtro de crudos.
  if (errorUtilizable) {
    return errorRaw;
  }
  // `message` genérico ("Internal server error") como último recurso textual.
  if (message) {
    return message;
  }
  if (mensaje) {
    return mensaje;
  }
  return undefined;
}

/**
 * El detalle por campo es una lista de viñetas: va en su propia línea para que
 * se lea como lista y no pegada al fallback con dos puntos.
 */
function unirConDetalle(fallback: string, detalle: string): string {
  return detalle.startsWith("• ")
    ? fallback + ":\n" + detalle
    : `${fallback}: ${detalle}`;
}

/**
 * Extrae el motivo real de un error de API para mostrarlo al usuario.
 *
 * El campo `error` (crudo por convención del backend) se filtra en
 * `extraerDetalle`: nunca se muestra una excepción técnica al usuario.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const pendingReturnWarning = getPendingReturnWarningMessage(error);
    if (pendingReturnWarning) {
      return `${fallback}: ${pendingReturnWarning}`;
    }
    if (error.code === "ECONNABORTED") {
      return `${fallback}: El servidor tardó demasiado en responder, intenta de nuevo`;
    }
    if (!error.response) {
      return `${fallback}: Sin conexión con el servidor`;
    }
    const { status, data } = error.response;
    const detail = typeof data === "string" ? data : extraerDetalle(data);
    if (typeof detail === "string" && detail.trim()) {
      return unirConDetalle(fallback, traducirDetalleTecnico(detail.trim()));
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
    const msg = error.message.trim();
    // Algunos servicios relanzan `new Error(data.message || "<fallback>")`,
    // por lo que `msg` puede ser ya el mismo fallback: no duplicar ("X: X").
    if (!msg || msg === fallback) {
      return fallback;
    }
    const traducido = buscarTraduccion(msg);
    if (traducido) {
      return `${fallback}: ${traducido}`;
    }
    // Mismo criterio que extraerDetalle: no filtrar crudos técnicos a la UI.
    if (esDetalleTecnicoCrudo(msg)) {
      return fallback;
    }
    return `${fallback}: ${msg}`;
  }
  return fallback;
}
