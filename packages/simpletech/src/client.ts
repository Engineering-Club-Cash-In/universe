import type {
  SimpleTechCredentials,
  SimpleTechConfig,
  Message,
  SendRequest,
  SendResponse,
  SendResultItem,
  SimpleTechResult,
  RetryConfig,
  GetMessageInfoRequest,
  GetMessageInfoResponse,
  MessageInfo,
  TokenRequest,
  TokenResponse,
  SendTemplateRequest,
  SendTemplateRawBody,
  RawTemplateMessage,
  RawTemplateParameter,
  SendTemplateResponse,
  SendTemplateResult,
  SendTemplateResultItem,
  TemplateMessage,
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

const SEND_ENDPOINT = '/v2.php/send';
const SEND_TEMPLATE_ENDPOINT = '/v2.php/sendTemplate';
const GET_MESSAGE_INFO_ENDPOINT = '/v2.php/getMessageInfo';
const AUTH_ENDPOINT = '/auth.php/token';
const DEFAULT_TIMEZONE = '-06:00';
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
  private cachedToken?: string;

  constructor(config: SimpleTechConfig) {
    this.credentials = config.credentials;
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.retryConfig = config.retry;

    if (!this.baseUrl) {
      throw new ValidationError('baseUrl es requerido', 'baseUrl');
    }

    if ('token' in this.credentials) {
      if (!this.credentials.token) {
        throw new ValidationError('Token de autorizacion es requerido', 'token');
      }
      this.cachedToken = this.credentials.token;
    } else {
      if (!this.credentials.username || !this.credentials.password) {
        throw new ValidationError('username y password son requeridos', 'credentials');
      }
    }
  }

  /**
   * Obtiene un nuevo token desde /auth.php/token usando username y password
   *
   * Segun la doc de SimpleTech:
   * - Cada llamada genera un nuevo token (el anterior queda invalido)
   * - El token es valido por 7 dias
   */
  async fetchToken(): Promise<string> {
    if ('token' in this.credentials) {
      return this.credentials.token;
    }

    const url = `${this.baseUrl}${AUTH_ENDPOINT}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'username': this.credentials.username,
          'password': this.credentials.password,
        },
        signal: AbortSignal.timeout(this.timeout),
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new ConnectionError(
          `Error obteniendo token: HTTP ${response.status}`,
          response.status,
          responseText
        );
      }

      const parsed = JSON.parse(responseText) as TokenResponse;

      if (parsed.status !== 'success' || !parsed.data) {
        throw new SimpleTechError(`Auth fallida: ${parsed.data || 'respuesta invalida'}`);
      }

      this.cachedToken = parsed.data;
      return this.cachedToken;
    } catch (error) {
      if (error instanceof SimpleTechError || error instanceof ConnectionError) {
        throw error;
      }
      throw new ConnectionError(`Error de auth: ${(error as Error).message}`);
    }
  }

  /**
   * Obtiene el token cacheado, o lo pide si todavia no se obtuvo
   */
  private async getToken(): Promise<string> {
    if (this.cachedToken) {
      return this.cachedToken;
    }
    return this.fetchToken();
  }

  /**
   * Fuerza renovar el token (util si expiro)
   */
  async refreshToken(): Promise<string> {
    this.cachedToken = undefined;
    return this.fetchToken();
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
   * Version raw del send (util para debugging del formato real de respuesta)
   */
  async sendRaw(messages: Message[]): Promise<unknown> {
    validateMessages(messages);
    const request: SendRequest = { messages };
    return this.executeRequest(request);
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

  /**
   * Consulta el estado y detalles de mensajes previamente enviados
   * @param messageIds IDs de los mensajes (obtenidos de la respuesta de send)
   * @returns Array con la informacion de cada mensaje
   *
   * @example
   * ```typescript
   * const info = await client.getMessageInfo(['1234', '747474']);
   * info.forEach(m => console.log(m.messageId, m.status));
   * ```
   */
  async getMessageInfo(messageIds: string[]): Promise<MessageInfo[]> {
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      throw new ValidationError('messageIds no puede estar vacio', 'messageIds');
    }

    const request: GetMessageInfoRequest = { messageIds };
    const response = await this.executeInfoRequest(request);

    if (response.status !== 'success') {
      throw new SimpleTechError(
        `getMessageInfo fallo: ${JSON.stringify(response.data)}`
      );
    }

    return response.data.messages || [];
  }

  /**
   * Version raw: devuelve la respuesta sin procesar (util para debugging)
   */
  async getMessageInfoRaw(messageIds: string[]): Promise<unknown> {
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      throw new ValidationError('messageIds no puede estar vacio', 'messageIds');
    }
    const request: GetMessageInfoRequest = { messageIds };
    return this.executeInfoRequest(request);
  }

  // ===========================================================================
  // sendTemplate
  // ===========================================================================

  /**
   * Envia un template de WhatsApp pre-aprobado por Meta.
   *
   * A diferencia de `send()`, los templates pueden iniciar conversaciones con
   * cualquier numero sin necesidad de tener una "ventana de 24h" abierta.
   *
   * El template debe existir previamente en admin.wittybots.uy y estar
   * aprobado por Meta.
   *
   * @example
   * ```typescript
   * await client.sendTemplate({
   *   templateName: 'credito_aprobado',
   *   serviceIdentifier: '50234849518',
   *   messages: [
   *     {
   *       number: '50257099747',
   *       body: ['Daniel', '50000', 'https://cci.gt/firma/abc']
   *     }
   *   ]
   * });
   * ```
   */
  async sendTemplate(request: SendTemplateRequest): Promise<SendTemplateResult> {
    this.validateTemplateRequest(request);

    const rawBody = this.buildTemplateRawBody(request);
    const response = await this.post<SendTemplateResponse>(SEND_TEMPLATE_ENDPOINT, rawBody);

    return this.processTemplateResponse(response);
  }

  /**
   * Version raw del sendTemplate (util para debugging del formato real de respuesta)
   */
  async sendTemplateRaw(request: SendTemplateRequest): Promise<unknown> {
    this.validateTemplateRequest(request);
    const rawBody = this.buildTemplateRawBody(request);
    return this.post<unknown>(SEND_TEMPLATE_ENDPOINT, rawBody);
  }

  private validateTemplateRequest(request: SendTemplateRequest): void {
    if (!request.templateName || request.templateName.trim().length === 0) {
      throw new ValidationError('templateName es requerido', 'templateName');
    }
    if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
      throw new ValidationError('messages no puede estar vacio', 'messages');
    }
    request.messages.forEach((m, i) => {
      if (!m.number || m.number.trim().length === 0) {
        throw new ValidationError(`messages[${i}].number es requerido`, 'number');
      }
    });
  }

  /**
   * Transforma un TemplateMessage (API limpia) a RawTemplateMessage (formato WittySuite)
   */
  private buildTemplateRawBody(request: SendTemplateRequest): SendTemplateRawBody {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    const schedule = request.schedule || {
      startDate: today,
      startTime: '00:00',
      endTime: '23:55',
      timezone: DEFAULT_TIMEZONE,
    };

    const rawMessages: RawTemplateMessage[] = request.messages.map(m =>
      this.buildRawTemplateMessage(m)
    );

    const body: SendTemplateRawBody = {
      startDate: schedule.startDate,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      timezone: schedule.timezone,
      templateName: request.templateName,
      messages: rawMessages,
    };

    if (request.channel) {
      body.channel = request.channel.toUpperCase();
    }
    if (request.serviceIdentifier) {
      body.serviceIdentifier = request.serviceIdentifier;
    }

    return body;
  }

  private buildRawTemplateMessage(msg: TemplateMessage): RawTemplateMessage {
    const parameters: RawTemplateParameter[] = [];

    // Body params: body[0] → {message1}, body[1] → {message2}, ...
    if (msg.body && msg.body.length > 0) {
      msg.body.forEach((value, idx) => {
        const key = `message${idx + 1}`;
        parameters.push({ [key]: value } as RawTemplateParameter);
      });
    }

    // Header
    if (msg.header) {
      parameters.push({ headerType: msg.header.type });
      if (msg.header.filename) {
        parameters.push({ filename: msg.header.filename, header: msg.header.url });
      } else {
        parameters.push({ header: msg.header.url });
      }
    }

    // Botones: buttons[0] → {button1}, ...
    if (msg.buttons && msg.buttons.length > 0) {
      msg.buttons.forEach((value, idx) => {
        const key = `button${idx + 1}`;
        parameters.push({ [key]: value } as RawTemplateParameter);
      });
    }

    return {
      number: msg.number,
      parameters,
    };
  }

  private processTemplateResponse(response: SendTemplateResponse): SendTemplateResult {
    if (response.status === 'error') {
      throw new SimpleTechError(
        `sendTemplate fallo: ${JSON.stringify(response.data || response)}`
      );
    }

    // Soporta tanto {results: [...]} como {data: {results: [...]}}
    const rawResults =
      response.results ||
      response.data?.results ||
      [];

    const results: SendTemplateResultItem[] = rawResults.map(r => ({
      number: r.number,
      templateMessageId: r.templateMessageId || '',
      error: r.error || '',
    }));

    const failed = results.filter(r => r.error !== '');

    return {
      success: failed.length === 0 && results.length > 0,
      results,
      failed,
    };
  }

  private executeRequest(request: SendRequest): Promise<SendResponse> {
    return this.post<SendResponse>(SEND_ENDPOINT, request);
  }

  private executeInfoRequest(request: GetMessageInfoRequest): Promise<GetMessageInfoResponse> {
    return this.post<GetMessageInfoResponse>(GET_MESSAGE_INFO_ENDPOINT, request);
  }

  private async post<T>(endpoint: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const makeRequest = async (): Promise<T> => {
      const token = await this.getToken();

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'token': token,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeout),
        });

        const responseText = await response.text();

        if (!response.ok) {
          // Si el token expiro y tenemos username/password, reintenta una vez
          if (
            response.status === 400 &&
            responseText.toLowerCase().includes('token') &&
            !('token' in this.credentials)
          ) {
            await this.refreshToken();
            const retryResponse = await fetch(url, {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'token': this.cachedToken!,
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(this.timeout),
            });
            const retryText = await retryResponse.text();
            if (!retryResponse.ok) {
              throw new ConnectionError(
                `Error HTTP ${retryResponse.status}: ${retryResponse.statusText}`,
                retryResponse.status,
                retryText
              );
            }
            return JSON.parse(retryText) as T;
          }

          throw new ConnectionError(
            `Error HTTP ${response.status}: ${response.statusText}`,
            response.status,
            responseText
          );
        }

        return JSON.parse(responseText) as T;
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
    if (response.status === 'error') {
      throw new SimpleTechError(
        `send fallo: ${JSON.stringify(response.data)}`
      );
    }

    const rawResults = response.data?.results || [];

    // Normaliza messageId: puede venir como {convId: "..."} o string
    const results: SendResultItem[] = rawResults.map(r => ({
      number: r.number,
      messageId: this.extractMessageId(r.messageId),
      error: r.error || '',
    }));

    const failed = results.filter(r => r.error !== '');

    return {
      success: failed.length === 0 && results.length > 0,
      results,
      failed,
    };
  }

  private extractMessageId(raw: { convId: string } | string | null | undefined): string {
    if (!raw) return '';
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object' && 'convId' in raw) return String(raw.convId);
    return '';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Autenticacion
// =============================================================================

/**
 * Obtiene un token de autenticacion para la API de SimpleTech
 *
 * El token es valido por 7 dias. Cada vez que se genera uno nuevo, el anterior se invalida.
 *
 * @example
 * ```typescript
 * const token = await getToken('https://your-instance.simpletech.com', {
 *   username: 'user',
 *   password: 'pass',
 * });
 *
 * const client = new SimpleTechClient({
 *   credentials: { token },
 *   baseUrl: 'https://your-instance.simpletech.com',
 * });
 * ```
 */
export async function getToken(
  baseUrl: string,
  credentials: TokenRequest,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<string> {
  if (!baseUrl) {
    throw new ValidationError('baseUrl es requerido', 'baseUrl');
  }
  if (!credentials.username) {
    throw new ValidationError('username es requerido', 'username');
  }
  if (!credentials.password) {
    throw new ValidationError('password es requerido', 'password');
  }

  const url = `${baseUrl}${AUTH_ENDPOINT}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'username': credentials.username,
        'password': credentials.password,
      },
      signal: AbortSignal.timeout(timeout),
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new ConnectionError(
        `Error HTTP ${response.status}: ${response.statusText}`,
        response.status,
        responseText,
      );
    }

    const data = JSON.parse(responseText) as TokenResponse;

    if (data.status !== 'success') {
      throw new SimpleTechError(`Error al obtener token: ${data.data}`);
    }

    return data.data;
  } catch (error) {
    if (error instanceof SimpleTechError) {
      throw error;
    }

    if ((error as Error).name === 'TimeoutError' ||
        (error as Error).name === 'AbortError') {
      throw new ConnectionError(`Timeout: La peticion excedio ${timeout}ms`);
    }

    if ((error as Error).name === 'SyntaxError') {
      throw new ConnectionError('Respuesta JSON invalida del servidor');
    }

    throw new ConnectionError(
      `Error de conexion: ${(error as Error).message}`
    );
  }
}

// =============================================================================
// Factory function
// =============================================================================

/**
 * Crea un cliente SimpleTech usando variables de entorno
 *
 * Variables requeridas:
 * - SIMPLETECH_BASE_URL: URL base de la API
 * - Autenticacion (usar una u otra):
 *   - SIMPLETECH_TOKEN: Token ya obtenido
 *   - SIMPLETECH_USERNAME + SIMPLETECH_PASSWORD: el cliente obtiene el token automaticamente
 *
 * Variables opcionales:
 * - SIMPLETECH_TIMEOUT: Timeout en milisegundos
 * - SIMPLETECH_MAX_RETRIES: Numero maximo de reintentos
 */
export function createClientFromEnv(): SimpleTechClient {
  const token = process.env.SIMPLETECH_TOKEN;
  const username = process.env.SIMPLETECH_USERNAME;
  const password = process.env.SIMPLETECH_PASSWORD;
  const baseUrl = process.env.SIMPLETECH_BASE_URL;

  if (!baseUrl) {
    throw new ValidationError(
      'Variable de entorno SIMPLETECH_BASE_URL es requerida'
    );
  }

  let credentials: SimpleTechCredentials;
  if (token) {
    credentials = { token };
  } else if (username && password) {
    credentials = { username, password };
  } else {
    throw new ValidationError(
      'Debes proveer SIMPLETECH_TOKEN, o SIMPLETECH_USERNAME + SIMPLETECH_PASSWORD'
    );
  }

  const config: SimpleTechConfig = {
    credentials,
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
