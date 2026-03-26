import type {
  SimpleTechCredentials,
  SimpleTechConfig,
  Message,
  SendRequest,
  SendResponse,
  SimpleTechResult,
  RetryConfig,
} from './types';
import {
  SimpleTechError,
  ConnectionError,
  ValidationError,
} from './errors';
import { validateMessages } from './validators';

// =============================================================================
// Constantes
// =============================================================================

const DEFAULT_ENDPOINT = '/v2.php/send';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
};

// =============================================================================
// Cliente SimpleTech
// =============================================================================

/**
 * Cliente para la API de SimpleTech (multi-canal: WhatsApp, SMS, Web, Facebook, Instagram)
 *
 * @example
 * ```typescript
 * const client = new SimpleTechClient({
 *   credentials: { token: 'your-token' },
 *   baseUrl: 'https://your-instance.simpletech.com'
 * });
 *
 * const result = await client.send([
 *   {
 *     number: '+50212345678',
 *     channel: 'WHATSAPP',
 *     type: 'message',
 *     text: 'Hola!'
 *   }
 * ]);
 * ```
 */
export class SimpleTechClient {
  private readonly credentials: SimpleTechCredentials;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retryConfig?: RetryConfig;

  constructor(config: SimpleTechConfig) {
    this.credentials = config.credentials;
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.retryConfig = config.retry;

    if (!this.credentials.token) {
      throw new ValidationError('Token de autorizacion es requerido', 'token');
    }

    if (!this.baseUrl) {
      throw new ValidationError('baseUrl es requerido', 'baseUrl');
    }
  }

  /**
   * Envia uno o multiples mensajes a traves de cualquier canal
   * @param messages Array de mensajes a enviar
   * @returns Resultado con estado individual por mensaje
   */
  async send(messages: Message[]): Promise<SimpleTechResult> {
    validateMessages(messages);

    const request: SendRequest = { messages };
    const response = await this.executeRequest(request);

    return this.processResponse(response);
  }

  /**
   * Envia un mensaje de texto simple
   */
  async sendText(
    number: string,
    channel: Message['channel'],
    text: string,
    options?: { serviceIdentifier?: string; idBot?: string }
  ): Promise<SimpleTechResult> {
    return this.send([{
      number,
      channel,
      type: 'message',
      text,
      ...options,
    }]);
  }

  /**
   * Envia una ubicacion via WhatsApp
   */
  async sendLocation(
    number: string,
    lat: string,
    lng: string,
    options?: { channel?: Message['channel']; serviceIdentifier?: string; idBot?: string }
  ): Promise<SimpleTechResult> {
    return this.send([{
      number,
      channel: options?.channel || 'WHATSAPP',
      type: 'location',
      lat,
      lng,
      serviceIdentifier: options?.serviceIdentifier,
      idBot: options?.idBot,
    }]);
  }

  /**
   * Envia un documento
   */
  async sendDocument(
    number: string,
    channel: Message['channel'],
    name: string,
    source: { url: string } | { base64: string },
    options?: { serviceIdentifier?: string; idBot?: string }
  ): Promise<SimpleTechResult> {
    return this.send([{
      number,
      channel,
      type: 'document',
      name,
      ...source,
      ...options,
    }]);
  }

  /**
   * Envia una imagen
   */
  async sendImage(
    number: string,
    channel: Message['channel'],
    source: { url: string } | { base64: string },
    options?: { caption?: string; serviceIdentifier?: string; idBot?: string }
  ): Promise<SimpleTechResult> {
    return this.send([{
      number,
      channel,
      type: 'image',
      ...source,
      ...options,
    }]);
  }

  /**
   * Envia un video
   */
  async sendVideo(
    number: string,
    channel: Message['channel'],
    source: { url: string } | { base64: string },
    options?: { name?: string; caption?: string; serviceIdentifier?: string; idBot?: string }
  ): Promise<SimpleTechResult> {
    return this.send([{
      number,
      channel,
      type: 'video',
      ...source,
      ...options,
    }]);
  }

  /**
   * Envia un audio
   */
  async sendAudio(
    number: string,
    channel: Message['channel'],
    source: { url: string } | { base64: string },
    options?: { name?: string; serviceIdentifier?: string; idBot?: string }
  ): Promise<SimpleTechResult> {
    return this.send([{
      number,
      channel,
      type: 'sound',
      ...source,
      ...options,
    }]);
  }

  // ===========================================================================
  // Privados
  // ===========================================================================

  private async executeRequest(request: SendRequest): Promise<SendResponse> {
    const url = `${this.baseUrl}${DEFAULT_ENDPOINT}`;

    const makeRequest = async (): Promise<SendResponse> => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'token': this.credentials.token,
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

        return JSON.parse(responseText) as SendResponse;
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

    if (!this.retryConfig) {
      return makeRequest();
    }

    return this.withRetry(makeRequest);
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const config = this.retryConfig || DEFAULT_RETRY_CONFIG;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (!(error instanceof ConnectionError)) {
          throw error;
        }

        if (attempt === config.maxRetries) {
          break;
        }

        const delay = Math.min(
          config.baseDelay * Math.pow(2, attempt),
          config.maxDelay
        );

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private processResponse(response: SendResponse): SimpleTechResult {
    const failed = response.results.filter(r => r.error !== '');

    return {
      success: failed.length === 0,
      results: response.results,
      failed,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Factory function
// =============================================================================

/**
 * Crea un cliente SimpleTech usando variables de entorno
 *
 * Variables requeridas:
 * - SIMPLETECH_TOKEN: Token de autorizacion
 * - SIMPLETECH_BASE_URL: URL base de la API
 *
 * Variables opcionales:
 * - SIMPLETECH_TIMEOUT: Timeout en milisegundos
 * - SIMPLETECH_MAX_RETRIES: Numero maximo de reintentos
 */
export function createClientFromEnv(): SimpleTechClient {
  const token = process.env.SIMPLETECH_TOKEN;
  const baseUrl = process.env.SIMPLETECH_BASE_URL;

  if (!token) {
    throw new ValidationError(
      'Variable de entorno SIMPLETECH_TOKEN es requerida'
    );
  }

  if (!baseUrl) {
    throw new ValidationError(
      'Variable de entorno SIMPLETECH_BASE_URL es requerida'
    );
  }

  const config: SimpleTechConfig = {
    credentials: { token },
    baseUrl,
    timeout: process.env.SIMPLETECH_TIMEOUT
      ? parseInt(process.env.SIMPLETECH_TIMEOUT, 10)
      : undefined,
  };

  const maxRetries = process.env.SIMPLETECH_MAX_RETRIES;
  if (maxRetries) {
    config.retry = {
      maxRetries: parseInt(maxRetries, 10),
      baseDelay: 1000,
      maxDelay: 10000,
    };
  }

  return new SimpleTechClient(config);
}
