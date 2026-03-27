/**
 * Credenciales de autenticacion para la API de SimpleTech
 */
export interface SimpleTechCredentials {
  /** Token de autorizacion (header token) */
  token: string;
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
 * Configuracion del cliente SimpleTech
 */
export interface SimpleTechConfig {
  /** Credenciales de autenticacion */
  credentials: SimpleTechCredentials;
  /** URL base de la API (sin /v2.php/send) */
  baseUrl: string;
  /** Timeout en milisegundos (default: 30000) */
  timeout?: number;
  /** Configuracion de reintentos (opcional) */
  retry?: RetryConfig;
}

/**
 * Canales de envio soportados
 */
export type Channel = 'WHATSAPP' | 'SMS' | 'WEB' | 'FACEBOOK' | 'INSTAGRAM';

/**
 * Tipos de mensaje soportados
 */
export type MessageType = 'message' | 'location' | 'document' | 'image' | 'video' | 'sound';

// =============================================================================
// Mensajes por tipo
// =============================================================================

/** Campos base compartidos por todos los tipos de mensaje */
interface BaseMessage {
  /** Numero destino con codigo de pais (ej: +50212345678) */
  number: string;
  /** Canal de envio */
  channel: Channel;
  /** Identificador del servicio (opcional) */
  serviceIdentifier?: string;
  /** ID del bot (opcional) */
  idBot?: string;
}

/** Mensaje de texto */
export interface TextMessage extends BaseMessage {
  type: 'message';
  /** Contenido del mensaje */
  text: string;
}

/** Mensaje de ubicacion */
export interface LocationMessage extends BaseMessage {
  type: 'location';
  /** Latitud */
  lat: string;
  /** Longitud */
  lng: string;
}

/** Mensaje con documento adjunto */
export interface DocumentMessage extends BaseMessage {
  type: 'document';
  /** Nombre del archivo */
  name: string;
  /** URL del documento (usar url o base64) */
  url?: string;
  /** Documento en base64 (usar url o base64) */
  base64?: string;
}

/** Mensaje con imagen */
export interface ImageMessage extends BaseMessage {
  type: 'image';
  /** Texto debajo de la imagen */
  caption?: string;
  /** URL de la imagen (usar url o base64) */
  url?: string;
  /** Imagen en base64 (usar url o base64) */
  base64?: string;
}

/** Mensaje con video */
export interface VideoMessage extends BaseMessage {
  type: 'video';
  /** Nombre del archivo */
  name?: string;
  /** Texto debajo del video */
  caption?: string;
  /** URL del video (usar url o base64) */
  url?: string;
  /** Video en base64 (usar url o base64) */
  base64?: string;
}

/** Mensaje con audio */
export interface AudioMessage extends BaseMessage {
  type: 'sound';
  /** Nombre del archivo */
  name?: string;
  /** URL del audio (usar url o base64) */
  url?: string;
  /** Audio en base64 (usar url o base64) */
  base64?: string;
}

/**
 * Union de todos los tipos de mensaje
 */
export type Message =
  | TextMessage
  | LocationMessage
  | DocumentMessage
  | ImageMessage
  | VideoMessage
  | AudioMessage;

// =============================================================================
// Auth / Token
// =============================================================================

/**
 * Credenciales para obtener un token via /auth.php/token
 */
export interface TokenRequest {
  /** Nombre de usuario */
  username: string;
  /** Contrasena */
  password: string;
}

/**
 * Respuesta de la API al solicitar un token
 */
export interface TokenResponse {
  /** "success" o "error" */
  status: 'success' | 'error';
  /** Token JWT si fue exitoso, mensaje de error si fallo */
  data: string;
}

// =============================================================================
// Request / Response
// =============================================================================

/**
 * Request para enviar mensajes via SimpleTech
 */
export interface SendRequest {
  messages: Message[];
}

/**
 * Resultado individual por mensaje en la respuesta
 */
export interface SendResultItem {
  /** Numero destino */
  number: string;
  /** Canal utilizado */
  channel: string;
  /** ID del mensaje asignado (vacio si hubo error) */
  messageId: string;
  /** Descripcion del error (vacio si fue exitoso) */
  error: string;
}

/**
 * Respuesta de la API de SimpleTech
 */
export interface SendResponse {
  results: SendResultItem[];
}

/**
 * Resultado normalizado para el usuario
 */
export interface SimpleTechResult {
  /** Indica si todos los mensajes fueron exitosos */
  success: boolean;
  /** Resultados individuales por mensaje */
  results: SendResultItem[];
  /** Mensajes que fallaron (con error no vacio) */
  failed: SendResultItem[];
}
