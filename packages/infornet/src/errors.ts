import type { InfornetErrorCode, InfornetErrorInfo } from './types';

// Mensajes de error por codigo
export const ERROR_MESSAGES: Record<InfornetErrorCode, string> = {
  '00001': 'Debe ampliar su seleccion',
  '00002': 'Ninguna entidad encontrada',
  '00003': 'Verificar su acceso',
  '00004': 'El usuario ha llegado al limite de consultas',
  '00005': 'Esta informacion solo puede ser consultada previa autorizacion del titular',
  '00006': 'El titular ha manifestado que no se divulgue informacion acerca de el sin su autorizacion',
};

// Error base de Infornet
export class InfornetError extends Error {
  public readonly codigo: InfornetErrorCode;
  public readonly info: InfornetErrorInfo;

  constructor(codigo: InfornetErrorCode, mensaje?: string) {
    const errorMessage = mensaje || ERROR_MESSAGES[codigo] || 'Error desconocido';
    super(errorMessage);
    this.name = 'InfornetError';
    this.codigo = codigo;
    this.info = { codigo, mensaje: errorMessage };
  }

  static fromCode(codigo: string): InfornetError {
    const errorCode = codigo as InfornetErrorCode;
    if (errorCode in ERROR_MESSAGES) {
      return new InfornetError(errorCode);
    }
    return new InfornetError('00003', `Error desconocido: ${codigo}`);
  }
}

// Error de conexion SOAP
export class SoapConnectionError extends Error {
  public readonly statusCode?: number;
  public readonly responseBody?: string;

  constructor(message: string, statusCode?: number, responseBody?: string) {
    super(message);
    this.name = 'SoapConnectionError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

// Error de parsing XML
export class XmlParseError extends Error {
  public readonly xmlContent?: string;

  constructor(message: string, xmlContent?: string) {
    super(message);
    this.name = 'XmlParseError';
    this.xmlContent = xmlContent;
  }
}

// Error de autenticacion
export class AuthenticationError extends Error {
  constructor(message: string = 'Error de autenticacion') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

// Error de validacion de parametros
export class ValidationError extends Error {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

// Helper para determinar si es un error de Infornet
export function isInfornetError(error: unknown): error is InfornetError {
  return error instanceof InfornetError;
}

// Helper para determinar si es error de "no encontrado"
export function isNotFoundError(error: unknown): boolean {
  return isInfornetError(error) && error.codigo === '00002';
}

// Helper para determinar si es error de autorizacion
export function isAuthorizationError(error: unknown): boolean {
  return (
    isInfornetError(error) &&
    (error.codigo === '00003' || error.codigo === '00005' || error.codigo === '00006')
  );
}

// Helper para determinar si es error de limite
export function isLimitError(error: unknown): boolean {
  return isInfornetError(error) && error.codigo === '00004';
}
