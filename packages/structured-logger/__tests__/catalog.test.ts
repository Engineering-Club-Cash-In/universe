import { describe, expect, test } from 'bun:test';
import { carteraCatalog } from '../src/cartera-catalog';
import type { EventCatalogDefinition } from '../src/catalog-types';

const catalog: EventCatalogDefinition = carteraCatalog;
const FORBIDDEN_FIELD_PATTERN = /(^|_)(body|request|response|query|params|headers|cookie|token|authorization|password|secret|credential|api_?key|connection_?string|message|stack|cause|dpi|nit|email|phone|address|amount|monto|saldo|deuda|capital|interes|iva|credito_id|pago_id|cuota_id|inversionista_id|factura_id|boleta)($|_)/i;

describe('carteraCatalog', () => {
  test('contains the finite v1 event set', () => {
    expect(Object.keys(carteraCatalog.events).sort()).toEqual([
      'audit.persistence',
      'auth.jwt_validation',
      'credit.capital_payment_audit',
      'credit.creation',
      'credit.liquidation',
      'credit.schedule_recalculation',
      'credit.update',
      'http.request',
      'integration.request',
      'investor.assignment',
      'investor.liquidation',
      'invoice.voiding',
      'job.execution',
      'payment.agreement_creation',
      'payment.agreement_status_change',
      'payment.application',
      'payment.integrity_anomaly',
      'payment.investor_distribution',
      'payment.registration',
      'payment.revalidation',
      'payment.reversal',
      'payment.upload',
      'service.lifecycle',
    ]);
  });

  test('defines every outcome with an explicit level and exact fields', () => {
    for (const event of Object.values(catalog.events)) {
      expect(Object.keys(event.outcomes).length).toBeGreaterThan(0);
      for (const outcome of Object.values(event.outcomes)) {
        expect(['info', 'warn', 'error']).toContain(outcome.level);
        expect(new Set(outcome.required).size).toBe(outcome.required.length);
        expect(new Set(outcome.optional).size).toBe(outcome.optional.length);
        for (const field of outcome.required) {
          expect(outcome.optional).not.toContain(field);
          expect(catalog.fields[field]).toBeDefined();
        }
        for (const field of outcome.optional) {
          expect(catalog.fields[field]).toBeDefined();
        }
      }
    }
  });

  test('allows no sensitive or arbitrary payload field names', () => {
    for (const field of Object.keys(catalog.fields)) {
      expect(field).not.toMatch(FORBIDDEN_FIELD_PATTERN);
    }
  });

  test('bounds every integer and string field', () => {
    for (const field of Object.values(catalog.fields)) {
      if (field.type === 'integer') {
        expect(Number.isSafeInteger(field.min)).toBe(true);
        expect(Number.isSafeInteger(field.max)).toBe(true);
        expect(field.max).toBeGreaterThanOrEqual(field.min);
      }
      if (field.type === 'string') {
        expect(field.maxLength).toBeGreaterThan(0);
        expect(field.pattern.length).toBeGreaterThan(0);
      }
      if (field.type === 'enum') {
        expect(field.values.length).toBeGreaterThan(0);
        expect(new Set(field.values).size).toBe(field.values.length);
      }
    }
  });

  test('limits v1 HTTP lifecycle to the first migration routes', () => {
    expect(carteraCatalog.fields.route_template).toEqual({
      type: 'enum',
      values: ['/upload', '/newPayment'],
    });
  });

  test('defines a finite operation set for every provider', () => {
    const providers = carteraCatalog.fields.provider.values;
    const operations = carteraCatalog.fields.operation.values;
    expect(Object.keys(carteraCatalog.providerOperations).sort()).toEqual([...providers].sort());
    for (const provider of providers) {
      const providerOperations = carteraCatalog.providerOperations[provider];
      expect(providerOperations.length).toBeGreaterThan(0);
      for (const operation of providerOperations) {
        expect(operations).toContain(operation);
      }
    }
  });

  test('requires manual action for local invoice state inconsistencies', () => {
    expect(carteraCatalog.events['invoice.voiding'].outcomes.local_state_inconsistent.constants)
      .toEqual({ manual_action_required: true });
  });

  test('defines a finite safe contract for the capital-payment audit slice', () => {
    expect(carteraCatalog.fields.audit_operation).toEqual({
      type: 'enum',
      values: ['query', 'diagnostic'],
    });
    expect(carteraCatalog.events['credit.capital_payment_audit']).toEqual({
      outcomes: {
        completed: {
          level: 'info',
          required: [
            'audit_operation',
            'processed_count',
            'succeeded_count',
            'failed_count',
            'duration_ms',
          ],
          optional: [],
        },
        diagnostic_completed: {
          level: 'info',
          required: ['audit_operation', 'duration_ms'],
          optional: [],
          constants: { audit_operation: 'diagnostic' },
        },
        partially_completed: {
          level: 'warn',
          required: [
            'audit_operation',
            'processed_count',
            'succeeded_count',
            'failed_count',
            'duration_ms',
          ],
          optional: [],
        },
        failed: {
          level: 'error',
          required: ['audit_operation', 'duration_ms', 'error_code'],
          optional: [],
        },
      },
    });
  });
});
