import { describe, expect, test } from 'bun:test';
import { carteraCatalog } from '../src/cartera-catalog';
import { createCorrelationId, createStructuredLogger, StructuredLoggerValidationError } from '../src/logger';
import type { StructuredLoggerConfig } from '../src/logger';

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('structured logger runtime contract', () => {
  test('creates a valid opaque correlation UUID', () => {
    expect(createCorrelationId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test('captures validated config values once to prevent TOCTOU', () => {
    const lines: string[] = [];
    let serviceReads = 0;
    const config = {
      get service() {
        serviceReads += 1;
        return serviceReads === 1 ? 'cartera-back' : 'stolen-secret\nforged';
      },
      environment: 'staging',
      sink: (line: string) => lines.push(line),
    } satisfies StructuredLoggerConfig;
    const logger = createStructuredLogger(carteraCatalog, config);
    logger.emit('payment.upload', 'stored', { mime_family: 'pdf', duration_ms: 1 });
    expect(serviceReads).toBe(1);
    expect(JSON.parse(lines[0] ?? '{}').service).toBe('cartera-back');
  });

  test('rejects catalogs whose payload fields collide with reserved metadata', () => {
    const maliciousCatalog = {
      ...carteraCatalog,
      fields: {
        ...carteraCatalog.fields,
        service: { type: 'string', maxLength: 64, pattern: '^[A-Za-z-]+$' },
      },
      events: {
        ...carteraCatalog.events,
        'malicious.event': {
          outcomes: {
            completed: { level: 'info', required: ['service'], optional: [] },
          },
        },
      },
    } as const;
    expect(() => createStructuredLogger(maliciousCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    })).toThrow(StructuredLoggerValidationError);
  });

  test('rejects sensitive aliases in custom catalog fields', () => {
    const forbiddenAliases = [
      'request_bodies', 'cookies', 'access_tokens', 'credenciales', 'api_keys',
      'error_messages', 'signed_urls', 'customer_names', 'telefonos', 'documentos_fiscales',
      'name', 'names', 'legal_name', 'display_name',
      'nombres', 'nombre_cliente', 'correo', 'correos', 'domicilio', 'domicilios',
      'credit_ids', 'sifco_codes', 'amounts', 'balances', 'porcentajes', 'free_text',
      'address', 'addresses', 'address_customer',
      'autorizacion', 'autorizaciones', 'autorizacion_cliente',
      'credential', 'credentials', 'credential_api',
      'credencial', 'credenciales', 'credencial_api',
      'direccion', 'direcciones', 'direccion_cliente',
      'interest', 'interests', 'interest_monthly',
      'interes', 'intereses', 'interes_mensual',
      'credit_id', 'credit_ids', 'credits_id', 'credits_ids',
      'credito_id', 'credito_ids', 'creditos_id', 'creditos_ids',
      'payment_id', 'payment_ids', 'payments_id', 'payments_ids',
      'pago_id', 'pago_ids', 'pagos_id', 'pagos_ids',
      'installment_id', 'installment_ids', 'installments_id', 'installments_ids',
      'cuota_id', 'cuota_ids', 'cuotas_id', 'cuotas_ids',
      'investor_id', 'investor_ids', 'investors_id', 'investors_ids',
      'inversionista_id', 'inversionista_ids', 'inversionistas_id', 'inversionistas_ids',
      'invoice_id', 'invoice_ids', 'invoices_id', 'invoices_ids',
      'factura_id', 'factura_ids', 'facturas_id', 'facturas_ids',
      'receipt_id', 'receipt_ids', 'receipts_id', 'receipts_ids',
      'boleta_id', 'boleta_ids', 'boletas_id', 'boletas_ids',
    ] as const;

    for (const field of forbiddenAliases) {
      const maliciousCatalog = structuredClone(carteraCatalog);
      Object.assign(maliciousCatalog.fields, { [field]: { type: 'boolean' } });
      Object.assign(maliciousCatalog.events, {
        [`malicious.${field}`]: {
          outcomes: { completed: { level: 'info', required: [field], optional: [] } },
        },
      });
      expect(() => createStructuredLogger(maliciousCatalog, {
        service: 'cartera-back', environment: 'staging', sink: () => undefined,
      }), field).toThrow(StructuredLoggerValidationError);
    }
  });

  test.each(['pdfs', 'xmls', 'soaps', 'htmls', 'dpis', 'nits'] as const)(
    'rejects plural document-format or identifier alias %s in custom catalog fields',
    (field) => {
      const maliciousCatalog = structuredClone(carteraCatalog);
      Object.assign(maliciousCatalog.fields, { [field]: { type: 'boolean' } });
      Object.assign(maliciousCatalog.events, {
        [`malicious.${field}`]: {
          outcomes: { completed: { level: 'info', required: [field], optional: [] } },
        },
      });
      expect(() => createStructuredLogger(maliciousCatalog, {
        service: 'cartera-back', environment: 'staging', sink: () => undefined,
      })).toThrow(StructuredLoggerValidationError);
    },
  );

  test('allows approved fields that contain non-sensitive word fragments', () => {
    const approvedFields = [
      'auth_reason', 'credit_closed', 'credit_state_transition', 'credit_type', 'credit_updated',
      'installment_closed', 'investor_count', 'job_name', 'payment_kind', 'previous_payment_state',
    ] as const;

    expect(() => createStructuredLogger(carteraCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    })).not.toThrow();
    for (const field of approvedFields) expect(carteraCatalog.fields).toHaveProperty(field);
  });

  test('rejects custom string job_name definitions', () => {
    const maliciousCatalog = structuredClone(carteraCatalog);
    Object.assign(maliciousCatalog.fields, {
      job_name: { type: 'string', maxLength: 1024, pattern: '^.*$' },
    });
    expect(() => createStructuredLogger(maliciousCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    })).toThrow(StructuredLoggerValidationError);
  });

  test('rejects altered job_name enums', () => {
    const maliciousCatalog = structuredClone(carteraCatalog);
    Object.assign(maliciousCatalog.fields, {
      job_name: {
        type: 'enum',
        values: [...carteraCatalog.fields.job_name.values, 'user_supplied_job_name'],
      },
    });
    expect(() => createStructuredLogger(maliciousCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    })).toThrow(StructuredLoggerValidationError);
  });

  test('rejects accessor payloads and emits only from one Proxy snapshot', () => {
    const lines: string[] = [];
    const logger = createStructuredLogger(carteraCatalog, {
      service: 'cartera-back', environment: 'staging', sink: (line: string) => lines.push(line),
    });
    const accessorPayload = Object.defineProperty({ duration_ms: 1 }, 'mime_family', {
      enumerable: true,
      get: () => 'pdf',
    });
    expect(() => logger.emitUnsafe('payment.upload', 'stored', accessorPayload))
      .toThrow(StructuredLoggerValidationError);

    const target = { mime_family: 'pdf', duration_ms: 1 };
    let ownKeysCalls = 0;
    const changingProxy = new Proxy(target, {
      ownKeys: (object) => {
        ownKeysCalls += 1;
        return ownKeysCalls === 1 ? Reflect.ownKeys(object) : [...Reflect.ownKeys(object), 'event'];
      },
      getOwnPropertyDescriptor: (object, property) => property === 'event'
        ? { configurable: true, enumerable: true, value: 'forged.event', writable: true }
        : Reflect.getOwnPropertyDescriptor(object, property),
    });
    logger.emitUnsafe('payment.upload', 'stored', changingProxy);
    expect(ownKeysCalls).toBe(1);
    expect(JSON.parse(lines[0] ?? '{}').event).toBe('payment.upload');
  });

  test('uses an immutable catalog snapshot after logger creation', () => {
    const mutableCatalog = structuredClone(carteraCatalog);
    const lines: string[] = [];
    const logger = createStructuredLogger(mutableCatalog, {
      service: 'cartera-back', environment: 'staging', sink: (line: string) => lines.push(line),
    });
    Object.assign(mutableCatalog.fields, {
      event: { type: 'string', maxLength: 64, pattern: '^[a-z.]+$' },
    });
    const stored = mutableCatalog.events['payment.upload'].outcomes.stored;
    Object.assign(stored, { required: [...stored.required, 'event'] });
    logger.emitUnsafe('payment.upload', 'stored', { mime_family: 'pdf', duration_ms: 1 });
    expect(JSON.parse(lines[0] ?? '{}').event).toBe('payment.upload');
  });

  test('rejects catalogs that weaken fixed common-field semantics', () => {
    const weakenedCatalog = structuredClone(carteraCatalog);
    Object.assign(weakenedCatalog.commonFields, {
      request_id: { type: 'string', maxLength: 1024, pattern: '^.*$' },
    });
    expect(() => createStructuredLogger(weakenedCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    })).toThrow(StructuredLoggerValidationError);
  });

  test('uses Date intrinsics and ignores Object.prototype.toJSON pollution', () => {
    const lines: string[] = [];
    const date = new Date('2026-08-21T21:00:00.000Z');
    Object.defineProperty(date, 'toISOString', {
      configurable: true,
      value: () => 'SYNTHETIC_SENTINEL_TIMESTAMP',
    });
    const logger = createStructuredLogger(carteraCatalog, {
      service: 'cartera-back', environment: 'staging', clock: () => date,
      sink: (line: string) => lines.push(line),
    });
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      value: () => ({ token: 'SYNTHETIC_SENTINEL_PROTOTYPE' }),
    });
    try {
      const emitted = logger.emit('payment.upload', 'stored', { mime_family: 'pdf', duration_ms: 1 });
      expect(JSON.parse(lines[0] ?? '{}').timestamp).toBe('2026-08-21T21:00:00.000Z');
      expect(lines[0]).not.toContain('SYNTHETIC_SENTINEL');
      expect(Object.getPrototypeOf(emitted)).toBeNull();
      expect(Object.isFrozen(emitted)).toBe(true);
      expect(Reflect.set(emitted, 'event', 'forged.event')).toBe(false);
      expect(Reflect.set(emitted, 'token', 'SYNTHETIC_SENTINEL_AFTER_RETURN')).toBe(false);
    } finally {
      Reflect.deleteProperty(Object.prototype, 'toJSON');
    }
  });

  test('emits one validated JSON line with generated common fields', () => {
    const lines: string[] = [];
    const logger = createStructuredLogger(carteraCatalog, {
      service: 'cartera-back',
      environment: 'staging',
      clock: () => new Date('2026-08-21T21:00:00.000Z'),
      sink: (line: string) => lines.push(line),
    });

    logger.emit('payment.registration', 'completed', {
      payment_kind: 'normal',
      duration_ms: 25,
      lock_state: 'acquired',
    }, { request_id: REQUEST_ID });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.includes('\n')).toBe(false);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      timestamp: '2026-08-21T21:00:00.000Z',
      schema_version: 1,
      service: 'cartera-back',
      environment: 'staging',
      event: 'payment.registration',
      outcome: 'completed',
      level: 'info',
      request_id: REQUEST_ID,
      payment_kind: 'normal',
      duration_ms: 25,
      lock_state: 'acquired',
    });
  });

  test('rejects unknown events, outcomes, missing and extra fields', () => {
    const logger = createStructuredLogger(carteraCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    });
    expect(() => logger.emitUnsafe('unknown.event', 'completed', {}, {}))
      .toThrow(StructuredLoggerValidationError);
    expect(() => logger.emitUnsafe('payment.upload', 'unknown', {}, {}))
      .toThrow(StructuredLoggerValidationError);
    expect(() => logger.emitUnsafe('payment.upload', 'stored', { duration_ms: 2 }, {}))
      .toThrow(StructuredLoggerValidationError);
    expect(() => logger.emitUnsafe('payment.upload', 'stored', {
      mime_family: 'pdf', duration_ms: 2, body: '[REDACTED]',
    }, {})).toThrow(StructuredLoggerValidationError);
  });

  test('never includes a rejected sensitive value in validation errors', () => {
    const logger = createStructuredLogger(carteraCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    });
    const sensitive = 'super-secret-value';
    try {
      logger.emitUnsafe('payment.upload', 'stored', {
        mime_family: 'pdf', duration_ms: 2, token: sensitive,
      }, {});
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredLoggerValidationError);
      expect(String(error)).not.toContain(sensitive);
      expect(error).toMatchObject({ field: 'token', code: 'forbidden_field' });
    }
  });

  test('never includes a rejected event value or control characters in errors', () => {
    const logger = createStructuredLogger(carteraCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    });
    const rejected = 'secret-value\nsecond-line';
    try {
      logger.emitUnsafe(rejected, 'completed', {}, {});
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredLoggerValidationError);
      expect(String(error)).not.toContain('secret-value');
      expect(String(error)).not.toContain('\n');
      expect(error).toMatchObject({ event: 'unknown', code: 'unknown_event' });
    }
  });

  test('enforces field types, enum values, integer limits and flat payloads', () => {
    const logger = createStructuredLogger(carteraCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    });
    expect(() => logger.emitUnsafe('payment.upload', 'stored', {
      mime_family: 'video', duration_ms: 2,
    }, {})).toThrow();
    expect(() => logger.emitUnsafe('payment.upload', 'stored', {
      mime_family: 'pdf', duration_ms: -1,
    }, {})).toThrow();
    expect(() => logger.emitUnsafe('payment.upload', 'stored', {
      mime_family: 'pdf', duration_ms: { value: 2 },
    }, {})).toThrow();
  });

  test('validates UUID correlation fields and rejects extra context', () => {
    const logger = createStructuredLogger(carteraCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    });
    const payload = { mime_family: 'pdf', duration_ms: 2 };
    expect(() => logger.emitUnsafe('payment.upload', 'stored', payload, {
      request_id: 'credit-123',
    })).toThrow();
    expect(() => logger.emitUnsafe('payment.upload', 'stored', payload, {
      request_id: REQUEST_ID, credito_id: 123,
    })).toThrow();
  });

  test('enforces provider-operation compatibility', () => {
    const logger = createStructuredLogger(carteraCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    });
    expect(() => logger.emitUnsafe('integration.request', 'completed', {
      provider: 'cofidi_sat',
      operation: 'put_upload',
      duration_ms: 10,
      attempt: 1,
      retryable: false,
    }, { request_id: REQUEST_ID })).toThrow();
  });

  test('enforces constants and count invariants', () => {
    const logger = createStructuredLogger(carteraCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    });
    expect(() => logger.emitUnsafe('invoice.voiding', 'local_state_inconsistent', {
      voiding_mode: 'batch',
      provider: 'cofidi_sat',
      processed_count: 2,
      succeeded_count: 1,
      failed_count: 1,
      manual_action_required: false,
      duration_ms: 10,
      error_code: 'persistence_failed',
    }, { request_id: REQUEST_ID })).toThrow();
    expect(() => logger.emitUnsafe('invoice.voiding', 'completed', {
      voiding_mode: 'batch',
      provider: 'cofidi_sat',
      processed_count: 3,
      succeeded_count: 1,
      failed_count: 1,
      manual_action_required: false,
      duration_ms: 10,
    }, { request_id: REQUEST_ID })).toThrow();
  });

  test('rejects partial count invariant sets', () => {
    const logger = createStructuredLogger(carteraCatalog, {
      service: 'cartera-back', environment: 'staging', sink: () => undefined,
    });
    expect(() => logger.emitUnsafe('job.execution', 'completed', {
      job_name: 'verify_sat_invoices',
      duration_ms: 10,
      processed_count: 999,
    }, { run_id: REQUEST_ID })).toThrow();
  });
});
