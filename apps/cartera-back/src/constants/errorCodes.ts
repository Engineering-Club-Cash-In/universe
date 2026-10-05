/**
 * Códigos de error estables para que el frontend no dependa de hacer regex
 * sobre texto libre. El texto puede cambiar; el `code` no.
 *
 * Mismo patrón que `CREDIT_PENDING_CANCELLATION_ERROR`
 * (src/controllers/registerPaymentPolicy.ts).
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CREDIT_NOT_FOUND: "CREDIT_NOT_FOUND",
  PAYMENT_NOT_FOUND: "PAYMENT_NOT_FOUND",
  INVESTOR_NOT_FOUND: "INVESTOR_NOT_FOUND",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
  CREDIT_PENDING_CANCELLATION: "CREDIT_PENDING_CANCELLATION",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "Los datos enviados no son válidos. Revisa los campos e intenta de nuevo.",
  INTERNAL_ERROR: "Error interno del servidor. Intenta de nuevo o contacta soporte.",
  NOT_FOUND: "No se encontró el recurso solicitado.",
  CREDIT_NOT_FOUND: "No se encontró el crédito.",
  PAYMENT_NOT_FOUND: "No se encontró el pago.",
  INVESTOR_NOT_FOUND: "No se encontró el inversionista.",
  EXTERNAL_SERVICE_ERROR: "Un servicio externo no está disponible. Intenta más tarde.",
  CREDIT_PENDING_CANCELLATION:
    "No se puede registrar el pago porque el crédito está pendiente de cancelación.",
};

/** Detalle por campo tal como lo produce `zodError.flatten().fieldErrors`. */
export type FieldErrors = Record<string, string[] | undefined>;

export type ErrorResponse = {
  success: false;
  code: ErrorCode;
  message: string;
  errors?: FieldErrors;
};

/**
 * Respuesta única para los fallos de validación. Reemplaza a los
 * `{ message: "Validation failed", errors }` sueltos, que llegaban al usuario
 * en inglés y sin código estable.
 */
export function validationFailed(errors: FieldErrors): ErrorResponse {
  return {
    success: false,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: ERROR_MESSAGES.VALIDATION_FAILED,
    errors,
  };
}

/** Respuesta de error sin detalle por campo. */
export function errorResponse(code: ErrorCode, message?: string): ErrorResponse {
  return {
    success: false,
    code,
    message: message ?? ERROR_MESSAGES[code],
  };
}
