import type { SendResultItem } from './types';

/**
 * Error base para errores de la API de SimpleTech
 */
export class SimpleTechError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimpleTechError';
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
 * Error cuando uno o mas mensajes fallan en el envio
 */
export class PartialSendError extends SimpleTechError {
  public readonly failed: SendResultItem[];
  public readonly results: SendResultItem[];

  constructor(failed: SendResultItem[], results: SendResultItem[]) {
    const count = failed.length;
    const errors = failed.map(f => `${f.number} (${f.channel}): ${f.error}`).join(', ');
    super(`${count} mensaje(s) fallaron: ${errors}`);
    this.name = 'PartialSendError';
    this.failed = failed;
    this.results = results;
  }
}

// =============================================================================
// Discriminadores de tipo
// =============================================================================

export function isSimpleTechError(error: unknown): error is SimpleTechError {
  return error instanceof SimpleTechError;
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

export function isConnectionError(error: unknown): error is ConnectionError {
  return error instanceof ConnectionError;
}

export function isPartialSendError(error: unknown): error is PartialSendError {
  return error instanceof PartialSendError;
}

export function isRetryableError(error: unknown): boolean {
  return isConnectionError(error);
}
