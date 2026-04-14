/**
 * @repo/simpletech - Cliente multi-canal para la API de SimpleTech
 *
 * Soporta: WhatsApp, SMS, Web, Facebook, Instagram
 * Tipos: message, location, document, image, video, sound
 *
 * @example
 * ```typescript
 * import { SimpleTechClient } from '@repo/simpletech';
 *
 * const client = new SimpleTechClient({
 *   credentials: { token: 'your-token' },
 *   baseUrl: 'https://your-instance.simpletech.com'
 * });
 *
 * // Enviar mensaje de texto por WhatsApp
 * const result = await client.sendText('+50212345678', 'WHATSAPP', 'Hola!');
 *
 * // Enviar multiples mensajes
 * const result = await client.send([
 *   { number: '+50212345678', channel: 'WHATSAPP', type: 'message', text: 'Hola!' },
 *   { number: '+50212345678', channel: 'SMS', type: 'message', text: 'Hola SMS!' },
 * ]);
 *
 * // Enviar documento
 * const result = await client.sendDocument(
 *   '+50212345678',
 *   'WHATSAPP',
 *   'reporte.pdf',
 *   { url: 'https://example.com/reporte.pdf' }
 * );
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Cliente principal
// =============================================================================

export { SimpleTechClient, createClientFromEnv } from './src/client';

// =============================================================================
// Tipos
// =============================================================================

export type {
  // Configuracion
  SimpleTechCredentials,
  SimpleTechConfig,
  RetryConfig,
  TokenResponse,
  // Canales y tipos
  Channel,
  MessageType,
  // Mensajes
  Message,
  TextMessage,
  LocationMessage,
  DocumentMessage,
  ImageMessage,
  VideoMessage,
  AudioMessage,
  // Request/Response
  SendRequest,
  SendResponse,
  SendResultItem,
  SendResultItemRaw,
  SimpleTechResult,
  // getMessageInfo
  GetMessageInfoRequest,
  GetMessageInfoResponse,
  MessageInfo,
  MessageStatus,
  // sendTemplate
  SendTemplateRequest,
  SendTemplateResponse,
  SendTemplateResult,
  SendTemplateResultItem,
  TemplateMessage,
  TemplateHeader,
  TemplateHeaderType,
  TemplateSchedule,
} from './src/types';

// =============================================================================
// Errores
// =============================================================================

export {
  SimpleTechError,
  ValidationError,
  ConnectionError,
  PartialSendError,
  // Discriminadores
  isSimpleTechError,
  isValidationError,
  isConnectionError,
  isPartialSendError,
  isRetryableError,
} from './src/errors';

// =============================================================================
// Validadores (para uso avanzado)
// =============================================================================

export {
  validateNumber,
  validateChannel,
  validateType,
  validateMessage,
  validateMessages,
} from './src/validators';
