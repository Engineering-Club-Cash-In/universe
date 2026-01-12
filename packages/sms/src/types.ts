/**
 * Credenciales de autenticacion para la API de BroadcasterMobile
 */
export interface SMSCredentials {
  /** Token de autorizacion (header Authorization) */
  token: string;
  /** ID del cliente proporcionado por Concepto Movil */
  apiKey: number;
}

/**
 * Configuracion de retry con exponential backoff
 */
export interface RetryConfig {
  /** Numero maximo de reintentos (default: 3) */
  maxRetries: number;
  /** Delay base en ms (default: 1000) */
  baseDelay: number;
  /** Delay maximo en ms (default: 10000) */
  maxDelay: number;
}

/**
 * Configuracion del cliente SMS
 */
export interface SMSConfig {
  /** Credenciales de autenticacion */
  credentials: SMSCredentials;
  /** URL base de la API (default: https://api.broadcastermobile.com) */
  baseUrl?: string;
  /** Timeout en milisegundos (default: 30000) */
  timeout?: number;
  /** Configuracion de reintentos (opcional) */
  retry?: RetryConfig;
}

/**
 * Operadores de telefonia soportados en Mexico
 */
export type Carrier = 'TELCEL' | 'ATT' | 'MOVISTAR';

/**
 * Clase de mensaje SMS
 * - 0: Mensaje normal
 * - 1: Mensaje flash (se muestra inmediatamente)
 */
export type MessageClass = 0 | 1;

/**
 * Tipo de notificacion de entrega (Delivery Receipt)
 * - 1: Notifica cuando el operador envio el MT al dispositivo
 * - 5: Notifica cuando el dispositivo recibio el MT
 * - 11: Notifica cuando se envio el MT al operador
 */
export type RegisteredDelivery = 1 | 5 | 11;

/**
 * Request para envio de SMS
 */
export interface SendSMSRequest {
  /** Numeros destino (10 digitos + lada, ej: 525512345678) */
  msisdns: string[];
  /** Texto del mensaje (max 160 chars, concatena en multiplos de 153) */
  message: string;
  /** Codigo de pais ISO2 (ej: "MX") */
  country: string;
  /** Identificador de campana/peticion */
  tag: string;
  /** Numero de marcacion para enviar el mensaje */
  dial?: number;
  /** Operador del destinatario (opcional si hay perfilamiento) */
  carrier?: Carrier;
  /** Mascara de remitente (requiere acuerdo previo) */
  mask?: string;
  /** Clase de mensaje: 0=normal, 1=flash */
  msgClass?: MessageClass;
  /** Fecha/hora de envio programado (ISO-8601) */
  schedule?: string | Date;
  /** Solicitar confirmacion de entrega */
  dlr?: boolean;
  /** Tipo de notificacion de entrega (requiere dlr=true) */
  registeredDelivery?: RegisteredDelivery;
}

/**
 * Request interno enviado a la API de BroadcasterMobile
 */
export interface SMSAPIRequest {
  apiKey: number;
  msisdns: string[];
  message: string;
  country: string;
  tag: string;
  dial?: number;
  carrier?: string;
  mask?: string;
  msgClass?: number;
  schedule?: string;
  dlr?: boolean;
  optionals?: string;
}

/**
 * Respuesta exitosa de la API
 */
export interface SendSMSSuccessResponse {
  /** Codigo 0 indica exito */
  code: 0;
  /** ID de la solicitud registrada */
  mailingId: number;
  /** Siempre "Applied" en exito */
  result: 'Applied';
}

/**
 * Respuesta de error de la API
 */
export interface SendSMSErrorResponse {
  /** Codigo de error (1-19) */
  code: number;
  /** Descripcion del error */
  hint: string;
  /** Tipo de error */
  message: string;
}

/**
 * Union de tipos de respuesta
 */
export type SendSMSResponse = SendSMSSuccessResponse | SendSMSErrorResponse;

/**
 * Resultado normalizado para el usuario
 */
export interface SMSResult {
  /** Indica si el envio fue exitoso */
  success: boolean;
  /** ID del mailing (solo en exito) */
  mailingId?: number;
  /** Informacion del error (solo en fallo) */
  error?: SMSErrorInfo;
}

/**
 * Codigos de error documentados de la API (1-19)
 */
export type SMSErrorCode =
  | 1   // Unauthorized access
  | 2   // Missing configuration - null values
  | 3   // Bad authentication
  | 4   // API Key empty or zero
  | 5   // Carrier empty
  | 6   // Country code empty or invalid
  | 7   // Message empty
  | 8   // msisdn array empty or null
  | 9   // Tag empty
  | 10  // Invalid date (must be future)
  | 11  // Malformed date format
  | 12  // Invalid dial
  | 13  // Invalid request format
  | 14  // Client not found
  | 15  // Insufficient credit
  | 16  // Too many accounts for client
  | 17  // Country/carrier not found
  | 18  // Dial not found or not assigned
  | 19; // Server connection refused

/**
 * Informacion detallada de error
 */
export interface SMSErrorInfo {
  /** Codigo de error */
  code: SMSErrorCode;
  /** Descripcion del error */
  hint: string;
  /** Tipo de error */
  message: string;
}
