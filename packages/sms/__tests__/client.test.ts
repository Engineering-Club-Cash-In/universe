import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SMSClient, createClientFromEnv } from '../src/client';
import {
  SMSError,
  AuthenticationError,
  ValidationError,
  ConnectionError,
  InsufficientCreditError,
  isSMSError,
  isAuthenticationError,
  isConnectionError,
  isInsufficientCreditError,
  isValidationError,
  isRetryableError,
} from '../src/errors';
import {
  TEST_CREDENTIALS,
  VALID_SMS_REQUEST,
  DLR_REQUEST,
} from './fixtures/test-data';
import {
  SUCCESS_RESPONSE,
  AUTH_ERROR_RESPONSE,
  INSUFFICIENT_CREDIT_RESPONSE,
  SERVER_ERROR_RESPONSE,
} from './fixtures/responses';

describe('SMSClient', () => {
  describe('constructor', () => {
    it('deberia crear cliente con credenciales directas', () => {
      const client = new SMSClient(TEST_CREDENTIALS);
      expect(client).toBeDefined();
    });

    it('deberia crear cliente con config completa', () => {
      const client = new SMSClient({
        credentials: TEST_CREDENTIALS,
        baseUrl: 'https://custom.api.com',
        timeout: 5000,
        retry: { maxRetries: 2, baseDelay: 500, maxDelay: 5000 },
      });
      expect(client).toBeDefined();
    });

    it('deberia lanzar ValidationError sin token', () => {
      expect(() => new SMSClient({ token: '', apiKey: 22 })).toThrow(ValidationError);
    });

    it('deberia lanzar ValidationError con apiKey invalido (0)', () => {
      expect(() => new SMSClient({ token: 'test', apiKey: 0 })).toThrow(ValidationError);
    });

    it('deberia lanzar ValidationError con apiKey negativo', () => {
      expect(() => new SMSClient({ token: 'test', apiKey: -1 })).toThrow(ValidationError);
    });

    it('deberia lanzar ValidationError con apiKey decimal', () => {
      expect(() => new SMSClient({ token: 'test', apiKey: 22.5 })).toThrow(ValidationError);
    });
  });

  describe('createClientFromEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      process.env.SMS_TOKEN = 'env-token';
      process.env.SMS_API_KEY = '22';
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('deberia crear cliente desde variables de entorno', () => {
      const client = createClientFromEnv();
      expect(client).toBeDefined();
    });

    it('deberia lanzar error sin SMS_TOKEN', () => {
      delete process.env.SMS_TOKEN;
      expect(() => createClientFromEnv()).toThrow(ValidationError);
    });

    it('deberia lanzar error sin SMS_API_KEY', () => {
      delete process.env.SMS_API_KEY;
      expect(() => createClientFromEnv()).toThrow(ValidationError);
    });

    it('deberia lanzar error con SMS_API_KEY no numerico', () => {
      process.env.SMS_API_KEY = 'not-a-number';
      expect(() => createClientFromEnv()).toThrow(ValidationError);
    });

    it('deberia usar variables opcionales', () => {
      process.env.SMS_BASE_URL = 'https://custom.api.com';
      process.env.SMS_TIMEOUT = '5000';
      process.env.SMS_MAX_RETRIES = '5';

      const client = createClientFromEnv();
      expect(client).toBeDefined();
    });
  });
});

describe('SMSClient con mock de fetch', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('deberia enviar SMS y retornar mailingId', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(SUCCESS_RESPONSE)),
    });

    const client = new SMSClient(TEST_CREDENTIALS);
    const result = await client.send(VALID_SMS_REQUEST);

    expect(result.success).toBe(true);
    expect(result.mailingId).toBe(5000384);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('deberia enviar con los headers correctos', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(SUCCESS_RESPONSE)),
    });

    const client = new SMSClient(TEST_CREDENTIALS);
    await client.send(VALID_SMS_REQUEST);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/brdcstr-endpoint-web/services/messaging/'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Authorization': TEST_CREDENTIALS.token,
        }),
      })
    );
  });

  it('deberia convertir country a mayusculas', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(SUCCESS_RESPONSE)),
    });

    const client = new SMSClient(TEST_CREDENTIALS);
    await client.send({ ...VALID_SMS_REQUEST, country: 'mx' });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.country).toBe('MX');
  });

  it('deberia lanzar AuthenticationError en error de auth', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(AUTH_ERROR_RESPONSE)),
    });

    const client = new SMSClient(TEST_CREDENTIALS);
    await expect(client.send(VALID_SMS_REQUEST)).rejects.toThrow(AuthenticationError);
  });

  it('deberia lanzar InsufficientCreditError en error de credito', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(INSUFFICIENT_CREDIT_RESPONSE)),
    });

    const client = new SMSClient(TEST_CREDENTIALS);

    try {
      await client.send(VALID_SMS_REQUEST);
      expect.fail('Deberia haber lanzado error');
    } catch (error) {
      expect(isSMSError(error)).toBe(true);
      expect(isInsufficientCreditError(error)).toBe(true);
    }
  });

  it('deberia lanzar SMSError en error del servidor', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(SERVER_ERROR_RESPONSE)),
    });

    const client = new SMSClient(TEST_CREDENTIALS);

    try {
      await client.send(VALID_SMS_REQUEST);
      expect.fail('Deberia haber lanzado error');
    } catch (error) {
      expect(isSMSError(error)).toBe(true);
      expect((error as SMSError).code).toBe(19);
    }
  });

  it('deberia manejar errores HTTP', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('Error'),
    });

    const client = new SMSClient(TEST_CREDENTIALS);
    await expect(client.send(VALID_SMS_REQUEST)).rejects.toThrow(ConnectionError);
  });

  it('deberia manejar timeout', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('Timeout'), { name: 'TimeoutError' })
    );

    const client = new SMSClient(TEST_CREDENTIALS);
    await expect(client.send(VALID_SMS_REQUEST)).rejects.toThrow(ConnectionError);
  });

  it('deberia manejar AbortError', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('Aborted'), { name: 'AbortError' })
    );

    const client = new SMSClient(TEST_CREDENTIALS);
    await expect(client.send(VALID_SMS_REQUEST)).rejects.toThrow(ConnectionError);
  });

  it('deberia manejar respuesta JSON invalida', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('not json'),
    });

    const client = new SMSClient(TEST_CREDENTIALS);
    await expect(client.send(VALID_SMS_REQUEST)).rejects.toThrow(ConnectionError);
  });
});

describe('SMSClient.schedule', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(SUCCESS_RESPONSE)),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('deberia programar SMS con Date', async () => {
    const client = new SMSClient(TEST_CREDENTIALS);
    const futureDate = new Date('2030-12-31T10:00:00Z');

    const result = await client.schedule(VALID_SMS_REQUEST, futureDate);

    expect(result.success).toBe(true);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.schedule).toBe(futureDate.toISOString());
  });

  it('deberia programar SMS con string ISO-8601', async () => {
    const client = new SMSClient(TEST_CREDENTIALS);
    const scheduleStr = '2030-12-31T10:00:00-06:00';

    const result = await client.schedule(VALID_SMS_REQUEST, scheduleStr);

    expect(result.success).toBe(true);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.schedule).toBe(scheduleStr);
  });
});

describe('SMSClient.sendWithDeliveryReceipt', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(SUCCESS_RESPONSE)),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('deberia enviar SMS con DLR por defecto (5)', async () => {
    const client = new SMSClient(TEST_CREDENTIALS);

    const result = await client.sendWithDeliveryReceipt(VALID_SMS_REQUEST);

    expect(result.success).toBe(true);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.dlr).toBe(true);
    expect(body.optionals).toBe(JSON.stringify({ registeredDelivery: 5 }));
  });

  it('deberia enviar SMS con DLR personalizado', async () => {
    const client = new SMSClient(TEST_CREDENTIALS);

    await client.sendWithDeliveryReceipt(VALID_SMS_REQUEST, 11);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.dlr).toBe(true);
    expect(body.optionals).toBe(JSON.stringify({ registeredDelivery: 11 }));
  });
});

describe('Validaciones en send()', () => {
  it('deberia rechazar msisdns vacio', async () => {
    const client = new SMSClient(TEST_CREDENTIALS);

    await expect(client.send({
      ...VALID_SMS_REQUEST,
      msisdns: [],
    })).rejects.toThrow(ValidationError);
  });

  it('deberia rechazar MSISDN con formato invalido', async () => {
    const client = new SMSClient(TEST_CREDENTIALS);

    await expect(client.send({
      ...VALID_SMS_REQUEST,
      msisdns: ['123'],
    })).rejects.toThrow(ValidationError);
  });

  it('deberia rechazar country con mas de 2 caracteres', async () => {
    const client = new SMSClient(TEST_CREDENTIALS);

    await expect(client.send({
      ...VALID_SMS_REQUEST,
      country: 'MEX',
    })).rejects.toThrow(ValidationError);
  });

  it('deberia rechazar mensaje vacio', async () => {
    const client = new SMSClient(TEST_CREDENTIALS);

    await expect(client.send({
      ...VALID_SMS_REQUEST,
      message: '',
    })).rejects.toThrow(ValidationError);
  });

  it('deberia rechazar tag vacio', async () => {
    const client = new SMSClient(TEST_CREDENTIALS);

    await expect(client.send({
      ...VALID_SMS_REQUEST,
      tag: '',
    })).rejects.toThrow(ValidationError);
  });

  it('deberia rechazar schedule en el pasado', async () => {
    const client = new SMSClient(TEST_CREDENTIALS);

    await expect(client.send({
      ...VALID_SMS_REQUEST,
      schedule: '2020-01-01T00:00:00Z',
    })).rejects.toThrow(ValidationError);
  });

  it('deberia rechazar schedule con formato invalido', async () => {
    const client = new SMSClient(TEST_CREDENTIALS);

    await expect(client.send({
      ...VALID_SMS_REQUEST,
      schedule: 'not-a-date',
    })).rejects.toThrow(ValidationError);
  });
});

describe('Error discriminators', () => {
  it('isSMSError deberia identificar errores SMS', () => {
    const smsError = new SMSError(15);
    const genericError = new Error('test');

    expect(isSMSError(smsError)).toBe(true);
    expect(isSMSError(genericError)).toBe(false);
    expect(isSMSError(null)).toBe(false);
  });

  it('isAuthenticationError deberia identificar errores de auth', () => {
    const authError = new AuthenticationError(3);
    const smsError = new SMSError(15);
    const smsAuthError = new SMSError(1);

    expect(isAuthenticationError(authError)).toBe(true);
    expect(isAuthenticationError(smsError)).toBe(false);
    expect(isAuthenticationError(smsAuthError)).toBe(true);
  });

  it('isValidationError deberia identificar errores de validacion', () => {
    const validationError = new ValidationError('test');
    const smsError = new SMSError(15);

    expect(isValidationError(validationError)).toBe(true);
    expect(isValidationError(smsError)).toBe(false);
  });

  it('isConnectionError deberia identificar errores de conexion', () => {
    const connError = new ConnectionError('test');
    const smsError = new SMSError(15);

    expect(isConnectionError(connError)).toBe(true);
    expect(isConnectionError(smsError)).toBe(false);
  });

  it('isInsufficientCreditError deberia identificar error de credito', () => {
    const creditError = new InsufficientCreditError();
    const smsError15 = new SMSError(15);
    const smsError17 = new SMSError(17);

    expect(isInsufficientCreditError(creditError)).toBe(true);
    expect(isInsufficientCreditError(smsError15)).toBe(true);
    expect(isInsufficientCreditError(smsError17)).toBe(false);
  });

  it('isRetryableError deberia identificar errores reintentables', () => {
    const connError = new ConnectionError('test');
    const serverError = new SMSError(19);
    const creditError = new SMSError(15);

    expect(isRetryableError(connError)).toBe(true);
    expect(isRetryableError(serverError)).toBe(true);
    expect(isRetryableError(creditError)).toBe(false);
  });
});

describe('Retry con exponential backoff', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('deberia reintentar en error de conexion', async () => {
    let attempts = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      attempts++;
      if (attempts < 3) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(SUCCESS_RESPONSE)),
      });
    });

    const client = new SMSClient({
      credentials: TEST_CREDENTIALS,
      retry: { maxRetries: 3, baseDelay: 10, maxDelay: 100 },
    });

    const result = await client.send(VALID_SMS_REQUEST);

    expect(result.success).toBe(true);
    expect(attempts).toBe(3);
  });

  it('no deberia reintentar en error de autenticacion', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(AUTH_ERROR_RESPONSE)),
    });

    const client = new SMSClient({
      credentials: TEST_CREDENTIALS,
      retry: { maxRetries: 3, baseDelay: 10, maxDelay: 100 },
    });

    await expect(client.send(VALID_SMS_REQUEST)).rejects.toThrow(AuthenticationError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
