import type { SMSErrorCode, SendSMSErrorResponse } from './types';

/**
 * Mensajes de error documentados por codigo
 */
export const ERROR_MESSAGES: Record<SMSErrorCode, { message: string; hint: string }> = {
  1: { message: 'Unauthorized access!!!', hint: 'Unauthorized access!!!' },
  2: { message: 'Missing configuration error', hint: 'Some of the fields have null values, which is not correct' },
  3: { message: 'Bad authentication', hint: 'The given authorization information is not valid' },
  4: { message: 'Missing configuration error', hint: 'The API Key parameter can not be empty nor zero' },
  5: { message: 'Missing configuration error', hint: 'The Carrier parameter can not be empty' },
  6: { message: 'Missing configuration error', hint: 'The Country code parameter can not be empty, it should be 2 characters long' },
  7: { message: 'Missing configuration error', hint: 'The Message parameter can not be empty' },
  8: { message: 'Missing configuration error', hint: 'The msisdn array can not be empty nor null' },
  9: { message: 'Missing configuration error', hint: 'The Tag parameter cannot be empty' },
  10: { message: 'Missing configuration error', hint: 'Invalid date parameter, must be a future date or an empty field' },
  11: { message: 'Missing configuration error', hint: 'Malformed date parameter, the format should be ISO-8601' },
  12: { message: 'Missing configuration error', hint: 'The Dial parameter is invalid' },
  13: { message: 'Validation error', hint: 'Verify your request format' },
  14: { message: 'Validation error', hint: 'The client was not found' },
  15: { message: 'Validation error', hint: 'The client has not enough credit to complete the operation' },
  16: { message: 'Validation error', hint: 'There are many accounts to the client' },
  17: { message: 'Validation error', hint: 'The country abbreviation or the carrier does not exist' },
  18: { message: 'Validation error', hint: 'The specified dial does not exist or is not assigned to the client' },
  19: { message: 'Server error', hint: 'Connection refused' },
};

/**
 * Error base para errores de la API de SMS
 */
export class SMSError extends Error {
  public readonly code: SMSErrorCode;
  public readonly hint: string;

  constructor(code: SMSErrorCode, hint?: string, message?: string) {
    const errorInfo = ERROR_MESSAGES[code];
    super(message || errorInfo.message);
    this.name = 'SMSError';
    this.code = code;
    this.hint = hint || errorInfo.hint;
  }

  /**
   * Crea un SMSError desde la respuesta de la API
   */
  static fromResponse(response: SendSMSErrorResponse): SMSError {
    const code = response.code as SMSErrorCode;

    // Mapear a errores especificos segun el codigo
    if (code === 1 || code === 3) {
      return new AuthenticationError(code, response.hint);
    }

    if (code === 15) {
      return new InsufficientCreditError(response.hint);
    }

    return new SMSError(code, response.hint, response.message);
  }
}

/**
 * Error de autenticacion (codigos 1, 3)
 */
export class AuthenticationError extends SMSError {
  constructor(code: 1 | 3 = 3, hint?: string) {
    super(code, hint);
    this.name = 'AuthenticationError';
  }
}

/**
 * Error de validacion local (antes de enviar a la API)
 */
export class ValidationError extends Error {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Error de conexion HTTP o timeout
 */
export class ConnectionError extends Error {
  public readonly statusCode?: number;
  public readonly responseBody?: string;

  constructor(message: string, statusCode?: number, responseBody?: string) {
    super(message);
    this.name = 'ConnectionError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

/**
 * Error de credito insuficiente (codigo 15)
 */
export class InsufficientCreditError extends SMSError {
  constructor(hint?: string) {
    super(15, hint);
    this.name = 'InsufficientCreditError';
  }
}

// =============================================================================
// Discriminadores de tipo
// =============================================================================

/**
 * Verifica si el error es un SMSError
 */
export function isSMSError(error: unknown): error is SMSError {
  return error instanceof SMSError;
}

/**
 * Verifica si el error es de autenticacion
 */
export function isAuthenticationError(error: unknown): error is AuthenticationError {
  if (error instanceof AuthenticationError) return true;
  if (isSMSError(error) && (error.code === 1 || error.code === 3)) return true;
  return false;
}

/**
 * Verifica si el error es de validacion local
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Verifica si el error es de conexion
 */
export function isConnectionError(error: unknown): error is ConnectionError {
  return error instanceof ConnectionError;
}

/**
 * Verifica si el error es de credito insuficiente
 */
export function isInsufficientCreditError(error: unknown): error is InsufficientCreditError {
  if (error instanceof InsufficientCreditError) return true;
  if (isSMSError(error) && error.code === 15) return true;
  return false;
}

/**
 * Verifica si el error es reintentable
 * Solo errores de conexion y el codigo 19 (server error) son reintentables
 */
export function isRetryableError(error: unknown): boolean {
  if (isConnectionError(error)) return true;
  if (isSMSError(error) && error.code === 19) return true;
  return false;
}
