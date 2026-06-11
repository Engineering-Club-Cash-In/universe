/**
 * Credenciales de autenticacion para la API de SimpleTech
 * Podes usar un token ya obtenido, o username+password (el cliente obtiene el token automaticamente)
 */
export type SimpleTechCredentials =
  | { token: string }
  | { username: string; password: string };

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
 * Resultado individual por mensaje en la respuesta (formato raw de la API)
 */
export interface SendResultItemRaw {
  /** Numero destino */
  number: string;
  /** ID del mensaje asignado (objeto con convId) */
  messageId: { convId: string } | string | null;
  /** Descripcion del error (vacio si fue exitoso) */
  error: string;
}

/**
 * Resultado individual normalizado (messageId como string)
 */
export interface SendResultItem {
  /** Numero destino */
  number: string;
  /** Canal utilizado (se completa desde el request, no viene en response) */
  channel?: string;
  /** ID de conversacion normalizado (antes convId) */
  messageId: string;
  /** Descripcion del error (vacio si fue exitoso) */
  error: string;
}

/**
 * Respuesta raw de la API de SimpleTech
 */
export interface SendResponse {
  status: 'success' | 'error';
  data: {
    results: SendResultItemRaw[];
  };
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

// =============================================================================
// getMessageInfo
// =============================================================================

/**
 * Estado de entrega del mensaje
 * - 0: No recibido
 * - 1: Entregado
 * - 2: Visto
 * - 99: Error
 */
export type MessageStatus = 0 | 1 | 2 | 99;

/**
 * Request para consultar informacion de mensajes
 */
export interface GetMessageInfoRequest {
  /** IDs de mensaje a consultar (obtenidos de la respuesta de send) */
  messageIds: string[];
}

/**
 * Informacion de un mensaje consultado
 * (formato real devuelto por la API de WittySuite)
 */
export interface MessageInfo {
  /** ID del mensaje (numero en la respuesta real) */
  messageId: number;
  /** Canal utilizado */
  channel: Channel;
  /** Identificacion del bot origen (alias: fromNumber en doc) */
  serviceIdentifier: string;
  /** Identificacion del cliente destino (alias: toNumber en doc) */
  contactIdentifier: string;
  /** Tipo de mensaje */
  type: MessageType;
  /** Datos enviados (texto del mensaje o payload segun tipo) */
  data: string;
  /** Estado de entrega: 0=no recibido, 1=entregado, 2=visto, 99=error */
  status: MessageStatus;
  /** Timestamp en que fue recibido por Wittybots */
  arrived?: string;
  /** Timestamp del ultimo cambio de estado */
  statusTimeStamp?: string;
  /** Tipo de origen (ej: "E") */
  fromType?: string;
  /** Agente destino */
  toAgent?: number;
  /** Agente externo destino */
  toExternalAgent?: number;
  /** ID del servicio */
  idService?: number;
  /** ID del contacto en el chat */
  idChatUserContact?: number;
  /** Costo del envio */
  cost?: number;
  /** Indica si el destino es otro bot */
  toBot?: boolean;
}

/**
 * Respuesta de getMessageInfo envuelta en formato estandar de la API
 */
export interface GetMessageInfoResponse {
  status: 'success' | 'error';
  data: {
    messages: MessageInfo[];
  };
}

// =============================================================================
// sendTemplate
// =============================================================================

/**
 * Tipos de header soportados por WhatsApp templates
 */
export type TemplateHeaderType = 'text' | 'image' | 'video' | 'document';

/**
 * Header del template (opcional, segun el template creado en admin.wittybots.uy)
 */
export interface TemplateHeader {
  /** Tipo de header */
  type: TemplateHeaderType;
  /** URL del recurso (para image/video/document) o texto (para text) */
  url: string;
  /** Nombre del archivo (opcional, solo para document) */
  filename?: string;
}

/**
 * Configuracion de campana programada
 */
export interface TemplateSchedule {
  /** Fecha de inicio (YYYY-MM-DD) */
  startDate: string;
  /** Hora de inicio (HH:mm) */
  startTime: string;
  /** Hora de fin (HH:mm) */
  endTime: string;
  /** Timezone (ej: "-06:00" para Guatemala) */
  timezone: string;
}

/**
 * Mensaje individual de un envio de template
 */
export interface TemplateMessage {
  /** Numero destino */
  number: string;
  /** Parametros del body del template (reemplazan {{1}}, {{2}}, ...) */
  body?: string[];
  /** Header opcional (si el template lo usa) */
  header?: TemplateHeader;
  /** Parametros de botones (si el template tiene botones CTA dinamicos) */
  buttons?: string[];
}

/**
 * Request de alto nivel para sendTemplate
 */
export interface SendTemplateRequest {
  /** Nombre del template creado en admin.wittybots.uy */
  templateName: string;
  /** Lista de destinatarios con sus parametros */
  messages: TemplateMessage[];
  /** Canal (default: WHATSAPP) */
  channel?: Channel;
  /** Numero origen (default: primer bot registrado) */
  serviceIdentifier?: string;
  /** Campana programada (opcional, si no se manda inmediatamente) */
  schedule?: TemplateSchedule;
}

/**
 * Formato raw de un parametro individual (formato WittySuite)
 */
export type RawTemplateParameter =
  | { message1: string }
  | { message2: string }
  | { message3: string }
  | { message4: string }
  | { message5: string }
  | { message6: string }
  | { message7: string }
  | { message8: string }
  | { message9: string }
  | { message10: string }
  | { headerType: string }
  | { header: string }
  | { filename: string; header: string }
  | { button1: string }
  | { button2: string }
  | { button3: string };

/**
 * Mensaje raw del body de sendTemplate (formato que espera WittySuite)
 */
export interface RawTemplateMessage {
  number: string;
  parameters: RawTemplateParameter[];
}

/**
 * Body raw enviado a /v2.php/sendTemplate
 */
export interface SendTemplateRawBody {
  startDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
  templateName: string;
  channel?: string;
  serviceIdentifier?: string;
  messages: RawTemplateMessage[];
}

/**
 * Resultado individual por destinatario (formato raw API)
 */
export interface SendTemplateResultItemRaw {
  number: string;
  templateMessageId: string;
  error: string;
}

/**
 * Respuesta raw de /v2.php/sendTemplate
 * Puede venir como {results: [...]} o {status, data: {results: [...]}}
 */
export interface SendTemplateResponse {
  status?: 'success' | 'error';
  results?: SendTemplateResultItemRaw[];
  data?: {
    results?: SendTemplateResultItemRaw[];
  };
}

/**
 * Resultado individual normalizado
 */
export interface SendTemplateResultItem {
  number: string;
  templateMessageId: string;
  error: string;
}

/**
 * Resultado normalizado de sendTemplate
 */
export interface SendTemplateResult {
  success: boolean;
  results: SendTemplateResultItem[];
  failed: SendTemplateResultItem[];
}
