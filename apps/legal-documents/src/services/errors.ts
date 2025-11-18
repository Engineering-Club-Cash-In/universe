// errors.ts - Clases de error personalizadas para manejo robusto
export class NetworkError extends Error {
  originalError?: Error;

  constructor(message: string, originalError?: Error) {
    super(message);
    this.name = 'NetworkError';
    this.originalError = originalError;
  }
}

export class ValidationError extends Error {
  errors: Array<{ field: string; error: string }>;

  constructor(
    message: string,
    errors: Array<{ field: string; error: string }>
  ) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export class ServerError extends Error {
  statusCode: number;
  response?: unknown;

  constructor(
    message: string,
    statusCode: number,
    response?: unknown
  ) {
    super(message);
    this.name = 'ServerError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

export class TimeoutError extends Error {
  constructor(message: string = 'La solicitud tardó demasiado tiempo') {
    super(message);
    this.name = 'TimeoutError';
  }
}
