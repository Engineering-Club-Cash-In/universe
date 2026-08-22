import { describe, expect, test } from 'bun:test';
import {
  createCarteraStructuredLogger,
  emitCreditCapitalPaymentAuditCompleted,
  emitCreditCapitalPaymentAuditFailed,
  emitRecoveredDuplicatePendingInstallment,
  resolveCarteraLogEnvironment,
} from './structuredLogger';

describe('Cartera structured logger adapter', () => {
  test('maps existing deployment environment names to the logger contract', () => {
    expect(resolveCarteraLogEnvironment('DEV')).toBe('development');
    expect(resolveCarteraLogEnvironment('development')).toBe('development');
    expect(resolveCarteraLogEnvironment('LOCAL')).toBe('local');
    expect(resolveCarteraLogEnvironment('PROD')).toBe('production');
    expect(resolveCarteraLogEnvironment('production')).toBe('production');
    expect(resolveCarteraLogEnvironment('staging')).toBe('staging');
    expect(resolveCarteraLogEnvironment(undefined)).toBe('local');
    expect(resolveCarteraLogEnvironment('unexpected')).toBe('local');
  });

  test('emits only the approved recovered integrity anomaly payload', () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: 'staging',
      clock: () => new Date('2026-08-22T00:00:00.000Z'),
      sink: (line) => lines.push(line),
    });

    emitRecoveredDuplicatePendingInstallment(logger);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      timestamp: '2026-08-22T00:00:00.000Z',
      schema_version: 1,
      service: 'cartera-back',
      environment: 'staging',
      event: 'payment.integrity_anomaly',
      outcome: 'recovered',
      level: 'warn',
      anomaly_code: 'duplicate_pending_installment',
      recovery_applied: true,
    });
  });

  test('does not let audit sink failures alter endpoint control flow', () => {
    const logger = createCarteraStructuredLogger({
      sink: () => {
        throw new Error('synthetic sink failure');
      },
    });

    expect(() => emitCreditCapitalPaymentAuditCompleted({
      processedCount: 1,
      succeededCount: 1,
      failedCount: 0,
      durationMs: 1,
    }, logger)).not.toThrow();
    expect(() => emitCreditCapitalPaymentAuditFailed({
      operation: 'query',
      durationMs: 1,
    }, logger)).not.toThrow();
  });

  test('emits bounded capital-payment audit outcomes without business data', () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: 'staging',
      clock: () => new Date('2026-08-22T00:00:00.000Z'),
      sink: (line) => lines.push(line),
    });

    emitCreditCapitalPaymentAuditCompleted({
      processedCount: 4,
      succeededCount: 3,
      failedCount: 1,
      durationMs: 25,
    }, logger);
    emitCreditCapitalPaymentAuditFailed({
      operation: 'diagnostic',
      durationMs: 10,
    }, logger);

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'credit.capital_payment_audit',
      outcome: 'completed',
      level: 'info',
      audit_operation: 'query',
      processed_count: 4,
      succeeded_count: 3,
      failed_count: 1,
      duration_ms: 25,
    });
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({
      event: 'credit.capital_payment_audit',
      outcome: 'failed',
      level: 'error',
      audit_operation: 'diagnostic',
      duration_ms: 10,
      error_code: 'unknown',
    });
    const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const forbiddenKeys = [
      'credito_id', 'pago_id', 'nombre', 'monto', 'message', 'stack', 'error',
    ];
    for (const entry of entries) {
      for (const key of forbiddenKeys) expect(entry).not.toHaveProperty(key);
    }
  });
});
