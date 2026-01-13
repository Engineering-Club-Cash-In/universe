/**
 * @repo/sms - Cliente para la API de BroadcasterMobile SMS
 *
 * @example
 * ```typescript
 * import { SMSClient } from '@repo/sms';
 *
 * const client = new SMSClient({
 *   token: 'your-auth-token',
 *   apiKey: 22
 * });
 *
 * // Enviar SMS
 * const result = await client.send({
 *   msisdns: ['525512345678'],
 *   message: 'Hola mundo!',
 *   country: 'MX',
 *   tag: 'test-campaign'
 * });
 *
 * console.log(result.mailingId);
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Cliente principal
// =============================================================================

export { SMSClient, createClientFromEnv } from './src/client';

// =============================================================================
// Tipos
// =============================================================================

export type {
  // Configuracion
  SMSCredentials,
  SMSConfig,
  RetryConfig,
  // Request/Response
  SendSMSRequest,
  SendSMSResponse,
  SendSMSSuccessResponse,
  SendSMSErrorResponse,
  SMSResult,
  SMSAPIRequest,
  // Enums y constantes de tipo
  Carrier,
  MessageClass,
  RegisteredDelivery,
  SMSErrorCode,
  SMSErrorInfo,
} from './src/types';

// =============================================================================
// Errores
// =============================================================================

export {
  SMSError,
  AuthenticationError,
  ValidationError,
  ConnectionError,
  InsufficientCreditError,
  ERROR_MESSAGES,
  // Discriminadores
  isSMSError,
  isAuthenticationError,
  isValidationError,
  isConnectionError,
  isInsufficientCreditError,
  isRetryableError,
} from './src/errors';

// =============================================================================
// Validadores (para uso avanzado)
// =============================================================================

export {
  validateMsisdn,
  validateMsisdns,
  validateCountry,
  validateMessage,
  validateTag,
  validateSchedule,
  validateApiKey,
  validateSendSMSRequest,
  calculateMessageSegments,
  MAX_MESSAGE_LENGTH,
  MAX_CONCATENATED_SEGMENT,
  MSISDN_PATTERN,
  ISO2_PATTERN,
} from './src/validators';
