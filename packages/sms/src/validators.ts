import { ValidationError } from './errors';
import type { SendSMSRequest } from './types';

// =============================================================================
// Constantes
// =============================================================================

/** Longitud maxima de un mensaje SMS sin concatenar */
export const MAX_MESSAGE_LENGTH = 160;

/** Longitud de cada segmento en mensajes concatenados */
export const MAX_CONCATENATED_SEGMENT = 153;

/** Patron para validar MSISDN (10-15 digitos) */
export const MSISDN_PATTERN = /^\d{10,15}$/;

/** Patron para codigo de pais ISO2 (2 letras mayusculas) */
export const ISO2_PATTERN = /^[A-Z]{2}$/;

// =============================================================================
// Validadores individuales
// =============================================================================

/**
 * Valida un numero MSISDN
 * @throws ValidationError si el formato es invalido
 */
export function validateMsisdn(msisdn: string): void {
  if (!msisdn || !MSISDN_PATTERN.test(msisdn)) {
    throw new ValidationError(
      `MSISDN invalido: "${msisdn}". Debe tener 10-15 digitos`,
      'msisdns'
    );
  }
}

/**
 * Valida un array de MSISDNs
 * @throws ValidationError si el array esta vacio o algun MSISDN es invalido
 */
export function validateMsisdns(msisdns: string[]): void {
  if (!msisdns || !Array.isArray(msisdns) || msisdns.length === 0) {
    throw new ValidationError('msisdns no puede estar vacio', 'msisdns');
  }
  msisdns.forEach(validateMsisdn);
}

/**
 * Valida el codigo de pais ISO2
 * @throws ValidationError si el formato es invalido
 */
export function validateCountry(country: string): void {
  if (!country || !ISO2_PATTERN.test(country.toUpperCase())) {
    throw new ValidationError(
      `Codigo de pais invalido: "${country}". Debe ser ISO2 (2 caracteres mayusculas)`,
      'country'
    );
  }
}

/**
 * Valida que el mensaje no este vacio
 * @throws ValidationError si el mensaje esta vacio
 */
export function validateMessage(message: string): void {
  if (!message || message.trim().length === 0) {
    throw new ValidationError('El mensaje no puede estar vacio', 'message');
  }
}

/**
 * Valida que el tag no este vacio
 * @throws ValidationError si el tag esta vacio
 */
export function validateTag(tag: string): void {
  if (!tag || tag.trim().length === 0) {
    throw new ValidationError('El tag no puede estar vacio', 'tag');
  }
}

/**
 * Valida la fecha de programacion
 * @throws ValidationError si la fecha es invalida o no es futura
 */
export function validateSchedule(schedule: string | Date): void {
  const date = schedule instanceof Date ? schedule : new Date(schedule);

  if (isNaN(date.getTime())) {
    throw new ValidationError(
      'Fecha de programacion invalida. Usar formato ISO-8601',
      'schedule'
    );
  }

  if (date <= new Date()) {
    throw new ValidationError(
      'La fecha de programacion debe ser en el futuro',
      'schedule'
    );
  }
}

/**
 * Valida el apiKey
 * @throws ValidationError si el apiKey no es un entero positivo
 */
export function validateApiKey(apiKey: number): void {
  if (!apiKey || apiKey <= 0 || !Number.isInteger(apiKey)) {
    throw new ValidationError(
      'apiKey debe ser un numero entero positivo',
      'apiKey'
    );
  }
}

// =============================================================================
// Validacion completa
// =============================================================================

/**
 * Valida todos los campos requeridos de un SendSMSRequest
 * @throws ValidationError si algun campo es invalido
 */
export function validateSendSMSRequest(request: SendSMSRequest): void {
  validateMsisdns(request.msisdns);
  validateMessage(request.message);
  validateCountry(request.country);
  validateTag(request.tag);

  if (request.schedule) {
    validateSchedule(request.schedule);
  }
}

// =============================================================================
// Utilidades
// =============================================================================

/**
 * Calcula el numero de segmentos que ocupara un mensaje
 * - Mensajes <= 160 chars: 1 segmento
 * - Mensajes > 160 chars: ceil(length / 153) segmentos
 */
export function calculateMessageSegments(message: string): number {
  if (message.length <= MAX_MESSAGE_LENGTH) return 1;
  return Math.ceil(message.length / MAX_CONCATENATED_SEGMENT);
}
