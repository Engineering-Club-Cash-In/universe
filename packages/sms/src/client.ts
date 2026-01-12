import type {
  SMSCredentials,
  SMSConfig,
  SendSMSRequest,
  SendSMSResponse,
  SendSMSSuccessResponse,
  SMSResult,
  RetryConfig,
  SMSAPIRequest,
  RegisteredDelivery,
} from './types';
import {
  SMSError,
  ConnectionError,
  ValidationError,
} from './errors';
import {
  validateSendSMSRequest,
  validateApiKey,
} from './validators';

// =============================================================================
// Constantes
// =============================================================================

const DEFAULT_BASE_URL = 'https://api.broadcastermobile.com';
const DEFAULT_ENDPOINT = '/brdcstr-endpoint-web/services/messaging/';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
};

// =============================================================================
// Cliente SMS
// =============================================================================

/**
 * Cliente para la API de BroadcasterMobile SMS
 *
 * @example
 * ```typescript
 * const client = new SMSClient({
 *   token: 'your-auth-token',
 *   apiKey: 22
 * });
 *
 * const result = await client.send({
 *   msisdns: ['525512345678'],
 *   message: 'Hola!',
 *   country: 'MX',
 *   tag: 'test'
 * });
 * ```
 */
export class SMSClient {
  private readonly credentials: SMSCredentials;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retryConfig?: RetryConfig;

  /**
   * Crea una nueva instancia del cliente SMS
   * @param config Configuracion del cliente o credenciales directas
   */
  constructor(config: SMSConfig | SMSCredentials) {
    if ('credentials' in config) {
      this.credentials = config.credentials;
      this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
      this.timeout = config.timeout || DEFAULT_TIMEOUT;
      this.retryConfig = config.retry;
    } else {
      this.credentials = config;
      this.baseUrl = DEFAULT_BASE_URL;
      this.timeout = DEFAULT_TIMEOUT;
    }

    // Validar credenciales
    if (!this.credentials.token) {
      throw new ValidationError('Token de autorizacion es requerido', 'token');
    }
    validateApiKey(this.credentials.apiKey);
  }

  /**
   * Envia un SMS a uno o multiples destinatarios
   * @param request Datos del SMS a enviar
   * @returns Resultado del envio con mailingId si fue exitoso
   */
  async send(request: SendSMSRequest): Promise<SMSResult> {
    validateSendSMSRequest(request);

    const apiRequest = this.buildAPIRequest(request);
    const response = await this.executeRequest(apiRequest);

    return this.processResponse(response);
  }

  /**
   * Programa un SMS para envio futuro
   * @param request Datos del SMS a enviar
   * @param scheduleDate Fecha y hora de envio (Date o string ISO-8601)
   * @returns Resultado del envio con mailingId si fue exitoso
   */
  async schedule(request: SendSMSRequest, scheduleDate: Date | string): Promise<SMSResult> {
    const scheduledRequest: SendSMSRequest = {
      ...request,
      schedule: scheduleDate instanceof Date
        ? scheduleDate.toISOString()
        : scheduleDate,
    };

    return this.send(scheduledRequest);
  }

  /**
   * Envia un SMS con confirmacion de entrega (Delivery Receipt)
   * @param request Datos del SMS a enviar
   * @param registeredDelivery Tipo de notificacion (1, 5, o 11)
   * @returns Resultado del envio con mailingId si fue exitoso
   */
  async sendWithDeliveryReceipt(
    request: SendSMSRequest,
    registeredDelivery: RegisteredDelivery = 5
  ): Promise<SMSResult> {
    const dlrRequest: SendSMSRequest = {
      ...request,
      dlr: true,
      registeredDelivery,
    };

    return this.send(dlrRequest);
  }

  /**
   * Construye el request para la API
   */
  private buildAPIRequest(request: SendSMSRequest): SMSAPIRequest {
    const apiRequest: SMSAPIRequest = {
      apiKey: this.credentials.apiKey,
      msisdns: request.msisdns,
      message: request.message,
      country: request.country.toUpperCase(),
      tag: request.tag,
    };

    // Campos opcionales
    if (request.dial !== undefined) {
      apiRequest.dial = request.dial;
    }
    if (request.carrier) {
      apiRequest.carrier = request.carrier;
    }
    if (request.mask) {
      apiRequest.mask = request.mask;
    }
    if (request.msgClass !== undefined) {
      apiRequest.msgClass = request.msgClass;
    }
    if (request.schedule) {
      apiRequest.schedule = request.schedule instanceof Date
        ? request.schedule.toISOString()
        : request.schedule;
    }
    if (request.dlr !== undefined) {
      apiRequest.dlr = request.dlr;
      if (request.registeredDelivery) {
        apiRequest.optionals = JSON.stringify({
          registeredDelivery: request.registeredDelivery,
        });
      }
    }

    return apiRequest;
  }

  /**
   * Ejecuta la peticion HTTP con retry opcional
   */
  private async executeRequest(request: SMSAPIRequest): Promise<SendSMSResponse> {
    const url = `${this.baseUrl}${DEFAULT_ENDPOINT}`;

    const makeRequest = async (): Promise<SendSMSResponse> => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.credentials.token,
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(this.timeout),
        });

        const responseText = await response.text();

        if (!response.ok) {
          throw new ConnectionError(
            `Error HTTP ${response.status}: ${response.statusText}`,
            response.status,
            responseText
          );
        }

        return JSON.parse(responseText) as SendSMSResponse;
      } catch (error) {
        if (error instanceof ConnectionError) {
          throw error;
        }

        if ((error as Error).name === 'TimeoutError' ||
            (error as Error).name === 'AbortError') {
          throw new ConnectionError(
            `Timeout: La peticion excedio ${this.timeout}ms`
          );
        }

        if ((error as Error).name === 'SyntaxError') {
          throw new ConnectionError('Respuesta JSON invalida del servidor');
        }

        throw new ConnectionError(
          `Error de conexion: ${(error as Error).message}`
        );
      }
    };

    // Sin retry
    if (!this.retryConfig) {
      return makeRequest();
    }

    // Con retry y exponential backoff
    return this.withRetry(makeRequest);
  }

  /**
   * Ejecuta una funcion con reintentos y exponential backoff
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const config = this.retryConfig || DEFAULT_RETRY_CONFIG;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Solo reintentar errores de conexion
        if (!(error instanceof ConnectionError)) {
          throw error;
        }

        // Ultimo intento, no esperar
        if (attempt === config.maxRetries) {
          break;
        }

        // Calcular delay con exponential backoff
        const delay = Math.min(
          config.baseDelay * Math.pow(2, attempt),
          config.maxDelay
        );

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Procesa la respuesta de la API
   */
  private processResponse(response: SendSMSResponse): SMSResult {
    if (response.code === 0) {
      const successResponse = response as SendSMSSuccessResponse;
      return {
        success: true,
        mailingId: successResponse.mailingId,
      };
    }

    // La API retorno un error
    const errorResponse = response as { code: number; hint: string; message: string };
    throw SMSError.fromResponse(errorResponse);
  }

  /**
   * Utility para esperar un tiempo
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Factory function
// =============================================================================

/**
 * Crea un cliente SMS usando variables de entorno
 *
 * Variables requeridas:
 * - SMS_TOKEN: Token de autorizacion
 * - SMS_API_KEY: ID del cliente (numerico)
 *
 * Variables opcionales:
 * - SMS_BASE_URL: URL base de la API
 * - SMS_TIMEOUT: Timeout en milisegundos
 * - SMS_MAX_RETRIES: Numero maximo de reintentos
 *
 * @returns Nueva instancia de SMSClient
 * @throws ValidationError si faltan variables requeridas
 */
export function createClientFromEnv(): SMSClient {
  const token = process.env.SMS_TOKEN;
  const apiKeyStr = process.env.SMS_API_KEY;

  if (!token) {
    throw new ValidationError(
      'Variable de entorno SMS_TOKEN es requerida'
    );
  }

  if (!apiKeyStr) {
    throw new ValidationError(
      'Variable de entorno SMS_API_KEY es requerida'
    );
  }

  const apiKey = parseInt(apiKeyStr, 10);
  if (isNaN(apiKey)) {
    throw new ValidationError(
      'SMS_API_KEY debe ser un numero valido'
    );
  }

  const config: SMSConfig = {
    credentials: { token, apiKey },
    baseUrl: process.env.SMS_BASE_URL,
    timeout: process.env.SMS_TIMEOUT
      ? parseInt(process.env.SMS_TIMEOUT, 10)
      : undefined,
  };

  // Configuracion de retry opcional
  const maxRetries = process.env.SMS_MAX_RETRIES;
  if (maxRetries) {
    config.retry = {
      maxRetries: parseInt(maxRetries, 10),
      baseDelay: 1000,
      maxDelay: 10000,
    };
  }

  return new SMSClient(config);
}
